# 2026-07-20 复盘 — prompt 自相矛盾缺陷的八类修复与盲评 A/B

> 归档记录(原为两份 HANDOFF,工作完成后合并)。**技术根因已就地写进相关代码的注释**
> ——改那段代码时自然会读到,不必回来翻本文。本文保留的是**实测数字**与
> **两次错误结论的经过**,那两类内容不属于代码注释。
>
> 相关单一真源:`CLAUDE.md`(谓词单源、修复要给前后数字)、
> `docs/commands/eval-ab.md`(MDE 与裁决规则)、`docs/BACKLOG.md` 第 14 节(遗留)。

## 一句话结论

八类 prompt 内部自相矛盾缺陷全部修复,**每类都有同一判据下的前后数字**。
随后的盲评 A/B **没有检出教练质量提升**(七维全 inconclusive,含目标维度 accuracy)——
采纳依据是确定性指标,不是 A/B。任何把本轮读作「A/B 验证通过」的说法都是错的。

---

# 第一部分 · 八类缺陷修复

## 修复总表

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


---

# 第二部分 · 盲评 A/B(模型侧验证)

### 本轮结论

**盲评没有检出教练质量提升(七维全 inconclusive,含目标维度)。
采纳依据是确定性指标,不是 A/B。** 任何把本轮读作「A/B 验证通过」的说法都是错的。

## 为什么会有这一轮

上上个会话把 8 类 prompt 缺陷全修了,并用**确定性文本判据**验证(A 26/50→0、
B 14/50→0、C 2/50→0、E/G 4/33→0、D 1/50→0、F 0→86/159 行、H/I 已修)。

但那只证明了 **prompt 内部自洽**,没证明**教练质量变好**。这轮盲评 A/B 是补第二重证据。
上一会话在**子代理配额 200/200 用尽**时停在 6/100,本会话补齐了剩下 94 件。

## 结果

EVAL_HOME = `/Users/mingjianliu/code/gladlog-eval-private`
abId = `2026-07-20-prompt-defects`;产物已 commit(私有仓 `ac73af4`)。

### 盲评统计(50 对,100 件,全 sonnet)

| 维度                 | control | treatment | Δ (95% CI)               | p     | 判定         |
| -------------------- | ------- | --------- | ------------------------ | ----- | ------------ |
| **accuracy(目标)**   | 4.44    | 4.14      | **−0.30 [−0.66, +0.06]** | 0.243 | inconclusive |
| sufficiency          | 4.82    | 4.72      | −0.10 [−0.28, 0.06]      | 0.774 | inconclusive |
| noise                | 4.70    | 4.74      | +0.04 [−0.12, 0.20]      | 0.815 | inconclusive |
| labelBias            | 4.88    | 4.90      | +0.02 [−0.10, 0.14]      | 1.000 | inconclusive |
| inferenceScaffolding | 4.86    | 4.92      | +0.06 [−0.10, 0.20]      | 0.508 | inconclusive |
| outcomeAlignment     | 4.98    | 4.96      | −0.02 [−0.10, 0.04]      | 1.000 | inconclusive |
| focusCalibration     | 4.98    | 5.00      | +0.02 [0.00, 0.06]       | 1.000 | inconclusive |

零 CI 回归、零新问题 —— **两臂 350 个维度分(50 对 × 7 维)无一 ≤2**。
accuracy 点估计为负,按工作流标记 (inconclusive — monitor),不算回归。

### 确定性指标(采纳依据)

| 指标                                         | control               | treatment            |
| -------------------------------------------- | --------------------- | -------------------- |
| hard-failure 行数                            | **185**               | **0**                |
| 含 ≥1 条 hard failure 的场次                 | **80 / 98**           | **0 / 98**           |
| A DMG SPIKE↔STATE HP 分叉                    | 71 行 / 51 场         | 0                    |
| B 基线百分位倒置                             | 27 行 / 27 场         | 0                    |
| C `[CD]` 内嵌 HP↔STATE                       | 77 行 / 52 场         | 0                    |
| E/G 窗口时长与起止不符                       | 10 行 / 10 场         | 0                    |
| coverage(deaths/cc/interrupt/trinket/dispel) | 100/100/100/100/98.0% | 未回退               |
| approxTokens (p50)                           | 4970                  | 5218(**+5.0%**,代价) |

**Decision: ADOPT —— 凭确定性,不凭盲评。**
理由:修的是 prompt **内部自相矛盾**,危害不在当场扣分(上轮实证 46/50 场报缺陷、
仅 1 场 flagged,因为 responder 多数时候自行识破绕开),而在于**正确性依赖模型恰好
足够谨慎**,且 ord 043 已观察到从「识破弃用」滑向「引用转述」。修掉矛盾是移除这份依赖。

## 本轮最有价值的产出是方法论,不是分数

### 1. accuracy 的判官噪声底 SD = 1.30 —— 这一维作 A/B 目标近乎失效

accuracy 在 **36/50 对上变动,其中 17 对跳 ±2**,配对 SD **1.30**,
是其余六维(0.14–0.65)的 **2–9 倍**。同一份底层对局、同一个判官模型。
**在这个噪声下 |Δ| < 0.4 根本测不出**,本轮无力拒绝 −0.30。

→ 建议把 accuracy 锚点**绑定到 `factAudit` 的 refuted 条数**(0 条→5,
1 条非承重→4,1 条承重或 2 条→3),把自由裁量换成计数;或同件多判取中位。

### 2. sufficiency 判官盲区 20%(校准实测)

注入手段「删掉整场死亡行」,5 件里 **4 件判官给分持平或更高**(5→5、5→5、5→5、4→5)。
**该维盲评无裁决权**,只能由确定性覆盖门裁决。这是跨轮次的方法论债。

> 两条合起来:**七维里有两维目前不具裁决力。** 下一轮 A/B 选目标维度时必须考虑这点。

## 遗留待办

已全部转入 `docs/BACKLOG.md` 第 14 节(eval / QA 体系遗留),不在此重复。

## 盲评纪律(本轮全程遵守,后续沿用)

1. **不读 `blind/mapping.json`** —— 全部分数落盘前不读,报错也不读,「核实一下」也不读。
   只有 `abStats` 读它。本轮直到 100/100 才首次读取。
2. **不读盲件内容、不读 `blind/scores/*.json`** —— 齐全与否只用 `ls` 判断。
3. **编排会话绝不亲自评分。** 实现了被测改动的会话一眼就能认出臂别
   (A 类同秒 HP、B 类倒置基线、F 类 DR 标注都是显眼特征),打的分是自评不是评测。
4. **不得基于子代理返回的摘要选择性重派或剔除任何一件。** 完成通知里带评分摘要,
   这是唯一能让编排者无意中污染对比的通道 —— 只按「文件在不在」补派。
5. **判分模型固定 sonnet。** 校准是对 sonnet 做的,换模型则校准失效;
   已落盘的件也是 sonnet 打的,混判会毁掉配对统计。agy 的位置在报告写完后做跨 AI 复核。


---

# 第三部分 · 踩过的坑(两轮累计,已去重)

## 分析/修复侧

1. **「两处数值不一致」先问查的是不是同一时刻,再问容差。** A 类第一版修复栽在这上面。
2. **别只查一个样本就外推整类。** D 类栽在这上面。
3. **缺陷线 ≠ 分数线** —— 46/50 场报了缺陷却只有 1 场 flagged;responder 多数情况
   自行绕开矛盾数据,`accuracy` 反而高分。缺陷必须单独收集。
   **且 judge 会漏报**:B 类 judge 报 11 场,确定性判据实测 14 场。

## eval 编排侧

4. **子代理配额是硬墙**(本会话 200/200),撞上只能换会话或提配额 —— 开工前先确认。
5. **派子代理时 NNN/ITEMID 写错没有任何东西当场挡住。** 曾把 041 派成 031,
   靠事后完整性检查才发现。派完必做 ordinal↔MATCHID 核对。
6. **聚合前先确认没有在飞的子代理。** 曾在 judge 还在跑时就发布数字,
   后到结果改变了两维均值,只能补勘误。
7. **七维分数不可作跨 run 绝对刻度**,除非跑过 `/calibrate-judge`。
8. **跨 AI 复核要核对它复述的前提**,不只是结论。agy 本轮给出斩钉截铁的 REJECT,
   算术全对,但把「185 **条**硬失败行归零」读成「一个行号」,还虚构了
   「accuracy 是五个子维度求和」这个前提。它读错时语气与读对时无异。

## 工程侧

9. **本机 jsdom 没有 `localStorage`,CI 有** —— 依赖持久化的测试会本地红 CI 绿。
10. **`report-*` 视觉基线改了 report UI 就要重生成**;本机跑 `test:visual` 必假红。
    另:该套件的 `report-replay` 场景本身 flaky,见 BACKLOG 14.1。
11. **复合命令里绝不 `cd`**;**门禁链里绝不加管道**(退出码会变成 tail 的)。
12. **私有 eval 仓可能有非本会话产生的未提交改动** —— 提交用显式路径,绝不 `git add -A`。
