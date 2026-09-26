# gladlog 开发者指南

[English](developer-guide.md) · **中文**

面向要读懂/修改这套代码的人。配套阅读:仓库根 `CLAUDE.md`(硬性纪律)、`docs/verifiability-roadmap.zh-CN.md`(验证体系全景)、[`docs/README.zh-CN.md`](README.zh-CN.md)(文档地图 —— 它说明哪些文档持续维护、哪些已冻结;设计史 2026-08-05 之前在 `docs/plans/` + `docs/specs/`,之后在 `docs/superpowers/`)。

## 开发环境依赖

- **Node 20+ / npm**:`npm install` 一次装完全部 workspace(产品构建只需要这个)。
- **rclone(可选)**:仅 `corpus-tools` 的 PvP 语料 Google Drive 归档用
  (`syncPvpLogsToDrive.ts`),不进产品包。装法:mac `brew install rclone`,
  win `winget install Rclone.Rclone`;一次性 `rclone config` 建名为 `gdrive`
  的 Google Drive remote(细节见 `.claude/skills/fetch-pvp-logs`)。脚本在
  未安装/未配置时会打印同样的指引,不会硬挂。

## 架构总览

```
WoWCombatLog*.txt
   │  (worker 进程 tail + checkpoint;或 importLogs 一次性全量)
   ▼
@gladlog/parser        L1 逐行解码 → L2 对局分段 → L3 收集成 GladMatch/GladShuffle doc
   │
   ▼
desktop main           MatchStore(逐场目录:meta.json + match.json + raw.txt,
   │                   NDJSON 索引)· AI 服务(findings 生成/缓存/标记/聚合)· IPC
   ▼
desktop renderer       report/derive/*(纯函数,吃 doc)→ 三视图 UI
   │                   需要分析谓词时:toLegacySafe(doc) → @gladlog/analysis
   ▼
@gladlog/analysis      战斗分析核心:CC/驱散/走位/死亡/窗口分析 + prompt 构建
                       (数据目录 = 策展白名单 + datagen 生成产物)
@gladlog/parser-compat 新 doc → 旧 ICombatUnit 形状的转换层(analysis 的输入)
@gladlog/eval          prompt/回复质量评测工具链(语料构建、覆盖门、评分校验)
```

包一览:`parser`(纯解析,无依赖)、`parser-compat`(形状转换)、`analysis`(分析 + prompt + 游戏数据)、`desktop`(Electron 应用)、`eval`(评测脚本)、`corpus-tools`、`log-pipeline`(跨机日志中继)。

上面这张图是简版。完整的那份 —— 主进程每个服务、数据落盘在哪(带实测体积)、
贯穿性约束、以及五条「从哪读起」的路径 —— 见[架构](architecture.zh-CN.md)。
另有两个包带自己的 README:
[`packages/analysis`](../packages/analysis/README.zh-CN.md) 与
[`packages/desktop`](../packages/desktop/README.zh-CN.md)。

新增任何「分析算 X、门规也验 X」的谓词之前,先查[谓词索引](predicate-index.zh-CN.md) ——
本仓最贵的反复性 bug,就是同一个事实被用两种略有差异的方式算了两遍。

## 三条铁律(违反过、都付出过代价)

1. **门规谓词即规范(shared-predicate rule)** —— 同一个事实的任意两个消费者(分析 vs 验证门、main vs renderer、prompt vs UI)必须 import 同一个常量/函数,且锚定在渲染值(floored 秒)上。历史上 11 个独立 bug 全是两套谓词悄悄分叉。修法永远是让消费方共享谓词,不是放松验证门。详见根 `CLAUDE.md`。
2. **白名单会腐烂** —— 任何策展 spell-id 集合(CC/驱散/打断/爆发 CD/图标)每个版本都在悄悄失效。新增追踪先做**语料实证**(挖 SPELL_CAST_SUCCESS/SPELL_DISPEL,看 per-spec **率**不是绝对数);缺数值(CD/时长)用语料实测(min inter-cast gap、buff applied→removed 中位数),不拍脑袋。数据刷新流程 `docs/commands/update-wow-data.md` 自带腐烂回归检查步。
3. **确定性验证优先** —— 能用确定性门(覆盖率、不变量、差分预言机)裁决的,不用 LLM 判官;能被门锚定的判官维度必须引用实测数字。改 prompt 构建器走 `/eval-ab`;例外是低频事件(A/B 功效不足时按先例采纳、下轮 baseline 验证并注明)。

## 开发环回

```bash
npm ci
npm -w @gladlog/desktop run dev                         # 真 Electron(VITE_FIXTURE_MODE=1 npm -w @gladlog/desktop run dev = 免真数据预览)
npm -w @gladlog/desktop run dev:ui   # 纯浏览器 report UI 测试台,HMR,http://localhost:5199
npm run typecheck                   # 全仓(绝不 tsc -b,会往 src 吐 .js)
npm test --workspaces
```

**push 前统一校验**（运行 `npm run presubmit` —— 切勿手敲旧版三件套）：

```bash
npm run presubmit
```

`npm run presubmit` 是 CI `test` 工作流中 `static` 和 `unit` 任务的超集——`verify:doc-commands` 只在本地跑（根目录 `eslint .` + `verify:doc-commands` + `typecheck` + 全工作区单测 + `verify:vision` + `electron-vite build`）。**切勿手敲旧版三件套**（`npm test --workspace=packages/desktop && npm run typecheck && npx eslint .`）：它会跳过 `verify:vision` 和生产构建，而生产构建是本地唯一能拦截 renderer 误从 `src/main/*` 导入值的手段（开发模式和 vitest 都会放行直到打包崩溃）。push 后用 `gh run watch <显式 run id> --exit-status` 盯绿。

**`analysis` 与 `eval` 的本地测试隔离。** 本地在这两个包里跑 `npm test` 分两遍:列在包内 `vitest.shared.json` 里的测试文件在每个 worker 里共用一份模块缓存(大数据表只加载一次而不是每个文件一次 —— 2026-09-12 交替实测三轮,analysis + eval 的 `npm test` 中位数 146 s → 52 s,内存峰值也更低),其余文件照旧隔离运行。CI 始终全量隔离。准入是 fail-closed:新测试文件在加进 `vitest.shared.json` 之前都隔离运行,只有它不改模块、全局或进程状态时才应加入;已在名单里的文件一旦开始这么做(`vi.mock`、`vi.spyOn`、写 `process.env` ……)会被自动否决。开关单例(`CANDIDATE_TYPE_FLAGS`、`DISPEL_FEATURE_FLAGS`、`HEALER_OFFENSE_FLAGS`)必须用保存的副本还原 —— 守卫会让任何没还原的测试失败。某个失败只在本地出现时,用 `GLADLOG_TEST_ISOLATE=all npm test --workspace=packages/analysis` 重跑,区分状态泄漏和真 bug。细节见 `packages/analysis/test/support/testIsolation.ts`。

**desktop 代码约定**(数据流三通路、seekReq nonce 模式、fixture 合成注入测试法等)集中在 `.claude/skills/desktop-dev/SKILL.md` —— 改 `packages/desktop` 前先读。

**parser 改动**必须过私有仓的差分预言机(`oracle/`,`npm run gate`,对 164 对真实对局比对新旧 parser)。

## 测试地图

- `packages/parser/test` —— L1/L2/L3 合成行单测 + fixtures。
- `packages/analysis/test` —— 600+ 用例:分析谓词、prompt 构建、门规一致性。
- `packages/desktop`(`test/` + 源内 `*.test.tsx`)—— derive 纯函数、组件渲染(jsdom)、
  真实匿名 fixture(`test/fixtures/real-match-sample.json`,裁前 90s、无玩家死亡 ——
  测死亡类路径用克隆 + 注入合成事件)。
- `packages/eval` —— 覆盖门与评分契约的单测。

## eval 体系(prompt/回复质量)

eval 的 runbook 在 `docs/commands/`(全部十条、每条一句话的清单见 [`docs/README.zh-CN.md`](README.zh-CN.md)),产物落私有仓 `$GLADLOG_EVAL_HOME`。最常用的三条:

- **/eval-baseline** —— 现状评测找问题:构建语料 → 确定性质量门(覆盖率/噪声/偏向词)→ 生成回复 → 三遍法评分(锚定 rubric + 判别效度)→ 报告 + 台账。
- **/eval-ab** —— 受控 A/B 验证某个 prompt 构建器改动(同语料、盲评、bootstrap CI)。注意 worktree 必须 `npm ci`(符号链接会静默用回主仓代码)。
- **/calibrate-judge** —— 信任判官分数之前先校准判官。

已知测量事实:在 Sonnet 下单轮 accuracy Δ≲0.6 属噪声(2026-07-20 test-retest 实测,配对 SD ≈ 1.3,n=50);在 Opus 5.0 下(2026-09-15 判官校准 7/7),A/B 实测配对 SD 为 accuracy 0.57、focusCalibration 0.92(n=40,2026-09-16);在 Opus 5.5 下(2026-09-23 起的判官,校准 7/7),正式 test-retest(n=50)得 accuracy 配对 SD 0.65(MDE 0.18)、focusCalibration 0.40。批量 responder/judge 子代理用 Opus 5.5(`claude-opus-5-5`,2026-09-23 起),与产品 coach 默认模型(`AI_DEFAULT_MODEL`)一致。2026-09-12 至 2026-09-22 两者都是 Opus 5.0,更早是 Sonnet:噪声底、判官校准和基线都绑定测量它们的模型,不能直接跨切换比较 —— 跨切换比较前先重跑 `/calibrate-judge` 和一轮新基线。

## 游戏数据管线

`packages/analysis/scripts/datagen/`:从 wago.tools 拉 DB2 表生成 spell 名/效果/天赋/图标等产物,build 记录在 `datagen-manifest.json`。新版本刷新按 `docs/commands/update-wow-data.md` 步骤走(含策展目录人工裁决门与白名单腐烂回归检查)。

## 发布

GitHub Actions 在 tag 上原生构建 Windows x64 / macOS 安装包(免 Wine)。electron-builder 的坑(pin electronVersion、别加 `files`、`extraResources`、mac ad-hoc 签名)见 `docs/BUILD-WINDOWS.zh-CN.md` 与提交历史。

## 语言政策

面向用户的文档是双语的:`CLAUDE.md`「双语文档规则」列出的那批(十三份顶层文档,加上每个有 `.zh-CN.md` 副本的 `packages/<pkg>/README.md`)以英文为正本,中文副本必须与之等价 —— 两边一起改,或者都不改。其余一切刻意不做约束、且大多是中文:源码注释、CI 与提交信息、`.claude/skills`、`docs/plans` / `docs/specs` / `docs/superpowers`、`docs/BACKLOG.md`、`docs/commands/` 下的 runbook、以及已归档的交接文档。不要把它们「修」成英文,也不要给不在清单上的文档加 `.zh-CN.md` 副本;新文档若面向用户,就把它加进清单并两种语言一起出。

## 从哪里开始读代码

- 一场对局怎么变成战报:`packages/parser/src/api.ts` → `packages/desktop/src/main/matchStore.ts` → `packages/desktop/src/renderer/src/report/derive/` → `report/components/MatchReport.tsx`。
- 一场对局怎么变成 AI prompt:`packages/analysis/src/context/buildMatchContext.ts`(`useTimelinePrompt` 路径)→ `matchTimeline.ts`。
- 一条 finding 怎么被验证:`packages/analysis/src/analysis/`(candidateFindings → buildFindingsPrompt → auditFindings)。
