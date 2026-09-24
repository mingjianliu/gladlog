# @gladlog/desktop

[English](README.md) · **中文**

gladlog 桌面客户端:一个 Electron 应用,实时监听 WoW 竞技场战斗日志、落盘保存完成的对局、渲染战报/回放 UI,并可选驱动 AI 教练与基于 OBS 的录像。这是仓库里最大的包 —— `src/` 下约 33,000 行 / 192 个文件。

本文档假定你已经会写 TypeScript,只是第一次接触这个代码库。下面每条断言都能在具体文件里找到出处;有疑问就打开对应文件看。

## 进程结构

标准 Electron 三进程分工,由 `electron.vite.config.ts` 构建:

- **主进程(Main)** —— `src/main/index.ts`(245 行)。启动 `app`,在 `app.ready` 之前注册 `vod://` 特权协议,构造每一个服务(`SettingsStore`、`MatchStore`、`WorkerHost`、`RecorderService`、`CompareService`、`AnalysisService`、`LearningService`、`RecordingsStore`、图标缓存),通过 `registerIpc()` 把它们接线,并以 `contextIsolation: true, nodeIntegration: false` 创建 `BrowserWindow`。
- **预加载(Preload)** —— `src/preload/index.ts` + `src/preload/api.ts`。用 `ipcRenderer.invoke`/`ipcRenderer.on` 包一层,拼出一个 `GladlogApi` 对象,按 `logs`、`matches`、`settings`、`app`、`compare`、`analysis`、`learning`、`recorder`、`icon`、`ai`、`debug` 分命名空间,经 `contextBridge.exposeInMainWorld("gladlog", api)` 暴露出去 —— 这是 renderer 能碰到的唯一表面。注意:`matches.get` 会把主进程返回的原始字节经 `parseDocBytes`(`src/shared/parseDocBytes.ts`)解出来 —— 解析发生在 preload/renderer,不在 main(原因见下面「数据落盘」一节)。
- **渲染进程(Renderer)** —— `src/renderer/src/main.tsx`。挂载 `<App/>`;若 URL hash 是 `#export-report=<id>` 则挂载 `<ExportReportPage/>`(供离屏 PNG 导出窗口用,见 `src/main/exportImage.ts`)。若设了 `VITE_FIXTURE_MODE`,会装一个 `fixtureBridge` 而不是走真 IPC —— 供纯浏览器的开发测试台使用(见下方「本地开发」的 `npm run dev:ui`)。

`electron.vite.config.ts` 定义了三个构建目标 —— `main`、`preload`、`renderer` —— **三者都**设置:

```ts
const json = { stringify: true } as const;
```

原因,原样引用该文件自己的注释:`spellNames.json` 有 41 万+个键,Vite 5 默认把 JSON 编译成 JS **对象字面量**,V8 得当源码解析,实测阻塞首屏约 22 秒;同样的数据走 `JSON.parse` 只要约 42 毫秒。Vite 的 `json.stringify` 默认值是 `false`,三个构建目标都得显式打开 —— main 与 renderer 都会经 `@gladlog/analysis` 吃到这份数据。真实测得的前后数字,来自 commit `ac5a2d1`(「大 JSON 走 JSON.parse —— 冷启动 25s→2s,首渲 24s→0.8s」):

| 指标     | 修前    | 修后   |
| -------- | ------- | ------ |
| 冷启动   | 24832ms | 1427ms |
| 报表首渲 | 23687ms | 853ms  |
| 视觉套件 | 3.0m    | 22s    |
| E2E 套件 | 1.3m    | 14.5s  |

后续 commit(`67ddc95`)又抓到一处漏网之鱼并修复:`spellEffectGenerated.ts` 是一份 295KB 的 `.ts` 对象字面量(不是 `.json`,`json.stringify` 管不到它)—— 迁到同名 `.json` 旁文件。当前锁定的性能预算(实测值,非目标值)在 `qa/budgets.ts`:`parse: 4900ms, firstPaint: 3300ms, coldStart: 2600ms` —— 各自取「3 次 CI 采样的最大值 × 1.5」,分别被 `packages/parser/test/parseBudget.test.ts`、`qa/visual/firstPaint.spec.ts`、`qa/e2e/import.spec.ts` 消费。

`main` 构建目标不只是 `src/main/index.ts` —— 它的 `rollupOptions.input` 有三个入口,共享同一份 `main` 目标配置(因此都吃到 `json.stringify`):

```ts
input: {
  index: resolve(__dirname, "src/main/index.ts"),
  worker: resolve(__dirname, "src/worker/index.ts"),
  slimWorker: resolve(__dirname, "src/main/slimWorker.ts"),
}
```

这对应两套彼此独立、运行时拉起方式也不同的后台进程机制:

- **`src/worker/`**(实时日志监听管线:`watcher.ts`、`tailReader.ts`、`pipeline.ts`、`runtime.ts`)由 `src/main/workerHost.ts` 以真正的 Electron **utility process** 拉起 —— `utilityProcess.fork(workerModulePath, [], { stdio: "pipe" })` —— 通过 `process.parentPort` 通信。`WorkerHost` 还负责崩溃后重启,查询 `crashPolicy.ts` 的 `nextCrashRecord()` 来决定何时把反复崩溃的日志文件打入隔离区(`LIMIT = 3` 次崩溃)。
- **`src/main/slimWorker.ts`** 是从 `matchStore.ts` 经 Node 的 `worker_threads.Worker`(不是 `utilityProcess`)拉起的一次性自愈任务。读一份旧的「肥」`match.json`,调用共享的 `slimStoredDoc()` 谓词,原子重写文件,然后退出。存在的原因:2026-07-26 重设计之前,肥档会在 worker/main/renderer 三处被反复 parse 再物化,一场 426MB 的对局峰值内存能到几个 GB —— 详见下方「数据落盘」的「doc 字节直传」设计。

## `src/main/` 服务清单

29 个非测试文件,每个一两句话,附真实导出名以便对照源码核实:

| 文件                      | ~行数 | 职责                                                                                                                                                                                           |
| ------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                | 245   | App 启动 —— 接线每一个服务,持有 `BrowserWindow` 创建,`startMonitoring()`。                                                                                                                     |
| `ipc.ts`                  | 195   | `registerIpc(deps)` —— 每一个 `ipcMain.handle("gladlog:...")` 通道,转发给注入的服务。                                                                                                          |
| `matchStore.ts`           | 625   | `class MatchStore` —— 一场一目录磁盘存储,`_index.ndjson` 快索引,字节上限 LRU(`LRU_MAX_BYTES`),`store()/get()/page()/rebuildIndex()/rawLine()`。                                                |
| `analysis.ts`             | 1207  | `createAnalysisService(deps)` —— AI 教练管线:建 prompt、跑后端、审计/解析模型 JSON、多模型分槽缓存(`upsertSlot`/`resolveActiveSlot`),外加 `deepen()`(自动追问)与 `analyzeWindow()`(选段分析)。 |
| `localAiBackends.ts`      | 549   | CLI 后端客户端工厂:`claudeCliClientFactory`、`codexClientFactory`、`agyClientFactory`;基于 spawn 的 `Runner`;Windows `.cmd`/`.bat` 参数注入加固。                                              |
| `learning.ts`             | 461   | `createLearningService(deps)` —— 跨对局学习:台账 → `scanPatterns`(确定性)→ AI 蒸馏 → `rules.json`。`CONSOLIDATE_EVERY_MATCHES = 10`。                                                          |
| `deepseekClient.ts`       | 247   | `deepseekClientFactory(key)` —— DeepSeek 的 OpenAI 兼容 SSE API,手写 SSE 行解析器,双重(整体/停滞)超时看门狗。                                                                                  |
| `recorder.ts`             | 334   | `createRecorderService(deps)` —— OBS 远程控制录制启停,孤儿录像对账,`SAFETY_STOP_MS = 40 分钟`。                                                                                                |
| `settingsStore.ts`        | 313   | `class SettingsStore` —— 设置持久化,敏感字段(API key、OBS 密码)用 `safeStorage` 加密。                                                                                                         |
| `cliDetect.ts`            | 225   | `detectLocalCli`/`detectCliForBackend` —— 经 PATH + 已知安装目录定位 `claude`/`agy`/`codex`/`node` 二进制。                                                                                    |
| `recordingsStore.ts`      | 224   | `class RecordingsStore` —— OBS 录像的 ndjson 索引,基于时间重叠的对局关联(`associate()`),孤儿裁剪。                                                                                             |
| `compare.ts`              | 280   | `createCompareService(deps)` —— 高分对比功能:群体 cell 查找、`verifiedComparison`、受 `claimChecker` 把关的 AI 叙述。                                                                          |
| `obsAutoConfig.ts`        | 105   | `detectObsWebsocket()` —— 读 OBS 自己磁盘上的 `config.json` 自动填 URL/密码。                                                                                                                  |
| `exportImage.ts`          | 104   | `exportReportImage(opts)` —— 离屏 `BrowserWindow` 加载 renderer 的 `#export-report=...`,`capturePage()` → PNG。                                                                                |
| `learningLedger.ts`       | 92    | `createLearningLedger(dir)` —— 只追加的 NDJSON 台账,按 `matchId` 最后一次运行为准合并。                                                                                                        |
| `corpusLoader.ts`         | 92    | `loadBundledCorpus(...)` —— 加载/校验内置的 `reference_vectors.json` 高分对比语料(userData 覆盖优先,回退内置)。                                                                                |
| `quitLifecycle.ts`        | 93    | `createQuitLifecycleHandler(deps)` —— `before-quit` 握手:停录制器(4s 上限)、停 worker host、停 AI 活动,再真正退出。零 Electron 依赖,可测。                                                     |
| `workerHost.ts`           | 88    | `class WorkerHost` —— 拉起/看护日志监听 utility process,崩溃后重启。                                                                                                                           |
| `iconCache.ts`            | 78    | `createIconCache(deps)` —— 从 `wow.zamimg.com` 拉技能图标,base64 落盘缓存,单次会话拉取预算,`offline` 模式供视觉测试确定性用。                                                                  |
| `ai.ts`                   | 123   | `resolveAiClient(settings, factory?)` —— 按配置的后端选 LLM 客户端;`stopAllAiActivity()`。                                                                                                     |
| `importLogs.ts`           | 90    | `importLogFiles(paths, store, emit)` —— 一次性历史日志导入,经 `GladLogParser` 流式处理。                                                                                                       |
| `workerMessageHandler.ts` | 67    | `createWorkerMessageHandler(deps)` —— `WorkerToMain` 消息(`match`/`shuffle`/`segmentOpen`/`segmentClose`/`status`/`diagnostic`)的纯路由。                                                      |
| `obsClient.ts`            | 38    | `realObsClient()` —— `obs-websocket-js` 的薄封装,配 `ObsClientLike` 接口供测试用假实现。                                                                                                       |
| `vodProtocol.ts`          | 58    | `registerVodScheme()`/`handleVodProtocol()` —— 自定义 `vod://` 特权协议,带 HTTP range 支持地服务录像文件。                                                                                     |
| `detectWowDir.ts`         | 30    | `detectWowDirCandidates()`/`resolveLogsDir()` —— Windows 上的 WoW 安装路径探测。                                                                                                               |
| `crashPolicy.ts`          | 28    | `nextCrashRecord()` —— 决定何时把反复崩溃的日志文件打入隔离区的纯函数。                                                                                                                        |
| `aiDebugLog.ts`           | 24    | `recordAiDebug`/`listAiDebug` —— 最近 AI prompt/回复的内存环形缓冲,供开发面板用。                                                                                                              |
| `e2eEnv.ts`               | 19    | `e2eUserDataDir(env)` —— `GLADLOG_E2E=1` 下把 `userData` 重定向到一次性路径。                                                                                                                  |
| `slimWorker.ts`           | 33    | 前面提到的自愈瘦身任务的 `worker_threads` 入口。                                                                                                                                               |

## `src/renderer/src/report/` 分层

`derive/` 与 `components/` 合计约 16,800 行(含测试约 100 个文件)。分工:

- **`derive/`** —— 纯函数,接一个 `ReportSource`/doc 类对象,返回纯粹的视图数据。无 JSX、不 import React,例如 `derive/summary.ts`(`deriveSummary(m, range) → UnitTotals[]`)、`derive/mistakes.ts`。唯一的例外是 `derive/inlineRich.tsx`,是 `.tsx` 因为 `makeRichText()` 返回 `ReactNode`(把匹配到的技能/专精名包进 `components/` 的 `<SpellInline>`/`<SpecInline>`)。
- **`components/`** —— 视图层。`components/MatchReport.tsx` 是主要消费者,import 约 17 个 `derive*` 函数并渲染。

当 `derive/` 或 `components/` 代码需要 `@gladlog/analysis` 的一个活谓词(而不只是预算好的 doc 数据)时,会走 **`derive/legacySource.ts`**,它导出 `toLegacySafe(source)` —— 一个带 LRU 缓存(`CACHE_MAX = 2`)的小型封装,包着来自 `@gladlog/parser-compat` 的 `toLegacyMatch`。它会先给裁剪版测试 fixture 缺失的单位事件数组补空数组(`healIn`/`absorbsIn`/`actionsIn`/... 默认 `[]`)再调用 `toLegacyMatch`,这样期望完整 legacy `ICombatUnit` 形状的分析函数,不会在特意为控体积裁剪过数组的 fixture 上直接抛错。**注意:**`toLegacySafe` 是桌面本地的安全封装,不是 `@gladlog/parser-compat` 自己导出的东西 —— 该包只导出原始的 `toLegacyMatch`。

**`derive/analysisInput.ts`** 是主要的接入点:直接从 `@gladlog/analysis` import `buildDeepDivePack`、`buildMatchContext`、`buildWindowPack`、`extractCandidateFindings`、`hasCoachableSignal`、`isHealerSpec` 等,调用 `toLegacySafe(source)`,再调用 `extractCandidateFindings(legacy, owner.id)` 和 `buildMatchContext(legacy, friends, enemies, {...})`,拼出稍后经 IPC 发给 `main/analysis.ts` 的 `AnalysisInput` 载荷。另有约 20 个其他 `derive/*.ts` 文件为各自视图专用的谓词直接 import `@gladlog/analysis`(例如 `derive/mistakes.ts` 调用 `analyzeKickAudit`、`annotateMissedPurgesWithKillWindows`、`computeOffensiveWindows`;`derive/dampeningSeries.ts` 调用 `buildDampeningEvents`)。

**关于 `parser-compat` 的一点:**`packages/desktop/package.json` 并没有把 `@gladlog/parser-compat` 列为依赖,尽管有 15+ 个 `derive/*.ts` 文件直接 import 它。它能在构建/运行时解析成功,纯粹是因为 npm workspaces 会把每个 workspace 包 symlink 进根 `node_modules`,不管有没有声明依赖 —— 如果这个包将来要脱离这个 monorepo 的 workspace 根目录单独构建/打包,这是一处值得知道的隐式耦合。

## 数据落盘

**`MatchStore`**(`src/main/matchStore.ts`)是一场一目录,`join(rootDir, safeName(matchId))`,`store()` 时一并写入三个文件:

- `meta.json` —— `StoredMatchMeta`:`id, kind, bracket, zoneId, startTime, endTime, result, storedAt`,外加一批可选的「富行」字段(`durationS, avgRating, teams, playerName, playerRating, slimmed, roundLinesTotal`),供列表视图渲染时不用打开完整 doc。
- `match.json` —— `{ schemaVersion: 1, storedAt, kind, data }`,完整解析后的 `GladMatch`/`GladShuffle`。
- `raw.txt` —— 原始战斗日志行,换行拼接。

根级 `_index.ndjson`(只追加,每存一场对局写一行 `meta.json`)是快速内存索引,在 `init()` 时与目录实际内容对账。

`MatchStore.get(id)` 返回的是 `match.json` 的**原始 `Buffer`**,不是解析后的对象 —— 解析发生在客户端,经 `parseDocBytes`(`src/shared/parseDocBytes.ts`)。这个「doc 字节直传」设计(`matchStore.ts` 的 `get()` 方法附近有注释)避免了完整解析对象图被物化三次(worker → main → renderer)—— 重设计之前,一场 426MB 的大对局峰值 RSS 能到多 GB 级。`StoredMatchMeta` 上的 `slimmed?: boolean` 标记 doc 是否已经过瘦身谓词处理;缺失即旧的「肥」档,会被前面提到的 `slimWorker.ts` 线程在后台自愈。

**多模型分析缓存。** 两个文件,刻意按 Node 依赖拆开:

- `src/shared/analysisSlots.ts` —— 零 `fs`/`path` import,main 与 renderer 都能安全 import。定义 `AnalysisSlot<T> { promptVersion, createdAt, result }` 与落盘信封:
  ```ts
  interface AnalysisCacheDocV2<T> {
    schemaVersion: 2;
    language: string;
    slots: Record<string, AnalysisSlot<T>>;
    lastSlotKey: string;
  }
  ```
  槽位按 `slotKeyOf(backend, model) = "${backend}:${model}"` 拼键,`splitSlotKey()` 拆回去(只按**第一个**冒号切,因为 model id 本身可能含冒号)。`resolveActiveSlot(doc)` —— 读 `doc.slots[doc.lastSlotKey]` —— 是读侧的单一谓词;`upsertSlot()` 把新槽合并进现有槽位,不冲掉其它模型的缓存结果。
- `src/shared/analysisCache.ts` —— 有 `import { join } from "path"`,所以只能主进程用(注释里记着一次真实生产事故:renderer 的 `slotLabel.ts` 曾经从这个文件 import `splitSlotKey`,由于 Rollup 把整个模块——连同 `path` import——一起拖进浏览器 bundle,打包后的应用报 `"join" is not exported by "__vite-browser-external"`;本地 vitest 和 `tsc` 都测不出来,只有 `electron-vite build` 会炸)。导出 `analysisCachePath(matchesDir, matchId, lang) = join(matchesDir, matchId, "analysis-v2.${lang}.json")` —— 缓存文件既按对局也按语言拆分。

`src/shared/promptVersion.ts` 导出一个 `PROMPT_VERSION = 13` 常量,是分析缓存唯一的失效键:任何 prompt 形状变化都要把它加一,让 `getCached` 把所有既有槽位视为过期。文件自带的注释保留了从 v3 到 v13 的变更记录,追踪每次升版新增了哪些 finding 类别/prompt 段落。

## 测试与质检

- **单测(vitest)。** `vitest.config.ts` 排除 `qa/**`(「qa/ 是 Playwright 的地盘」),coverage 只算 `src/**`。用 `npm test --workspace=packages/desktop` 跑(`"test": "vitest run --passWithNoTests"`)。
- **`qa/` —— Playwright。** `qa/playwright.config.ts` 定义两个 project:
  - `visual` —— 截图回归,`toHaveScreenshot: { threshold: 0.05, maxDiffPixels: 100 }`(两个数字都是实测校准出来的 —— 故意改错一处配色、确认 CI 报红,详见该配置里的长注释)。`snapshotPathTemplate` **不含 `{platform}` 段** —— Linux CI 是唯一基线源,刻意设计。
  - `e2e` —— 驱动打包后的 Electron App(无 dev server)。
  - 全程 `workers: 1` —— `firstPaint`/`coldStart` 两个性能预算需要一台不被抢占的机器。
  - `qa/axe-allowlist.ts` —— 经 `@axe-core/playwright` 的 WCAG 2.1 A+AA 无障碍基线,目前一条整体豁免(`color-contrast`,理由:暗色游戏风 UI 的调暗)。
  - `qa/budgets.ts` —— 见前面 JSON.parse 那节。

  **本机运行警告,原样引自 `qa/playwright.config.ts` 顶部注释:**「基线是 linux 单源,由 CI 生成与判定 ... 本机只跑 `npm run test:visual:smoke` —— 它带 `--ignore-snapshots`,不比对也不写基线;直跑 `test:visual` 会在基线缺失时写入 mac 截图,污染单源。」换句话说:**本机绝不要跑 `npm run test:visual`** —— 没有脚本层面的强制拦截,只有这条注释在提醒,在非 Linux 机器上跑会把本机平台的截图写进共享基线。本机想 sanity check 就用 `npm run test:visual:smoke`(同一套用例,`--ignore-snapshots`,不比对)。

## Push 前检查清单

按仓库根 `CLAUDE.md`:

```
npm test --workspace=packages/desktop && npm run typecheck && npx eslint packages/desktop/src --quiet
```

这里的 `npm run typecheck` 跑的是 `tsc --noEmit -p tsconfig.json`,而 `tsconfig.json` 的 `include` 覆盖了 `src`、`test`、`dev`、`qa` —— 所以本机与 CI 的 typecheck 本就同样看得到测试文件。CI 独立的 `npm run lint`(根级 `eslint .`,扫全仓)补上的、上面这条本机清单**没**补上的缺口是:`npx eslint packages/desktop/src --quiet` 只扫 `src/`,所以 `packages/desktop/test/`、`qa/`、`dev/`、`scripts/` 里的 lint 问题本机测不出来,得等 CI 跑全仓 lint 才抓。`.github/workflows/test.yml` 依次跑:根级 `lint` → 根级 `typecheck` → 根级 `test` → `npm -w @gladlog/desktop run verify:vision` → `npm -w @gladlog/desktop run build`(生产版 `electron-vite build`,是唯一能抓到「renderer 代码意外 import 了一个主进程专用模块」这类问题的步骤 —— 见上面 `analysisCache.ts` 那次事故);并行的 `frontend-qa` job 跑 `test:visual` → build → `xvfb-run` 下的 `e2e` Playwright project。

## 本地开发

- `npm run dev` —— 经 `electron-vite dev` 跑完整 Electron App。
- `npm run dev:ui` —— 纯浏览器的 Vite 测试台(`dev/main.tsx`、`dev/scenes.ts`、`dev/fixtures/`),不用 Electron 或真实 WoW 客户端就能迭代战报/回放 UI;配合 `VITE_FIXTURE_MODE=1`,renderer 的 `main.tsx` 会据此装一个 `fixtureBridge` 而不是走真 IPC。
- `npm run verify:vision` / `npm run learning:scan` —— 独立脚本(`scripts/verifyVision.ts`、`scripts/learningScan.ts`);`scripts/` 下其它脚本还有 `backfillMatches.ts`、`repro-badjson.ts`、`slimLibrary.ts`、`smokeAiPipelines.ts`、`smokeStressFixtures.ts`、`verify-production.ts`。
