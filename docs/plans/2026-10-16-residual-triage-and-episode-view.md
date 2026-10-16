# 抽象层的前两步:残差分类 → episode 视图(工单,2026-10-16)

> 写于云端会话,那里没有 eval-private、没有 605 文件 capture、没有对局库——所以这两步**都要在本机跑**,这里只把口径、顺序和验收写死,免得本地会话重新组装一遍。背景:事实层两周(PV192 → PV401)之后用户说「上面更抽象的那一层其实还没有做」;方向约束见 `.claude/knowledge/fact-layer-direction.md`(不拍脑袋加指控、价值门先行、行级 prompt 增删低于噪声底是伪优化、GH #49 不做)。

## 第 0 步:把残差分类(半天,不改代码)

**问题**:self-review 之后剩下的错(51 份 PV395 输出,WRONG 48 → 15)是哪一类的?这个数字决定下一层的形状;没有它,做 episode / 扩 self-review / 继续事实层都是猜。

**输入**:`$GLADLOG_EVAL_HOME/runs/s61-selfcheck-2026-10-15` 的同轮盲审结果(15 条 WRONG),**或者**同一批 51 场在 PV401 上重跑一次再盲审(优先:PV396–401 动了被压友方、FADED 副本、锁内按键这些事实,s61 的 15 条里可能有已经修掉的)。两者取一,写明用的是哪个。

**四分类,按这个顺序判,第一个命中即归类**(每条 WRONG 只进一类;判不了的单独记「判不了」,不许硬塞):

| 序 | 类 | 操作定义(逐条问) | 证据 |
|---|---|---|---|
| 1 | **日志给不了** | 这句话要成立所需的事实,raw.txt 里根本没有(意图、朝向之外的视线高度、未录制者的 CAST_FAILED、宠物死活…) | 指出缺的字段;对照 `docs/log-observability-audit.md` |
| 2 | **输入错** | 事实在日志里,但 prompt 里那一行印错 / 没印 / 印到错的秒 | 引用 prompt 行 + raw 行;能落成 `promptQualityCheck.ts` 的一个 `check*` 就记下类名 |
| 3 | **表示形式错** | prompt 每一行都对,但模型把两行隔开的事实读串了(GH #110 的 T3「没有哪行渲染这个状态」、T4「两行相隔矛盾」、T9「5 秒窗读成整个 debuff」) | 指出哪两行 / 哪个窗口;这是 episode 视图要吃的那类 |
| 4 | **模型错** | 事实对、表示清楚、模型仍写错(算术、归因、把图例当事实) | 剩下的 |

**输出**:一张 15 行表(或重跑后的 N 行),列 = 场次、finding 序号、原句、类、证据、「能不能进 hardFailures」。放 `$GLADLOG_EVAL_HOME/reports/residual-triage-<date>/`。

**决策规则(写在报告末尾,别留给读者推)**:
- 类 2 ≥ 1/3 → 事实层没到头,下一轮还是 FT 工单;每条能进 `hardFailures` 的先进。
- 类 3 ≥ 1/3 → 做第 1 步。
- 类 4 占大头 → self-review 加码(多轮 / 换判据),**不是**新 prompt 措辞(`prompt-honesty.md`:确定性门 > 调措辞)。
- 类 1 占大头 → 记负结果,这批错不归产品;看是不是 `docs/log-observability-audit.md` 该补一行。

**不许**:顺手修;只分类。分类时发现的类 2 缺陷开 GH issue,不在本步落代码。

## 第 1 步:episode 视图(只在第 0 步类 3 ≥ 1/3 时做)

**它是什么**:同一份 prompt 的**另一种排列**——把现有事实行按 episode 分块(状态前 → 动作 → 结果),块与块之间的行放「块间带」。**零新判断、零新文本**:每一行的字节不变,每一行恰好出现一次,多的只有块头。这把它和「行级增删」(已量过是伪优化)区分开:动的是结构,不是一行。

**episode 的四种,全部用现成谓词,探针 / 视图只 import**(共享谓词规则):

| 种类 | 开窗谓词 | 块头 | 状态前 | 结果行 |
|---|---|---|---|---|
| 危机 | `analysis/crisisDecisionPoints.ts` → `crisisDecisionPoints` | `[EPISODE crisis <unit> m:ss–m:ss]` | 该秒的 `[STATE]` + 一整行 `[RES]`(B14b 已给 [OFFENSIVE WINDOW] 做了,照抄) | `[CONSEQ]` / `[DEATH]` / crisis 的回应事实 |
| 敌方爆发 | `analysis/burstWindowDecisionPoints.ts` | `[EPISODE burst by <enemy> m:ss–m:ss]` | 同上 | `[BURST ANSWERED]` / 死亡 |
| 击杀尝试 | `utils/killAttempts.ts` + `utils/offensiveWindows.ts` → `computeOffensiveWindows` | `[EPISODE kill attempt on <enemy> m:ss–m:ss]` | 同上 | KILL ATTEMPTS 那一行的结果子句 |
| 治疗被锁 | missed-sync-window 用的 healer lock(`[CONSEQ]` 行的来源,`utils/ccTrinketAnalysis.ts` 的配对) | `[EPISODE healer lock m:ss–m:ss]` | 同上 | `[CONSEQ]` |

重叠的 episode:按开始时间,后开的嵌在先开的里(一层,不递归);一行落在多个 episode 里时归**最内层**。块间带保留原顺序。

**先做什么(价值门第 1 条)**:在改任何渲染之前,拿 1–3 场真实对局,用 `packages/eval/scripts/acceptanceCapture.ts --context-dir` 落盘的 context,手工(或一次性脚本)排成 episode 形态给用户看。用户不点头不接线。

**接线位置**:`context/matchTimeline.ts` → `buildMatchTimeline` 之后的一层 `episodeView(lines, episodes)`;开关走 `buildFindingsPrompt` 的参数,默认关,`PROMPT_VERSION` 不动直到裁定上线。

**确定性验收(先于任何模型调用)**:
1. **置换性**:605 文件 capture 上,episode 视图的行多重集 = 线性时间线的行多重集 + 块头。做成测试(`packages/analysis/test/episodeView.permutation.test.ts`)和一个 `promptQualityCheck.ts` 的 `check*`(块头之外没有新行、没有少行)。不满足 = bug,不是设计空间。
2. **块头自洽**:块头的秒与它包住的第一 / 最后一行的秒一致(同 `[OFFENSIVE WINDOW]` 头的门规写法)。
3. **零候选变化**:菜单行逐类计数 before = after(视图不碰候选层;碰了就是接错了地方)。

**效果验收(确定性指标,不用判官分)**:
- 结论集合 Jaccard(线性 vs episode)对比**自比噪声底**(同 prompt 跑两次的 Jaccard;方法在 `docs/reports/2026-08-24-prompt-line-probe-method.md`,工具 `packages/eval/scripts/promptProbeCompare.ts` / `promptAblationProbe.ts`)。预注册 n 和 MDE(`llm-eval-method.md`:欠功效的 run 不许写「无回归证据」)。
- `hardFailures` 的同秒矛盾类计数 before / after。
- 第 0 步的类 3 那几条,在 episode 视图下重跑:错还在不在。这是最直接的判据,n 小但是定向的。
- 两个模型家族各跑一遍(同族偏差 +0.84 已实锤)。

**裁定**:Jaccard 差超过噪声底 **且** hardFailures 不变坏 **且** 类 3 残差至少一半消失 → 提交用户裁上线;否则写负结果进 GH #110,视图代码留在开关后面不删(它是 #110 的第一份证据)。

**不做**:新候选类型、新阈值、把 episode 当指控(「这个 episode 你没回应」已经是 crisis-no-response,别做第二遍)、专家标注数据集(GH #49,已裁不做)。

## 第 2 步(先登记,不在本工单内)

GH #85 目标切换时间线——事实层原语,又是 ~25 条教练规则和 GH #68「换个打法」模式的前提。定义陷阱(窗口长度、份额阈值、cleave / DoT)在 issue 里;单源导出、所有消费者只 import。等第 0 步的数字出来再排。
