# HANDOFF 2026-07-20 — prompt 数据缺陷修复

> 50 场 healer eval 挖出的 8 类缺陷,**7 类已修并验证,剩 D 类未修**。

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
| **D** | **冷却台账自相矛盾(1 场)**               | —              | **未修**   | —         |

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

- `checkPercentileMonotonicity` —— 同行百分位必须单调不减
- `checkSameSecondHpConsistency` —— 同秒同单位 HP 必须一致(容忍 3pp);
  A 类的 `X% -> Y% HP` 与 C 类的 `→ 目标 (X% HP)` 共用这一套判据
- `checkWindowSpanConsistency` —— 标注时长必须等于显示起止之差

这些判据**不依赖模型**,是本轮所有 A/B 的度量工具。复现方法:

```bash
npx tsx packages/eval/scripts/buildCorpus.ts \
  --manifest <50 条日志清单> --run <runId>
# 然后对 runs/<runId>/prompts 跑上面三条判据
```

## 千场管线复验(改动全部落地后)

`pipelineFuzz --count 1000 --run fuzz-2026-07-20-postfix`:

```
{"files":1000,"parseFail":0,"matches":695,"rounds":1830,"combatsAudited":2525}
229 findings —— 全部为 cjk:*(CN 服玩家名,合法),与改动前那轮数量完全一致
```

无新增 finding 类别、无解析失败、无异常 —— 本轮改动未引入管线回归。

---

## 未完成:D 类冷却台账自相矛盾(1 场)

死亡块的 `[RES]` 冷却台账与「DEATHS WITH MISSED OPTIONS」对**同一个冷却**的
可用性判断相反。

**已确认的事实**(实例:`003-c5f8395a.txt` @ 2:03):

- `[RES]` 台账的 `rdy:` / `cd:` 两列**都没有 Lay on Hands**,即该路径完全不
  跟踪这个技能
- 同一时刻 MISSED OPTIONS 却写「had Lay on Hands available」
- 两条路径用的是**各自独立维护的技能清单**:missed-options 走
  `deathOutcomeAnalysis.ts` 自有的 `EXTERNAL_DEFENSIVE_SPELLS` /
  `IMMUNITY_SPELLS`;`[RES]` 台账走 `extractMajorCooldowns`

**未坐实的部分**:`[RES]` 台账的技能清单具体由哪份数据驱动,我没查到底
(排查中一度误以为是 `SPELL_CATEGORIES`,但那份只存 CC/定身/免疫,不是
防御台账的来源 —— 别沿用这个错误前提)。下一步应先确定 `extractMajorCooldowns`
的清单来源,再比对两份清单的差集。

**注意:这属于白名单腐烂类,不能拍脑袋改。** 按 CLAUDE.md 与 desktop-dev
skill,动任何 spell-id 白名单前必须先做**语料实证**(SPELL_CAST_SUCCESS 挖掘、
per-spec 率、冷却/持续时长用语料实测),否则会把一个不一致换成另一个。
而且给 `[RES]` 台账新增追踪技能会改动**每一份含帕拉丁的 prompt**,不是小改。

## 其它已知陷阱(踩过的)

1. **七维分数不可作跨 run 绝对刻度** —— 未跑 `/calibrate-judge`,judge 间口径
   不一致。本轮所有结论改用确定性判据,不依赖分数。
2. **缺陷线 ≠ 分数线** —— 46/50 场报了缺陷却只有 1 场 flagged;responder 多数
   情况自行绕开矛盾数据,`accuracy` 反而高分。缺陷必须单独收集。
   **且 judge 会漏报**:B 类 judge 报 11 场,确定性判据实测 14 场。
3. **聚合前先确认没有在飞的子代理** —— 本轮曾在 judge 还在跑时就发布数字。
4. **本机 jsdom 没有 `localStorage`,CI 有** —— 依赖持久化的测试会本地红 CI 绿。
5. **`report-*` 视觉基线改了 report UI 就要重生成** —— 走 `visual-baseline.yml`,
   本机跑 `test:visual` 必假红。
6. **复合命令里绝不 `cd`**;**门禁链里绝不加管道**(退出码会变成 tail 的)。

## 工程约定

- 提交:**直接 commit + push 到 main**,不建分支不开 PR;CI 红了再修
- 提交前:`npm run presubmit`
- eval 产物在 `$GLADLOG_EVAL_HOME`(默认 `~/code/gladlog-eval-private`)
- responder/judge 批量子代理一律 **sonnet**;agy 用于跨 AI 复核
