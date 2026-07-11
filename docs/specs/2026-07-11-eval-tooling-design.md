# 子项目 4b:eval 工具链 设计

日期:2026-07-11。前置:4a(应用内 AI 分析)已完成——`@gladlog/analysis` 提供 `buildMatchContext` prompt 管线与 benchmark 基建。

## 目标

把旧工作仓实战验证过的 prompt/分析质量评测方法论落到 gladlog:**基线评测、A/B 迭代、judge 校准**三条工作流。代码进公仓,语料与 run 历史进私有姊妹仓。

**范围外**:prompt feature 对齐(POSITIONING/HEALER EXPOSURE/CONTESTED 等旧后期 feature——正是 4b 建成后 A/B 环的迭代素材)、playstyle/archetype/geometry 附属工具、CI 集成、API 模式 responder/judge(见"契约与未来扩展")、回归门 golden-case 体系(首个 A/B 周期时随需引入)。

## 关键决策(brainstorm 定案)

| 决策点   | 定案                                                                         |
| -------- | ---------------------------------------------------------------------------- |
| 范围     | 层 1+2+3:基线环 + A/B 环 + judge 校准                                        |
| 执行形态 | Claude Code 子代理扮演 responder/judge(零 API 费用),agy 跨家族抽审           |
| 私有侧   | 私有姊妹 git 仓,`GLADLOG_EVAL_HOME` 定位(默认 `~/code/gladlog-eval-private`) |
| 移植策略 | 新包 `packages/eval` + 控制器最小提取(~1.8k 行 TS + ~800 行工作流文档)       |

## 架构

### 公仓 `packages/eval`(依赖 parser / parser-compat / analysis)

| 模块          | 职责                                                                                                                                   | 来源                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `corpus/`     | prompt 语料构建:私仓日志清单 → `GladLogParser` → `toLegacyMatch` → `buildMatchContext`(healer owner 视角);语料指纹 = 场数+首尾 matchId | `buildHealerPromptCorpus.ts`(324L)适配                                                         |
| `quality/`    | 确定性指标:死亡/踢断/CC/饰品/驱散覆盖率——**裁剪到 gladlog 现有 prompt feature 集**                                                     | `promptQualityCheck.ts`(287L)裁剪                                                              |
| `ab/`         | 分层配对抽样、盲评池目录隔离、均值差 bootstrap CI + 符号检验                                                                           | `blindAbPool.ts`(130L)+ `abCompareStats.ts`(189L)                                              |
| `judge/`      | 7 维锚定 rubric、校准套件构建(植入缺陷)、校准判分                                                                                      | `buildJudgeCalibrationSuite.ts`(348L)+ `checkJudgeCalibration.ts`(188L)                        |
| `provenance/` | score 文件完整性校验(7 维整数 + 3 条 factAudit + sha256 信封,缺一 run 作废)、judge-spot-audit(agy 跨家族)                              | `check-score-provenance.mjs`(86L)+ `judge-spot-audit.mjs`(121L)+ `calibrate-auditor.mjs`(164L) |

7 维:sufficiency / noise / labelBias / inferenceScaffolding / accuracy / outcomeAlignment / focusCalibration;另 factAudit(3 条数值主张逐条溯源)。rubric 文本随工作流文档移植。

### 公仓 `.claude/commands/` 三条工作流

`eval-baseline.md` / `eval-ab.md` / `calibrate-judge.md`(源:旧 `docs/commands/` 三件,~800 行)。responder 与 judge 均为子代理扮演;**judge 不通过 stdout 交付**——子代理用文件写工具直接落 score JSON,harness 只校验文件(旧体系 80 盲评规模 80/80 有效的实证机制);无效文件的重试单元 = 单个 judge 重派。

### 私仓 `gladlog-eval-private`(自有 git)

```
corpus/    # 自采日志清单 + 构建出的 prompt 语料
runs/      # 每 run 一目录:prompts/ responses/ scores/ report.md
ab/        # A/B run(控制/处理臂目录隔离,盲评池)
ledger.md  # append-only 台账(规则沿旧体系:只增行、语料指纹、mean±SD)
```

台账**新开**:绝对分与旧台账不可比(prompt feature 集、responder 模型均变),可比的只有方法论。旧台账留在旧 fork。

## 数据流(基线环)

私仓日志清单 → 语料构建 CLI(公仓)→ prompts 落 run 目录 → responder 子代理跑批(response 落盘)→ 盲评 judge 子代理(score JSON 落盘)→ 溯源校验(全量通过才有效)→ 确定性指标汇总 → report.md → 台账追加一行。

A/B 环:同一语料两臂构建(控制=main、处理=分支),分层配对,盲评池打乱臂标签,统计 = 目标维度均值差 CI + 符号检验;裁决纪律沿旧体系(INCONCLUSIVE 可依确定性 grounding/安全性理由 ADOPT,须在台账记明依据)。

## 合规与移植纪律(debate 让步条款,硬性)

1. **逐文件 CLEAN 验证**:每个待提取文件先对照子项目 0 合规审计确认自有原创,才由控制器复制进 gladlog;无法证明自有的文件**不移植**,按方法论笔记重写。
2. 实现者(agy/subagent)不得读取旧 fork 任何文件;控制器交付。
3. 测试契约 Claude 写,实现走既有降级链,绿灯独立验证(看退出码)。
4. 移植零逻辑改动:统计/抽样/rubric 语义以旧源为准,只改 import 面与数据形状适配;任何行为分歧按旧源裁决(与 4a 同则)。

## 错误处理

- score 文件缺维度/缺 factAudit/缺 sha256 → 该 run 作废(不降级为部分有效)。
- 语料指纹不匹配的两个 run 拒绝对比。
- `GLADLOG_EVAL_HOME` 未设置、目录不存在或非 git 仓 → CLI 拒跑并给初始化指引。
- 校准套件每次从当前语料再生;引用被裁剪 feature 的缺陷类与检查器一并排除,随 feature 经 A/B 落地后一起回归。

## 契约与未来扩展

score 文件契约(JSON schema:7 维整数、factAudit 数组、sha256 溯源信封、judge 模型标识)与执行器无关——将来加 API 模式 responder/judge 不需要重新设计,只是 v1 不做。

## 测试策略

- A/B 统计:golden 数值契约(固定输入 → 已知 CI/符号检验 p 值)。
- 校准套件构建器:植入缺陷可被断言检出;被排除缺陷类不出现。
- promptQualityCheck:用 4a 真实 fixture 断言覆盖率计算。
- 溯源校验器:坏文件用例(缺维度/缺信封/坏 sha256)逐类拒绝。
- 语料构建:desktop fixture 端到端,断言指纹格式与 prompt 非空。

## Debate 记录(agy Gemini 3.1 Pro,2026-07-11)

OPPOSE→PARTIAL(修订条款下四点全让步)。让步给对方:①逐文件 CLEAN 验证入 spec 为硬条款;②校准缺陷类随裁剪 feature 一并排除;③score 契约执行器无关。守住:①子代理扮演机制(对方误解为 stdout 解析,文件交付+80/80 实证驳回);②拒绝 Batch API 重写钢人(成本非零 vs 订阅内零边际,统计边角处理两个月实战沉淀不可弃)。
