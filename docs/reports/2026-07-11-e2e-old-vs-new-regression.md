# E2E 全量回归对比:旧软件 vs 新软件(用户全部自采语料)

日期:2026-07-11
语料:`~/code/gladlog-eval-private/corpus/manifest-full.txt`(70 份日志,6.8GB,用户 1000+ 场)
方法:双引擎并行——旧 fork(旧 parser + 旧产线 buildMatchContext)vs gladlog(新 parser + compat + timeline 变体产线),(文件, 序号) 死亡签名 LCS 对齐。
harness:`wowarenalogs/scratch/parser-diff/{runFullLevel1.sh,runFullPrompts.sh,runPrompts.ts}` + `scratchpad/e2e/{compareLevel1,comparePrompts}.mjs`。

## A. Level-1 核心事实(1190 场对齐)——零事实回归

| 维度                               | 结果                                                                                                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 结构字段(切分/名单/spec/队伍/胜负) | 单位集合 mismatch 0;胜负翻转 **4**                                                                                                           |
| 4 处翻转裁定                       | **agy(Gemini)跨家族仲裁:4/4 新对旧错**——2 例旧把假死(unconscious=1)当首死判负,2 例亚秒双死判序错。附裁决见 `scratchpad/e2e/flip-evidence/`。 |
| 新侧多救回                         | +55 场(未闭合洗牌段 / 掉线场次,新 salvage 路径救回)                                                                                          |
| 旧侧多出                           | 2 场(实为旧侧少记 1 名玩家致对齐键不合,M4 #1-5 类旧缺陷)                                                                                     |
| 治疗总量                           | 中位 0.00%,p90 0.00%(完全对齐)                                                                                                               |
| 伤害总量                           | 中位 2.98%,p90 12.4%(M4 #14/#19 已裁决包络内;离群全为旧侧宠物漏并,旧偏低)                                                                    |

**结论**:M4 抽样(200 份)的"599/600、零未裁决差异"结论在全量 1190 场复现。核心事实层新 parser 无回归,4 处胜负更正对用户直接有利(战绩判定更准)。

## B. Prompt 层对比(1192 配对)——3 处回归,全部由 timeline 变体 ADOPT 引入

token:旧 3165 / 新 5313(timeline 变体更富)。Result 字符串差 92 处 = owner 视角计算(solo shuffle 旧选记录者、新选被教练治疗)+ 上述 4 处翻转,非回归。

段落普查(旧有、新无,出现 ≥5 次)定位到三处**真回归**,根因两类:

### R1 [High] 死亡结局块整体丢失(`DEATHS WITH MISSED OPTIONS` + 死亡时免疫可用)

- 旧侧 139 场有,新侧 **0**。
- 内容:队友在你死亡时手里**可用但未放的救人外置**(Pain Suppression / Lay on Hands 等),及死者自己当时可用的免疫。
- 根因:`buildMatchContext.ts` 的 `useTimelinePrompt` 分支在 **526 行提前 return**,而 `deathOutcomeBlock`(`formatDeathOutcomeForContext`)在 **992 行** append。分析已算出(246 行 `buildDeathOutcomeSummary`,含 LoH via `EXTERNAL_DEFENSIVE_SPELLS`),只是 timeline 路径永不渲染。
- **修复**:把 deathOutcomeBlock 移到 timeline 分支内(或 return 前)。低风险、高价值——这是教练"如何避免这次翻盘"的核心事实。
- 注:新 `[DEATH]` 行有 `(Unused: X)`,但只列**死者本人**的冷却,不枚举队友外置——覆盖 62/139。

### R2 [Medium] `NEVER USED` 冷却显式标记丢失

- 旧侧 1080 场有(`STATUS: NEVER USED` / `[X]: NEVER USED — 全场可用`),新侧仅 47(边缘 sparse 回退)。
- 根因同 R1:`[UNUSED]` 标记逻辑(813 行 `if (cd.neverUsed)`)在 526 行 return 之后。timeline loadout 列了冷却但不标"整场未用"。
- 影响:模型只能从"技能没出现在时间轴"隐式推断,弱于显式标记。

### R3 [Medium] `ABILITIES INTO IMMUNITY/DR` 未移植

- 旧侧 228 场有,新侧 **0**;gladlog 代码内无非死亡路径的等价特征。
- 内容:进攻技能打进敌方满 DR / 主动免疫(如"审判 + 公正之剑 打进敌方 DK 的痛苦压制")——浪费 GCD 的目标选择教练点。
- 与 R1 不同:这是**真未移植**,不是渲染门。需新建特征(offensive-into-immunity 扫描)。

次要:Lay on Hands 不在 `extractMajorCooldowns` 的通用 loadout 列表(装饰缺口;死亡外置表已有,R1 修复即恢复其死亡标注)。

## C. Meta-eval(agy / Gemini 3.1 Pro,跨家族 role-play)

对含死亡的配对 214211#003(队友 1:49 死翻盘)做旧-新盲比,独立复现:

- 确认 R1(LoH/队友外置在新侧死亡处缺失)、R3(打进免疫丢失)。
- **额外发现旧侧一处自相矛盾**:旧 prompt 第 40 行"No major defensive CDs available"与第 165 行"Pain Suppression available"直接冲突——旧的硬编码人读摘要会误导 LLM 替治疗开脱;新侧用原始 `[RES] rdy:Pain Suppression[2/2]` 快照修掉了这个矛盾。
- **净判定:新 prompt 对核心教练问题更优**——时间轴施法序列 + 精确 [RES] 状态快照 + 走位(1:42 起被 DK 0.6 码贴身)让教练能还原"被近战贴脸致慌乱、忘开外置"的实战情境;旧侧扁平数据做不到。R1/R3 是新侧在净优基础上的可修补短板。

## 处置

- R1 + R2 共根(526 行提前 return 丢两个 sparse-only 块)→ 一次修复,列入 app/prompt backlog。
- R3 新特征 → 走 `/eval-ab`(目标维度 accuracy / focusCalibration),列入 prompt feature backlog。
- 4 处胜负更正、55 场多救回 = 新侧净收益,无需处置。


## 修复确认(2026-07-11,commit 2ee7ee2)

R1 + R2 已修(同根因:timeline 分支提前 return 漏渲染两个 sparse-only 块):
- R1 死亡结局块移入 timeline 分支;R2 `buildPlayerLoadout` 给整场未放冷却打 `[UNUSED]`(owner + 队友,旧侧 owner-only 的严格超集)。
- 全量回验(1245 prompt 重生成):R1 覆盖 139→**150**,R2 1080→**1106**,均恢复并略超旧侧;token +12/场(+0.2%)。analysis 491 测试绿。
- 翻盘场 214211#003 印证:恢复"死亡时队友 Pain Suppression / Lay on Hands 可用"事实 + 暴露治疗攥两层压制未放。

R3(进攻打进免疫)待定:`buildOffensiveWasteSummary` / `formatOffensiveWasteForContext` 已 import 并在构建器计算,疑似同类渲染门而非真未移植——待核实后单独处置。
