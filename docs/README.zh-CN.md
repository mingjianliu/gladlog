# gladlog 文档地图

[English](README.md) · **中文**

去哪里找、找到的东西有多可信。硬性纪律本身在仓库根的 `CLAUDE.md`;本页只说明哪份文档放什么。

## 正式文档(持续维护)

以下都是双语文档 —— 英文是正本,`.zh-CN.md` 副本必须与之等价(`CLAUDE.md` 的「双语文档规则」)。每份的 H1 下面都有一条语言栏。

| 文档                                                               | 内容                                                                                   |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| [`../README.zh-CN.md`](../README.zh-CN.md)                         | 产品概览与快速上手                                                                     |
| [`../CHANGELOG.zh-CN.md`](../CHANGELOG.zh-CN.md)                   | 发布说明                                                                               |
| [`user-guide.zh-CN.md`](user-guide.zh-CN.md)                       | 桌面应用使用手册                                                                       |
| [`FAQ.zh-CN.md`](FAQ.zh-CN.md)                                     | 常见问题                                                                               |
| [`setup-windows-claude-cli.zh-CN.md`](setup-windows-claude-cli.zh-CN.md) | Windows 上让 AI 教练走 Claude CLI(免 API Key)的安装指南                          |
| [`developer-guide.zh-CN.md`](developer-guide.zh-CN.md)             | 读懂/修改代码:依赖、开发环回、测试、eval、语言政策                                    |
| [`architecture.zh-CN.md`](architecture.zh-CN.md)                   | 包、进程、数据流,以及会咬人的地方                                                     |
| [`BUILD-WINDOWS.zh-CN.md`](BUILD-WINDOWS.zh-CN.md)                 | 构建 Windows 安装包                                                                    |
| [`verifiability-roadmap.zh-CN.md`](verifiability-roadmap.zh-CN.md) | 验证体系全景                                                                           |
| [`DATA-COMPLIANCE.zh-CN.md`](DATA-COMPLIANCE.zh-CN.md)             | 数据与许可来源                                                                         |
| [`pvp-log-archive.zh-CN.md`](pvp-log-archive.zh-CN.md)             | PvP log 长期归档                                                                       |
| [`predicate-index.zh-CN.md`](predicate-index.zh-CN.md)             | 每条共享谓词住在哪(analysis ↔ 门规 ↔ 战报 UI);CI 校验                                |
| [`log-observability-audit.zh-CN.md`](log-observability-audit.zh-CN.md) | 战斗日志能观测到什么、观测不到什么                                                 |
| [`rule-history.zh-CN.md`](rule-history.zh-CN.md)                   | 规则史(CLAUDE.md 各条规则背后的事故叙事)                                              |

各包的 README 遵循同一规则 —— `packages/<pkg>/README.md` 是正本,`README.zh-CN.md` 是副本:
[`analysis`](../packages/analysis/README.zh-CN.md) ·
[`desktop`](../packages/desktop/README.zh-CN.md) ·
[`parser`](../packages/parser/README.zh-CN.md) ·
[`parser-compat`](../packages/parser-compat/README.zh-CN.md) ·
[`eval`](../packages/eval/README.zh-CN.md) ·
[`corpus-tools`](../packages/corpus-tools/README.zh-CN.md) ·
[`log-pipeline`](../packages/log-pipeline/README.zh-CN.md)。

## Runbook(`docs/commands/`)

每个可重复的工作流一页;多数同时以 `/<name>` skill 的形式暴露。

| Runbook                                                    | 一句话                                                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [`eval-baseline.md`](commands/eval-baseline.md)            | 跨对局评测治疗 prompt/回复质量,报告该修什么                                                          |
| [`eval-ab.md`](commands/eval-ab.md)                        | 对某个 prompt 构建器改动做受控盲评 A/B(同语料、配对统计)                                              |
| [`calibrate-judge.md`](commands/calibrate-judge.md)        | 用植入的合成缺陷标定 LLM 评审,之后才信它的分                                                          |
| [`pipeline-audit.md`](commands/pipeline-audit.md)          | 全语料两层审计:确定性的 prompt-vs-log 门规 + 已标定的评审                                             |
| [`deepdive-probe.md`](commands/deepdive-probe.md)          | 对一场真实对局做无预算上限的 agent 深挖,与产品基线盲混对照                                             |
| [`outcome-halo.md`](commands/outcome-halo.md)              | 2026-08-05 的一次性评审「结果光环」实验,仅为可复现而保留                                               |
| [`update-wow-data.md`](commands/update-wow-data.md)        | 新 build 发布时从 wago.tools 刷新生成的游戏数据(法术、天赋、饰品);赛季健康检查                       |
| [`collect-logs.md`](commands/collect-logs.md)              | 四条战斗日志采集通道(本机、跨机中继、公共 feed、Drive 归档)                                          |
| [`ingest-coach-corpus.md`](commands/ingest-coach-corpus.md) | 把教练站点的 VoD 复盘变成可与 gladlog 候选谓词对账的语料                                            |
| [`release-gladlog.md`](commands/release-gladlog.md)        | 出一版桌面应用(权威流程在 `release` skill;本页只放安装脚注与失败手册)                                 |

## 审计与清单

活的参考材料;各自标注了测量日期。

- [`coaching-grounding-audit.md`](coaching-grounding-audit.md) —— 每条教练判断的接地来源。
- [`log-observability-audit.zh-CN.md`](log-observability-audit.zh-CN.md) —— 战斗日志暴露了哪些事实(双语,见上)。
- [`ability-fact-inventory.md`](ability-fact-inventory.md) —— prompt 渲染的技能事实及各自出处。
- [`predicate-index.zh-CN.md`](predicate-index.zh-CN.md) —— 共享谓词登记册(双语,见上)。
- [`coach-corpus-admission-audit-2026-09-12.md`](coach-corpus-admission-audit-2026-09-12.md) —— Skill Capped 教练语料的准入审计。

## 待办

- [`BACKLOG.md`](BACKLOG.md) —— 未完成条目及挂在上面的裁决。
- [`BACKLOG-archive.md`](BACKLOG-archive.md) —— 已关闭条目,为其它文档引用的锚点而保留。

## 历史(冻结,不再维护)

读它们是为了看当时的推理;不要指望路径、数字、状态与今天的代码树一致。

- [`plans/`](plans/) 与 [`specs/`](specs/) —— 截至 **2026-08-05** 的设计计划与规格。之后的计划与规格在 [`superpowers/plans/`](superpowers/plans/) 与 [`superpowers/specs/`](superpowers/specs/)。
- [`reports/`](reports/) —— 带日期的实验报告。
- [`archive/`](archive/) —— 会话交接文档(`HANDOFF-*.md`,含原本放在仓库根的 2026-07-10 重写交接)以及 2026-09-18 的待裁清单。每份都带「Archived」横幅。
- [`../retrospective/`](../retrospective/) —— 从 git 历史与会话记录重建的开发过程档案。
