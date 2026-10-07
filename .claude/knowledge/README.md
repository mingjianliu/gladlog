# gladlog 维护者工作笔记(公开精选)

这是维护者私人工作笔记中可以公开的一部分:方法论、领域知识、工作偏好。每条都来自具体的事故或用户裁决,日期一律写绝对日期。它是背景,不是规范——**和代码、`CLAUDE.md`、`docs/` 冲突时以后者为准**;状态类说法(「已上线 / 待裁」)可能过期,动手前先查代码和 `gh issue list`。

## 方法论

- [verification.md](verification.md) — 「修好了」要同判据前后数字;机制 ≠ 因果;检查器 / 探针 / 测试自己先验证
- [predicates-and-gates.md](predicates-and-gates.md) — 渲染网格与 raw t 例外、指控集 vs 回应集、候选门被富上下文绕过、三态可行性门
- [metrics-and-discrimination.md](metrics-and-discrimination.md) — 判别力按机会归一化、尺度压缩 ≠ 一致性、bracket 分层、小样本外推
- [official-data-first.md](official-data-first.md) — 官方 DB2 优先但要双向实测、真值集必须双向、语料清洗必须确定性、种族只能被动确立
- [value-gate-first.md](value-gate-first.md) — 先给真实对局的输出例子再做工程;归因从目标结论句倒推
- [fact-layer-direction.md](fact-layer-direction.md) — 当前方向:事实层与解析,不做拍脑袋的新指控;事实行样板;走过的路
- [llm-eval-method.md](llm-eval-method.md) — 判官噪声与盲区、A/B 预注册、prompt 逐行探针结论、用本地 CLI 验证、评测模型选择
- [prompt-honesty.md](prompt-honesty.md) — 确定性门 > 调措辞;范例数字、占位符 smoke、JSON 容错、causalLint
- [batch-fix-workflow.md](batch-fix-workflow.md) — 小批修 + 集中回归、采集对照的坑、PV 撞号、参照表攒着重跑、收尾报告
- [review-tiering.md](review-tiering.md) — 高 / 低风险审查分级、何时找审查、委派机械活给第二个 AI 的做法
- [shell-and-git-traps.md](shell-and-git-traps.md) — 管道吞退出码、zsh 语义、共享 checkout、worktree、子代理、整机负载

## 领域知识

- [combat-log-parsing.md](combat-log-parsing.md) — 时间戳 / nil 目标 / 单排换队 / 伤害符号;事件字段实测布局;absorbsIn 两层;召唤物按 GUID 归因
- [log-observability.md](log-observability.md) — raw.txt 保留约束、旧解析的本地库、[STATE] 取值规则、各方向结论
- [db2-data-semantics.md](db2-data-semantics.md) — PvpMultiplier、tooltip 占位符、SpellMisc 属性位、充能两个数、外部数据源
- [season-data-refresh.md](season-data-refresh.md) — 时代门与 DR 窗口、补丁说明审读、控制时长读 DB2、datagen 坑
- [whitelist-rot.md](whitelist-rot.md) — 施法 / 光环双 id、串联白名单、赛季换号;「加进表 ≠ 看得见」
- [cooldown-model.md](cooldown-model.md) — 容差单源、proc 不算按键、三态就绪 + 动态 CDR、进攻大招追踪
- [dispel-cc-mitigation.md](dispel-cc-mitigation.md) — 驱散两半、DR / 定身、减伤表 positional 契约、签字册、反事实
- [talent-data.md](talent-data.md) — 天赋接入架构、所有权判定、两种修正编码、覆盖缺口文档
- [range-los.md](range-los.md) — 射程 / 视野的日志真值、hold-out 教训、reach 表所有权
- [signal-research-conclusions.md](signal-research-conclusions.md) — 已退役 / 负结果信号的原因,救人 CD 名单判据
- [coaching-rulings.md](coaching-rulings.md) — 用户裁过的指控口径:伤害看需求、3v3 首死、身份准确性、击杀与饰品
- [perf.md](perf.md) — 大 JSON 走 JSON.parse、对局库规模与无上限路径
- [desktop-ui.md](desktop-ui.md) — renderer 架构模式、布局坑、测试台、功能定论、有意偏离
- [test-build-ci.md](test-build-ci.md) — ensureAnalysisData、工作区依赖外部化、vitest、flaky、CI 判读、视觉基线、打包
- [obs-recording.md](obs-recording.md) — 外控 / 托管 OBS 的设计与真机 bug
- [comment-language.md](comment-language.md) — 注释英文、用例名中文、styles.css 中文;批量改注释的坑

## 工作偏好

- [working-preferences.md](working-preferences.md) — 中文汇报、直推 main、什么时候必须问、只做本会话的账、报告要求
