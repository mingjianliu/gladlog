# 子项目 4a:app 内 AI 复盘分析 + 数据再对齐 设计

日期:2026-07-10
状态:待用户审阅
上游文档:roadmap、桌面壳 spec、战报 UI spec;旧 fork 自有文档 `AI_UTILS.md`/`AI_FEATURES.md`(领域事实来源)

## 目标与范围

把自有的 AI 复盘分析体系接到新数据模型,在 gladlog 桌面 app 内可用:战报页发起分析 → 主进程直连 Anthropic 流式返回 → 面板呈现;并完成**数据再对齐期**第一轮(benchmark 用本地自采语料重建、阈值复核)。

**范围内**:

- `packages/analysis`(`@gladlog/analysis`):自有 12 个分析 utils(cooldowns/enemyCDs/dampening/dispelAnalysis/healingGaps/ccTrinketAnalysis/offensiveWindows/healerOffenseAnalysis/drAnalysis/killWindowTargetSelection/spellTags/spellEffectData 等)+ `buildMatchContext` prompt 组装,原样移植(审计 CLEAN),输入 = legacy 形状(`@gladlog/parser-compat` 的 `toLegacyMatch/toLegacyShuffle` 输出)
- 最小游戏数据切片随包携带:自有 `spellNames.json`/`talentModifiers.json`/`trinketItemIds.json` + **手写 `spellEffectOverrides.ts`**(经 debate 修订:放弃 spellEffects.json hunk 提取;只收录被移植 utils 实际引用的法术时长/效果,来源为暴雪公开事实,子项目 5 管线产物替换)
- desktop 主进程 `ai` 模块:`gladlog:ai:analyze` IPC,Anthropic SDK 流式(key/model 取自 settings,已有字段),chunk 经 `gladlog:ai:delta` 事件推 renderer;取消、错误、无 key 引导
- renderer AI 面板:旧 CombatAIAnalysis 逻辑直搬、壳层换石板黑+鎏金 token;入口挂战报页
- 桥接:`StoredMatch/StoredShuffle → compat legacy 形状` 的转换在 renderer 侧调用(compat 纯函数、浏览器可用)
- benchmark 重建 CLI(`packages/analysis/scripts/collectBenchmarks.ts` 改造版):数据源从 GCS 换成**本地自采语料**(按 CombatantInfo personalRating ≥ 阈值筛选),产出 `benchmark_data.json`
- **数据再对齐第一轮**:新旧 benchmark 对比报告(每 spec 指标漂移量化)+ `PANIC_PRESS_DAMAGE_THRESHOLD_*` 阈值复核结论,落 `docs/reports/`

**范围外**:eval 工具链移植(4b,另立 spec;代码进公仓、语料留私有的原则已定)、采集管线(windows-agent/pipeline-app 产品化)、prompt 体系迭代/新 feature、录像。

## 已确认的用户决策

| 决策           | 选择                                                            |
| -------------- | --------------------------------------------------------------- |
| 范围切分       | 4a(本 spec)先行;4b eval 工具链另立;采集管线后排                 |
| benchmark 数据 | 本地自采语料重建(再对齐期本来要用新 parser 重跑)                |
| eval 去向      | 代码进公仓、语料/run 历史留私有(4b 落实)                        |
| UI 移植        | 逻辑直搬、壳层换皮(自有组件无合规问题,纯视觉统一)               |
| 架构           | 方案 A:独立 `packages/analysis` 包(eval/benchmark 为第二消费方) |

## 包与数据流

```
packages/analysis            # @gladlog/analysis,零 UI/Electron 依赖
  src/utils/*                # 12 个分析 utils(自有,原样移植;内部 import 改为包内相对路径)
  src/context/buildMatchContext.ts   # prompt 组装(自 CombatAIAnalysis/index.tsx 抽出纯函数部分)
  src/data/*.json|ts         # 最小游戏数据切片(标注:子项目 5 后由管线产物替换)
  scripts/collectBenchmarks.ts       # 本地语料版 benchmark 重建
  benchmarks/benchmark_data.json     # 新基准(提交);旧 json 一并入库作对照(old-parser 标注)
packages/desktop
  src/main/ai.ts             # IPC: gladlog:ai:analyze(matchContext, opts) → Anthropic 流式
                             # 事件: gladlog:ai:delta / gladlog:ai:done / gladlog:ai:error;支持 abort
  src/preload/api.ts         # bridge 增 ai: { analyze(ctx), cancel(), onDelta, onDone, onError }
  src/renderer/src/report/components/AIAnalysisPanel.tsx  # 旧 CombatAIAnalysis 逻辑+新皮
```

数据流:战报页(已有 `StoredMatch`)→ `toLegacyMatch`(compat)→ utils → `buildMatchContext` → `window.gladlog.ai.analyze(context)` → 主进程 Anthropic 流式 → delta 事件 → 面板渐进渲染;结果随对局缓存(`userData/matches/<id>/analysis.json`,含 model+prompt 版本信封,重开免重跑,可手动重新分析)。

## 关键设计点

- **形状边界**:analysis 包只认 legacy 形状(`IArenaMatch`/`IShuffleRound`,由 parser-compat 定义并导出类型)。新模型进化不触碰 analysis;桥接点唯一(战报页转换处)。
- **Anthropic 直连**:仅主进程持 key;renderer 永不见 key。model 取 settings.anthropicModel,默认 `claude-sonnet-5`。流式用官方 SDK 的 streaming;abort 用 AbortController,窗口关闭/切对局自动取消。
- **无 key 状态**:面板显示引导(设置页入口);分析按钮禁用态。
- **analysis.json 缓存信封**:`{ schemaVersion, model, promptVersion, createdAt, content }`;promptVersion 手工递增常量。
- **benchmark 重建**(经 debate 修订,防自采语料选择偏差):输入 = 本地语料清单 + `MIN_RATING`(默认 2100);**按 spec 与阵容原型分层抽样**,报告逐 spec 样本量 n;解析用**新 parser + compat**(与 app 同链路);指标口径与旧版一致(pressure P90/HPS/DPS/defensive timing/never-used/purge/dampening at death)。
- **再对齐报告与重拟合门槛**(经 debate 修订):旧 `benchmark_data.json` 入库为**不可变基线**;逐 spec 新旧指标表 + 漂移 %;**重拟合双重确认规则**——仅当新分层 P90 与旧基线漂移方向一致且该 spec 样本量 ≥ 门槛时才动阈值,样本不足或覆盖偏斜的 spec 标注"沿用旧值/数据不足",报告须显式披露覆盖偏差。PANIC 阈值(Healer 35k,2026-04-08 校准)按此规则复核。
- **游戏数据边界**(经 debate 修订):三件套 JSON 审计为自有直接带;`spellEffects.json` **不做 hunk 提取**——改为手写 `spellEffectOverrides.ts`,静态枚举被移植 utils 实际引用的法术集合(预计几十条),时长等值取暴雪公开事实,文件头注明来源与子项目 5 替换计划;`spellIdLists.json`/`spellClassMap.json` 为上游 ND 期**不带走**,依赖它们的 util 分支以自有数据或运行时推导替代(计划阶段逐 util 核对 import)。
- **API 前向兼容**(debate 让步):`@gladlog/analysis` 公共入口的类型设计不阻断未来"原生 StoredMatch 形状"的 utils 与 legacy utils 并存;单个 util 出现具体的原生数据需求时逐个迁移,不做 big-bang 重写。

## 合规边界(执行时约束)

- 移植源仅限审计 CLEAN 文件与自有 hunk;实现者不读旧 fork 上游源码。utils/CombatAIAnalysis/analyze.ts/collectBenchmarks.ts 全部 CLEAN,可由控制器(Claude)从旧 fork 取出内容后交实现方,实现方不直接访问旧 fork。
- `spellEffects.json` hunk 提取由控制器执行并记录出处。
- benchmark 语料为自采日志(私有),`benchmark_data.json` 为统计产物可入公仓。

## 测试策略

沿用工作方式(契约 Claude 写、agy 实现、Claude 独立验证;移植类任务=控制器取源+agy 机械改造+全量测试):

- utils 移植:旧 fork 若有对应自有测试(ccCoverage 等)一并移植;每个 util 至少一个"真实 fixture 对局产出非空且形状正确"的冒烟契约;关键 util(cooldowns/drAnalysis)用合成场景断言精确值。
- buildMatchContext:对 fixture 对局做 golden 断言(段落存在性+关键数字,不做全文快照)。
- 主进程 ai 模块:transport 注入化单测(fake Anthropic client:流序、abort、错误、无 key);真实 API 冒烟由控制器手跑一次(用户 key)。
- 面板:jsdom smoke(渐进渲染、取消、无 key 态)。
- benchmark CLI:小清单端到端(10 场)跑通 + 指标字段完整性断言。
- 再对齐:数字报告由控制器产出并抽查,agy verify 交叉复核结论。

## 设计决策辩论记录(agy debate 仪式)

2026-07-10,Gemini 3.1 Pro (High),conversation `020f8d19`。初始 **OPPOSE** → 一轮回复后 **CONCEDE**("The revised design successfully de-risks the major compliance and statistical pitfalls")。

**辩护成立(W1,对方收回)**:"analysis 应立即改吃新模型原生形状"被驳回——薄适配是 roadmap 已裁决决策,compat 经 599/600 差分验证,保护校准阈值的稳定正是再对齐期的目的;big-bang 重写 12 个校准 utils 引入的是复合变量。已采纳的让步:包 API 类型设计允许原生形状 utils 未来并存、逐 util 增量迁移。

**让步 1(W2,已改设计)**:自采语料选择偏差(MMR 口袋/阵容偏斜)会让阈值过拟合。修订:spec×阵容原型分层抽样 + 逐 spec 样本量披露 + 最小 n 门槛 + 旧基准不可变入库 + 重拟合双重确认(方向一致才动),覆盖不足 spec 标注沿用旧值。

**让步 2(W3,已改设计)**:4.7k 行 JSON 的 hunk 提取脆弱且有夹带风险。修订:放弃提取,改手写 `spellEffectOverrides.ts`(静态枚举 utils 实际引用的法术,值取暴雪公开事实),子项目 5 管线替换。

## 未决事项

- AI 面板入口形态(战报右栏第三个 tab vs 报告下方折叠区)——实现时按视觉定,倾向右栏 tab。
- 阵容原型分类法(分层抽样用)——计划阶段从自有 `matchArchetypes` 相关工具或简化规则(治疗职业×近远程构成)中定一版。
