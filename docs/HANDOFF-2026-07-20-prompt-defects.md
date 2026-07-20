# HANDOFF 2026-07-20 — prompt 数据缺陷修复

> 50 场 healer eval 挖出的 8 类缺陷,**全部已处理并验证**。

## 一句话现状

全部修复都用**确定性 A/B** 验证(同语料 fingerprint `be78167b..2faaf381`,
50 场,**不调模型**):重建 prompt → 用文本判据数违规 → 比修前修后。

| 类    | 缺陷                                     | 修前           | 修后       | commit    |
| ----- | ---------------------------------------- | -------------- | ---------- | --------- |
| A     | `[DMG SPIKE]` HP 与同秒 `[STATE]` 矛盾   | 26/50 场 33 处 | **0**      | `0e13264` |
| B     | 基线百分位倒置 p50>p90                   | 14/50 场       | **0**      | `0e13264` |
| C     | 行内嵌 `(X% HP)` 与同秒 STATE 矛盾       | 2/50 场        | **0**      | `f42fca1` |
| E/G   | 窗口时长与显示起止不符                   | 4/33 行        | **0**      | `cd60380` |
| E/G   | 记号无图例(`[n/m]`/`rdy:Δ`/spike 时间戳) | —              | 已补       | `cd60380` |
| H     | 时长两套取整口径(0:36 vs 37s)            | —              | 已修       | `cd60380` |
| F     | 自己施放的 CC 缺 DR 标注                 | 0/159 行       | **86/159** | `be36279` |
| I     | OFFENSIVE WINDOW 伤害与区间对不上        | —              | 已修       | `23de9f5` |
| **D** | 冷却台账自相矛盾(同一技能两个冷却常量)   | 1/50 场        | **0**      | `c820ad4` |

> **D 类有过一次错误结论。** `dbe61bd` 曾判定「非数据不一致,只是记号歧义」并只改图例 ——
> 那是**只查了一个样本(Lay on Hands)就外推整类**。真根因是 `deathOutcomeAnalysis` 私有表
> 与主路径各自维护冷却值(Ironbark 45s vs 65s),由盲评 responder 用反例推翻,修于 `c820ad4`。
> 详见本文末 D 类小节。

---

## 最重要的一条教训:先问「两处查的是不是同一时刻」

**A 类的第一版修复是错的,而且完全无效。**

`3cd5342` 按「统一采样半径」修(理由看似充分:`[STATE]` 在关键窗口用 ±1.5s、
`[DMG SPIKE]` 恒用 ±3s)。实测 **26/50 → 26/50,一个数都没动**。

原因:`getUnitHpAtTimestamp` 是**先取最近样本、再用 maxDtMs 决定接受与否**。
改半径只能把值变成 `null`,**永远不会改变取到的数值**。

真根因是查询时刻不在同一网格:`[STATE]` 按整数秒采样,`[DMG SPIKE]` 按
`pw.fromSeconds`(小数秒)采样,两者却都经 `fmtTime` 渲染成同一个显示秒。
改成对齐查询时刻后 26/50 → 0/50。

> 任何「两处数值不一致」的问题,**先问它们查的是不是同一时刻**,再问半径。
> 这正是 CLAUDE.md「分析内部的小数秒必须先 floor 到渲染网格」的字面情形。

**后续(`dbe61bd`):那套两档半径已整套删除**,不只是回滚 `3cd5342`。因为收窄
半径在 `3cd5342` 之前就存在于 STATE 一侧,只回滚会留下同一隐患。删除依据是实测:
它与 STATE 发射门(HP 变化 ≥10% 才出行)冗余,且在 **24/50 场**把单位整个从
`[STATE]` 行删掉 —— 被删的恰是没在挨打、HP 本就平稳的单位。删除后 A/C 保持 0,
STATE 的 HP 读数 6349 → 6380。**要提升新鲜度请改发射门或采样源,别再引入第二个半径。**

C 类还藏着第三层:敌方目标的 HP 根本不走 `getHpPercentAtTime`,而是
`cast.targetHpPct` —— 在 `cooldowns.ts` 提取冷却时就用**原始日志毫秒 +
硬编码 2000ms 半径**算好了。**同一个事实的第三条采样路径。**

## 新增的共享谓词(别再各自实现)

| 谓词                              | 位置                         | 管什么                                         |
| --------------------------------- | ---------------------------- | ---------------------------------------------- |
| `toRenderSecond(t)`               | `utils/cooldowns.ts`         | 采样时刻归到渲染网格(与 `fmtTime` 同规则)      |
| `renderedWindowSeconds(from,to)`  | `utils/cooldowns.ts`         | 窗口宽度由**显示的端点**导出                   |
| `toSortedFinite` / `medianFinite` | `utils/stats.ts`             | 顺序统计量,丢弃非有限值                        |
| `buildCriticalWindowSet`          | `context/criticalWindows.ts` | 关键窗口秒集合(buildMatchContext 构建一次下发) |

## B 类根因(值得单独记)

`(a,b)=>a-b` 对 NaN 返回 NaN,**V8 遇到这种比较器不报错**,而是静默留下
*部分未排序*的数组;`percentile()` 按索引取值于是取到乱序样本。单个 NaN 就能
让 p50>p90,且 NaN 经 `JSON.stringify` 变 `null`、未必落在被选中的索引上 ——
**坏数据看起来「全是正常数字」,只是顺序不对**。

NaN 源头:`metrics.ts` 里 damageIn 的 `Math.abs(d.effectiveAmount)` 无守卫,
而同文件 damageOut 早有 `"effectiveAmount" in d` 守卫 —— 只是漏了一处。

重算后 28 个 spec 有 **4 个**受污染:2 个可见倒置(Arms/MM),另 2 个
(Feral Druid / Restoration Shaman)乱序后碰巧仍单调,**从未表现出症状**。

## 确定性护栏(全部重新解析渲染后的 prompt 文本)

`packages/eval/src/quality/promptQualityCheck.ts`,均已接入 `hardFailures`:

- `checkPercentileMonotonicity` —— 同行百分位必须单调不减(B 类)
- `checkSameSecondHpConsistency` —— 同秒同单位 HP 必须一致(容忍 3pp);
  A 类的 `X% -> Y% HP` 与 C 类的 `→ 目标 (X% HP)` 共用这一套判据
- `checkWindowSpanConsistency` —— 标注时长必须等于显示起止之差(E/G 类)
- `checkCooldownLedgerConsistency` —— MISSED OPTIONS 声称 available 的冷却,
  不得同时出现在同秒 `[RES]` 台账的 `cd:` 里(D 类,`0eeabb2` 补齐)

这些判据**不依赖模型**,是本轮所有 A/B 的度量工具。复现方法:

```bash
npx tsx packages/eval/scripts/buildCorpus.ts \
  --manifest <50 条日志清单> --run <runId>
# 然后对 runs/<runId>/prompts 跑上面四条判据
```

## 千场管线复验(改动全部落地后)

`pipelineFuzz --count 1000 --run fuzz-2026-07-20-postfix`:

```
{"files":1000,"parseFail":0,"matches":695,"rounds":1830,"combatsAudited":2525}
229 findings —— 全部为 cjk:*(CN 服玩家名,合法),与改动前那轮数量完全一致
```

无新增 finding 类别、无解析失败、无异常 —— 本轮改动未引入管线回归。

---

## D 类冷却台账自相矛盾 —— 已修复(`c820ad4`),但先错过一次

> **⚠️ 两次结论,第一次是错的。** `dbe61bd` 判定「非数据不一致,只改图例」——
> **该结论已被 `c820ad4` 推翻**。真根因见本节末尾「订正」。原始记录保留。

死亡块的 `[RES]` 冷却台账与「DEATHS WITH MISSED OPTIONS」对**同一个冷却**的
可用性判断相反。

**已确认的事实**(实例:`003-c5f8395a.txt` @ 2:03):

- `[RES]` 台账的 `rdy:` / `cd:` 两列**都没有 Lay on Hands**,即该路径完全不
  跟踪这个技能
- 同一时刻 MISSED OPTIONS 却写「had Lay on Hands available」
- 两条路径用的是**各自独立维护的技能清单**:missed-options 走
  `deathOutcomeAnalysis.ts` 自有的 `EXTERNAL_DEFENSIVE_SPELLS` /
  `IMMUNITY_SPELLS`;`[RES]` 台账走 `extractMajorCooldowns`

### 结论一(`dbe61bd`)—— **后被证伪,勿采信**

- `[RES]` 台账的数据源是 **`classMetadata` + `spellEffectData`**,不是上面
  猜的 `SPELL_CATEGORIES`(那份只存 CC/定身/免疫)。
- 真实分歧**只有 1 个技能**:Lay on Hands(633),两份数据里都没有;
  另外 10 条私有清单条目都在 `classMetadata` 里。
- **千场语料(2525 场战斗)里 633 只被施放过 1 次。** n=1 测不出冷却
  (需同一玩家两次施放才有间隔),使用率趋近 0 —— 按 CLAUDE.md 的白名单
  实证要求,**不足以纳入追踪**,何况会改动每一份含帕拉丁的 prompt。
- missed-options 报它 available 是因为「从未施放 = 全场可用」,本身不算错。
  真正的问题是**读者无法区分「台账不追踪」与「不可用」**。
- 采用的修法:在图例写明 `[RES]` 只列受追踪的 CD,缺席 ≠ 不可用。

### 订正(`c820ad4`)—— 真根因

上面那个结论错在**只查了 Lay on Hands 一个样本就外推**。A/B 轮次里 responder
子代理在 ord 041 上给出反例:

- 死亡 1:53,`[RES]` 台账 `cd:Ironbark(7s)`(冷却中)
- 同一 prompt 的 MISSED OPTIONS 写 "had Ironbark available"
- Ironbark **在**受追踪清单里 —— 不是白名单缺失

**真根因:同一技能两个独立维护的冷却值**(重复常量漂移)。
`deathOutcomeAnalysis.ts` 的 EXTERNAL_DEFENSIVE_SPELLS 自带 cooldownSeconds
(Ironbark 45s),主路径经 spellEffectData + 天赋修正解析为 65s。
验算:0:52 施放 → 0:52+45=1:37「可用」;0:52+65=1:57,1:53 时仍在冷却。

修法:`buildDeathOutcomeSummary` 新增 `resolvedCooldownSeconds` 解析器入参,
可用性判定消费与台账同源的已解析冷却。确定性 A/B:虚假 available 1/50 → 0/50。

> **两条教训**
>
> 1. 「两处判定打架」先问是不是在断言同一件事 —— 但**别只查一个样本就下结论**。
>    Lay on Hands 那个样本确实是「未追踪」,而 Ironbark 是真的数据不一致;
>    我用前者的结论覆盖了整类,漏掉了后者。
> 2. 独立的第二双眼睛有实际价值:这个反例是盲评 responder 发现的,它拒绝采信
>    MISSED OPTIONS,理由是与同一份 prompt 的台账矛盾。

## 其它已知陷阱(踩过的)

1. **七维分数不可作跨 run 绝对刻度** —— 挖缺陷那轮未跑 `/calibrate-judge`,
   judge 间口径不一致,故那轮所有结论改用确定性判据。
   (后续 A/B 轮已补校准,量化结果见 `HANDOFF-2026-07-20-ab-blind-eval.md`
   与 `docs/commands/eval-ab.md` 的 MDE 段 —— 别把这两轮的状态混为一谈。)
2. **缺陷线 ≠ 分数线** —— 46/50 场报了缺陷却只有 1 场 flagged;responder 多数
   情况自行绕开矛盾数据,`accuracy` 反而高分。缺陷必须单独收集。
   **且 judge 会漏报**:B 类 judge 报 11 场,确定性判据实测 14 场。
3. **聚合前先确认没有在飞的子代理** —— 本轮曾在 judge 还在跑时就发布数字。
4. **本机 jsdom 没有 `localStorage`,CI 有** —— 依赖持久化的测试会本地红 CI 绿。
5. **`report-*` 视觉基线改了 report UI 就要重生成** —— 走 `visual-baseline.yml`,
   本机跑 `test:visual` 必假红。
6. **复合命令里绝不 `cd`**;**门禁链里绝不加管道**(退出码会变成 tail 的)。

## 工程约定

不在此重复 —— 单一真源见 `CLAUDE.md`(提交方式、`npm run presubmit`、谓词单源、
修复要给前后数字)与 `docs/commands/eval-*.md`(eval 产物位置、判分模型固定 sonnet)。
