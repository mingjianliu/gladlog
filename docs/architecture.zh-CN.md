# gladlog 架构

[English](architecture.md) · **中文**

本文说明 gladlog 是怎么搭起来的:七个包各自是什么、每段代码跑在哪个进程里、数据落在磁盘的什么位置,以及有哪些「不知道就会踩」的约束。

**读者**:会写 TypeScript 但完全没见过本仓库的人,以及三个月后的作者本人。除了「游戏能把战斗日志写成文本文件」之外,不预设任何《魔兽世界》知识。

**范围与诚实原则**:下文每一条断言都能指到一个文件、一个符号或一个实测数字。凡是取自作者本机而非代码的数字,都会明确标注。凡是没有核实的,写「未核实」而不是猜。如果你发现本文某条与代码矛盾,以代码为准 —— 请修文档。

延伸阅读:[开发者指南](developer-guide.zh-CN.md)(工作流、测试地图、发版)、仓库根目录的 `CLAUDE.md`(不可协商的铁律)、[可验证性路线图](verifiability-roadmap.zh-CN.md)(这套验证机制为什么存在)、[数据合规](DATA-COMPLIANCE.zh-CN.md)(游戏数据从哪来、什么许可)。

---

## 1. 一张总图

```
魔兽世界
  └─ 写出  <WoW>/Logs/WoWCombatLog*.txt        纯文本,一行一个事件,只追加
       │
       │  (A) 实时路径:desktop 的 utility 进程从字节 checkpoint 处 tail
       │  (B) 批量路径:main/importLogs.ts 按用户点击一次性流式跑完整个文件
       ▼
@gladlog/parser                                   零运行时依赖
  L1  parseLine()             一行文本  → ParsedLine(已解码、已定时)
  L2  Segmenter               行流      → Segment(一场竞技场对局,或 shuffle 的一轮)
  L3  buildMatch/buildShuffle Segment   → GladMatch / GladShuffle    ← 「doc」
       │                                  slimMatchParams() 在这里跑:出厂即瘦
       ▼
desktop 主进程
  MatchStore          一场一目录:meta.json + match.json + raw.txt,
  │                   外加一个只追加的 NDJSON 索引(_index.ndjson)
  ├─ RecorderService  按 segmentOpen/segmentClose 走 OBS websocket 起停录像
  ├─ AnalysisService  候选事件 → prompt → LLM → 审计 → 按模型分槽的缓存
  ├─ CompareService   你的指标 vs 预先构建的高分玩家参照语料
  ├─ LearningService  跨场台账 → 确定性模式扫描 → 提炼成规则
  └─ IPC              约 40 个 ipcMain.handle 频道 + 推送频道(src/main/ipc.ts)
       │
       │  matches:get 返回的是原始字节;main 里没有任何地方 parse doc
       ▼
preload(contextIsolation 桥)
  parseDocBytes()  JSON.parse + slim 兜底 —— 全链路只在这里把 doc 物化一次,
                   且落在 renderer 用的同一个堆上
       │
       ▼
desktop renderer(React)
  report/derive/*   38 个纯函数模块:doc → 视图模型(时间轴、meters、回放、死亡…)
  │                 需要分析谓词时:
  │                 toLegacySafe(doc) → @gladlog/parser-compat → @gladlog/analysis
  report/components/*  41 个组件:战报 / 回放 / 事件 / 录像 / AI 分析 五个 tab
       │
       ▼
你,正在看一份战报
```

主干旁边挂着两条支线:

- **`@gladlog/eval`** 消费同一个 prompt 构建器,再拿原始日志把它的输出复算一遍(确定性门规),然后给模型回复打分(LLM judge)。它永远不在应用里运行。
- **`@gladlog/log-pipeline`** 与 **`@gladlog/corpus-tools`** 是维护者工具:跨机中继日志、构建 `CompareService` 读取的参照语料。两者都不进桌面安装包。

---

## 2. 七个包,以及箭头指向哪边

2026-08-01 实测,统计各包 `src/` 下的 `.ts`/`.tsx`(含同目录的 `*.test.ts`;各包另有独立的 `test/` 目录,不计入此表):

| 包                       | `src/` 文件数 | `src/` 行数 | 声明的运行时依赖                                          | 一句话职责                          |
| ------------------------ | ------------: | ----------: | --------------------------------------------------------- | ----------------------------------- |
| `@gladlog/analysis`      |           128 |      35,325 | `@gladlog/parser-compat`                                  | 战斗分析谓词、prompt 构建、游戏数据 |
| `@gladlog/desktop`       |           192 |      33,390 | `@gladlog/parser`(见下方注意)                             | Electron 应用本体                   |
| `@gladlog/eval`          |            18 |       4,242 | parser、parser-compat、analysis、corpus-tools、`fs-extra` | prompt/回复的质量门规与判分         |
| `@gladlog/corpus-tools`  |            25 |       3,944 | analysis、parser-compat、`node-fetch`、`fs-extra`         | 参照语料构建、第三方日志归档        |
| `@gladlog/parser`        |            20 |       2,653 | **无**                                                    | 战斗日志 → 带类型的对局文档         |
| `@gladlog/log-pipeline`  |            27 |       1,500 | **无**                                                    | 经共享文件夹做跨机日志中继          |
| `@gladlog/parser-compat` |             6 |       1,119 | `@gladlog/parser`                                         | 新 doc 形状 → 旧 `ICombatUnit` 形状 |
| **合计**                 |       **416** |  **82,173** |                                                           |                                     |

这 416 个文件里 317 个是非测试文件、99 个是同目录测试。独立 `test/` 目录另有 59(analysis)、73(desktop)、19(parser)、13(eval)、3(parser-compat)个文件。

依赖方向:

```
parser  ←  parser-compat  ←  analysis  ←  corpus-tools  ←  eval
   ↑                            ↑             ↑             ↑
   └────── desktop ─────────────┘             └─────────────┘

log-pipeline:谁都不依赖(纯 Node 标准库)
```

箭头读作「这个包允许 import 什么」。三条性质是承重的:

1. **`parser` 零依赖。** `packages/parser/package.json` 里根本没有 `dependencies` 字段,`packages/parser/src/` 下每一个模块说明符都是相对路径。它唯一碰到的平台 API 是 `Intl.DateTimeFormat`(`src/l1/timestamp.ts`)。正因如此,parser 可以被 worker 进程、测试夹具、benchmark 脚本随手复用,不拖任何东西。
2. **`analysis` 消费的是 `parser-compat`,不是 `parser`。** 分析代码是照着旧的 `ICombatUnit` 形状写的,不是 `GladUnit`。`packages/analysis/src/index.ts` 写明了这个取舍:入口形状是 legacy,类型设计留了余地,未来可以逐个 util 迁到原生形状。
3. **renderer 直调 analysis。** 它不会让 main 去算分析谓词。`report/derive/*.ts` 调 `toLegacySafe(source)`(`src/renderer/src/report/derive/legacySource.ts`),然后在同进程内调 analysis 的函数。38 个非测试 derive 模块里有 24 个 import 了 `@gladlog/analysis`。

### 注意:未声明的工作区依赖

`packages/desktop/package.json` 声明了 `@gladlog/parser`,但**没有**声明 `@gladlog/analysis`、`@gladlog/parser-compat` 与 `fs-extra` —— 而 desktop 源码这三个都在用(analysis 约 20 处;`parser-compat` 在 `derive/legacySource.ts` 与 `derive/analysisInput.ts`;`fs-extra` 的 `ensureDirSync` 在 `main/iconCache.ts`)。同样地,`corpus-tools` import 了 `@gladlog/parser` 却没声明。它们能解析成功,只是因为 npm workspaces 把所有工作区包提升到了仓库根的 `node_modules/@gladlog/`。

实际后果:**没有自己 `npm install` 的 git worktree,会把这些 import 解析到主 checkout 上** —— 也就是说你 typecheck 的是另一个分支的源码,不是你正在改的这份。任何新 worktree 在信任 `npm run typecheck` 之前,先跑 `npm ci`(至少 `npm install`)。

---

## 3. 进程模型

Electron 给了四个 JavaScript 上下文,gladlog 四个都用上了,外加 `worker_threads`:

| 上下文               | 入口                                                            | 里面跑什么                                        |
| -------------------- | --------------------------------------------------------------- | ------------------------------------------------- |
| **main**             | `src/main/index.ts`                                             | 窗口生命周期、全部服务、全部落盘、全部 LLM 调用   |
| **utility 进程**     | `src/worker/index.ts`                                           | tail 日志目录并解析;一个长驻子进程,崩溃后重启     |
| **preload**          | `src/preload/index.ts` + `api.ts`                               | `window.gladlog` 桥;也是 doc 被 JSON.parse 的地方 |
| **renderer**         | `src/renderer/src/main.tsx`                                     | React UI、derive 层、直调 `@gladlog/analysis`     |
| **`worker_threads`** | `src/main/slimWorker.ts`,以及 `matchStore.ts` 里一个内联 worker | 一次性的重型 JSON parse / 瘦身回写,不占主线程     |

`src/main/index.ts` 就是用代码写的接线图 —— 246 行,几乎全是构造服务、把依赖递进去。从头读到尾就知道有哪些东西存在。

### tail 日志的 utility 进程

`WorkerHost`(`src/main/workerHost.ts`)用 `utilityProcess.fork` 拉起 `worker.js`,把 stdout/stderr 接进 `electron-log`,并在任何非预期退出后 1 秒重启。为什么用独立 OS 进程而不是线程:某一行畸形日志导致的解析崩溃不能带走 UI,而且必须能归因。

归因逻辑就是 `crashPolicy.ts`(28 行):worker 在状态消息里报告 `{fileKey, offset}`;如果进程在大致同一位置连挂三次(`OFFSET_TOLERANCE = 65536` 字节),该文件被**隔离** —— 加进 `WorkerConfig.quarantined`,此后跳过。任何一次成功的 `match`/`shuffle` 消息都会清零计数。

worker 内部(`src/worker/`):

- `watcher.ts` —— 对日志目录 `fs.watch`,把文件标脏;`flushIntervalMs`(2 秒)定时器排空脏集,另外在最后一次事件后静默 `quietPeriodMs`(5 秒)再补刷一次,让最后一场的尾巴及时到位。flush 失败会把文件回插脏集,而不是杀掉 watcher。
- `tailReader.ts` —— `readTail(filePath, state)` 从 checkpoint 偏移按 8 MB 块读,按 `\n` 切(去掉行尾 `\r`),**偏移只推进到最后一个完整行尾**。轮转的判据是文件变小,或首行的 sha1 变了。
- `pipeline.ts` —— `FilePipeline` 每个文件持有一个 `GladLogParser`。它唯一不显然的规则:持久化的 checkpoint **只在 `!parser.hasOpenSegment()` 时推进**。绝不在对局中途 checkpoint。轮转时它会先发一个合成的 aborted `segmentClose`(免得 OBS 录像那边干等 40 分钟的安全阀),再重建 parser。
- `checkpoints.ts` —— 注册表形状是 `{ files: { [fileKey]: { offset, firstLineChecksum } } }`,用 tmp + rename 写到 `<userData>/checkpoints.json`。

回传给 main 的是 `src/shared/protocol.ts` 里的 `WorkerToMain` 联合类型:`match`、`shuffle`、`diagnostic`、`segmentOpen`、`segmentClose`、`status`。路由逻辑放在 `workerMessageHandler.ts` 里做成纯函数,好脱离 Electron 单测;`index.ts` 只负责把 Electron 具体的那几端注进去。

---

## 4. 主进程服务清单

`packages/desktop/src/main/` 有 29 个非测试模块(含测试共 48 个文件)。这里的一切都在 `index.ts` 的 `app.whenReady()` 里构造,并通过 `ipc.ts` 暴露给 renderer。

| 模块                              |  行数 | 它管什么                                                                                                                                   | 落盘状态                                                             |
| --------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `matchStore.ts`                   |   625 | 对局库:`store` / `list` / `page` / `get` / `rawLine` / `rebuildIndex`。`get()` 返回**原始字节**,绝不返回对象。                             | `<userData>/matches/<id>/` + `_index.ndjson`                         |
| `analysis.ts`                     | 1,207 | AI 复盘:`run`、`deepen`、`analyzeWindow`、`cancel`、`getState`、`getCached`、`getFlags`/`setFlag`、`aggregate`、`notebook`、`listAnalyzed` | 每场的 `analysis-v2.<lang>.json`、`windowAnalysis.<lang>.json`、标记 |
| `learning.ts`                     |   461 | 跨场教练闭环:台账 → 确定性模式扫描 → AI 提炼 → 规则                                                                                        | `<userData>/learning/rules.json`(台账见下行)                         |
| `learningLedger.ts`               |    92 | 只追加 NDJSON,一行一次分析 run;读取按场取最新一行(last-run-wins);冗余超 1.2 倍才重写归并                                                   | `<userData>/learning/ledger.ndjson`                                  |
| `compare.ts`                      |   280 | 与参照语料对比;`N_FLOOR = 30`;流式吐 delta                                                                                                 | 每场一个 `compare.json`                                              |
| `recorder.ts`                     |   334 | 按 `segmentOpen`/`segmentClose` 外控 OBS;40 分钟安全阀;起停走单条 promise 链串行化                                                         | 自己不落盘(委托 `recordingsStore`)                                   |
| `recordingsStore.ts`              |   224 | 录像索引及其与对局的关联(`TOLERANCE_MS = 60_000` 重叠判据);按 `recordingKeepCount` 清理                                                    | `<userData>/recordings/` NDJSON 索引 + 视频文件                      |
| `settingsStore.ts`                |   313 | 带默认值的类型化设置、patch 净化、旧字段迁移、密钥字段用 `safeStorage` 加密                                                                | `<userData>/settings.json`                                           |
| `workerHost.ts`                   |    88 | 拉起/重启/重配 tail 日志的 utility 进程                                                                                                    | 无                                                                   |
| `workerMessageHandler.ts`         |   ~70 | `WorkerToMain` 消息的纯路由(入库、通知录像、推给窗口)                                                                                      | 无                                                                   |
| `crashPolicy.ts`                  |    28 | 判定反复崩溃的日志文件何时被隔离                                                                                                           | 无(内存)                                                             |
| `quitLifecycle.ts`                |    93 | `before-quit` 钩子:挂起退出 → 停录像(封顶 4 秒)→ 停 worker → 收掉在飞 AI → 真正退出                                                        | 无                                                                   |
| `slimWorker.ts`                   |    33 | `worker_threads` 入口:读 → parse → `slimStoredDoc` → 原子回写 → 回报每轮行偏移                                                             | 原地重写 `match.json`                                                |
| `importLogs.ts`                   |    90 | 历史日志的一次性流式导入(4 MB 块、手写 `\n` 切分);按 match id 去重,重复导入天然幂等                                                        | 经 `MatchStore` 写                                                   |
| `corpusLoader.ts`                 |    92 | 按优先级路径表加载 `reference_vectors.json`(userData 覆盖优先,再内置),带形状粗验                                                           | 只读                                                                 |
| `iconCache.ts`                    |    78 | 从 `wow.zamimg.com` 取技能图标,落盘为 `<name>.jpg`,以 data URL 返回;每会话 512 次取图预算;测试用 `offline` 模式                            | `<userData>/icons/`                                                  |
| `vodProtocol.ts`                  |    58 | 注册特权 `vod://` scheme,带 HTTP range 支持地提供录像                                                                                      | 读视频文件                                                           |
| `ipc.ts`                          |   195 | main↔renderer 的全部契约面:约 40 个 `ipcMain.handle` 频道                                                                                  | 无                                                                   |
| `ai.ts`                           |   123 | 后端选择(`resolveAiClient`)、教练系统提示、Anthropic 流式客户端、`stopAllAiActivity()`                                                     | 无                                                                   |
| `localAiBackends.ts`              |   549 | `claude` / `agy` / `codex` 三个 CLI 后端:纯 argv spawn(不过 shell)、300 秒超时、prompt 落盘中转、失败时附版本线索                          | `os.tmpdir()` 下的临时中转目录                                       |
| `cliDetect.ts`                    |   225 | 找 CLI 可执行文件:先 PATH,再常见安装目录;5 秒超时的轻量 `--version` 探测                                                                   | 无(进程内 memo)                                                      |
| `deepseekClient.ts`               |   247 | DeepSeek 官方 API(OpenAI 兼容 SSE);整体 + 停滞双看门狗;抠掉错误文本里的 key                                                                | 无                                                                   |
| `obsClient.ts`                    |   ~40 | 收敛到最小的 OBS websocket 面,好让 `recorder.ts` 全走 fake 单测                                                                            | 无                                                                   |
| `obsAutoConfig.ts`                |   105 | 读 OBS 28+ 自己的 websocket 配置 JSON,省得用户手抄密码。**只读** —— OBS 退出时会回写整个文件                                               | 无                                                                   |
| `aiDebugLog.ts`                   |    24 | 最近 10 次 AI 调用(prompt + 原始返回)的内存环形日志,供开发者页用。刻意不落盘                                                               | 无                                                                   |
| `exportImage.ts`                  |   ~90 | 在离屏窗口里渲染战报并整页截图为 PNG                                                                                                       | 写用户选定的 PNG                                                     |
| `detectWowDir.ts`                 |    30 | 仅 Windows 的 WoW 安装路径猜测,以及 `resolveLogsDir`                                                                                       | 无                                                                   |
| `e2eEnv.ts`                       |    19 | `GLADLOG_E2E=1` 下把 `userData` 指到临时目录 —— 参数不合法时**抛错**,绝不静默回落到真实目录                                                | 无                                                                   |
| `readNthLine`(在 `matchStore.ts`) |     — | 流式扫 `raw.txt` 找第 n 个 `\n` 并早停,而不是为取一行整读+切分一个 12–70 MB 的文件                                                         | 无                                                                   |

有三个模式反复出现,值得内化:

**在 Electron 边界做依赖注入。** 那些本来要 `import "electron"` 的模块,改成把 Electron 具体的部分作为构造参数收进来:`SettingsStore` 收 `safeStorage`,`RecorderService` 收一个 client 工厂,`quitLifecycle` 收三个纯函数。正因如此它们才有真正的单测 —— vitest 没法轻量实例化 Electron 的 `app`/`BrowserWindow`。

**服务是返回对象的工厂函数,类型靠推断。** `export type AnalysisService = ReturnType<typeof createAnalysisService>`,compare / learning / recorder 同理。`ipc.ts` 依赖这些推断出来的类型,所以「给服务加了方法却忘了暴露」是调用点的编译错误,而不是运行时的 `undefined`。

**失败降级,不上抛。** `recorder.ts` 把这条写成铁律:任何 OBS 失败只置 `lastError` 就到此为止 —— 解析、入库、分析绝不受录像影响。`corpusLoader` 沿路径表回退。`iconCache` 返回 `null`。`parseDocBytes` 遇到半写的文件返回 `null`,而不是把异常抛进 renderer。

### AI 后端

五个后端,在 `src/shared/aiModels.ts` 一处枚举(`AI_BACKENDS`、`AI_MODELS`、`AI_DEFAULT_MODEL`、`resolveAiModel`、`BACKEND_CLI_TOOL`),由设置存储、两个 AI 服务、设置面板共同消费。这个文件放在 `shared/` 是**构建**原因不是洁癖:renderer 绝不能值引入 `main/*`,否则 Rollup 会把 `fs`/`path` 卷进浏览器包 —— 而这个失败只在 `electron-vite build` 时才现形,本地 vitest 和 `tsc` 都是绿的。

- `anthropic` —— 官方 API,走 `@anthropic-ai/sdk` 流式。
- `claudeCli` / `agy` / `codex` —— 拉起本地 CLI。参数一律以数组传(绝不拼 shell 字符串),所以 prompt 里的对局数据永远不会被 shell 解释。Windows 上超过 `WIN_ARGV_PROMPT_LIMIT = 30,000` 字符的 prompt 会落到 `os.tmpdir()` 下的文件中转;超过一小时的陈旧中转文件每进程清扫一次。
- `deepseek` —— 官方 API,OpenAI 兼容 SSE。注意这一条会把 prompt 送出机器。

托管后端没配 key 时 `resolveAiClient` 返回 `null`,调用方服务据此退回确定性输出,而不是报错。

---

## 5. Renderer

`packages/desktop/src/renderer/src/`:

```
App.tsx                    四个顶层视图:对局 / 战绩 / 设置 / 开发者
bridge.ts                  window.__gladlogFixture ?? window.gladlog(一行;整个测试缝就在这)
fixtureBridge.ts           基于一份签入对局的假 GladlogApi,供纯浏览器开发用
batch/batchAnalysis.ts     串行批量分析驱动器(队列、取消、已缓存则跳过)
batch/autoAnalyze.ts       新对局自动分析;只对 live===true 的 payload 触发
components/                列表行、筛选、设置、战绩仪表盘、开发者面板、批量条
report/derive/             38 个非测试模块 —— 纯函数,doc → 视图模型
report/components/         41 个非测试组件
report/data/               竞技场地面多边形、专精名、游戏常量
```

### derive 层

`report/derive/*.ts` 是「对局文档 → 组件能渲染的东西」的地方。规矩是:它们必须是 `ReportSource` 的纯函数(`derive/types.ts`:一个 `StoredMatch` 或单个 `StoredShuffleRound` —— 两者同构),这样才能脱离 React 测试,并被图片导出与 markdown 导出复用。

代表性模块:`timeline.ts`、`meterRows.ts`、`statsTable.ts`、`deathRecap.ts`、`matchArc.ts`、`replay.ts` / `replayHighlights.ts`、`pressureLanes.ts`、`gcdCluster.ts`、`ccChainDash.ts` / `dispelDash.ts` / `kickDash.ts`、`burstLedger.ts`、`vulnWindows.ts`、`dampeningSeries.ts`、`auraUptime.ts`、`keyMoments.ts`、`videoMoments.ts`、`analysisInput.ts`、`exportReport.ts`、`inlineRich.tsx`、`findingDisplay.ts`、`jumpTarget.ts`、`slotLabel.ts`。

### `toLegacySafe` —— renderer↔analysis 的接缝

analysis 的函数要的是旧的 `ICombatUnit` 形状。`parser-compat` 导出了 `toLegacyMatch(m: GladMatch)` 来产出它,但 renderer 绝不能直接调那个。它调 `toLegacySafe`(`derive/legacySource.ts`,65 行),后者做两件事:

1. **给缺失的单位事件数组补空数组。** `parser-compat` 的转换器会无条件迭代每个单位的 13 个事件数组。渲染测试的 fixture 为控体积剥掉了 `healIn` / `absorbsIn` / `actionsIn` / `actionsOut`,裸调 `toLegacyMatch` 会直接抛 —— 而外层的 `try/catch` 会让所有 analysis 派生的面板**无声消失、不报任何错**。对生产 doc 而言这个垫片是零影响。
2. **带一个上限为 2 的有界 LRU。** 不用 `WeakMap`:`ShuffleReport` 会同时强引用全部 6 轮,逐轮点开就攒 6 份 legacy 放大副本(每份约为原轮的 2.5–3 倍)。上限 2 = 「当前轮 + 刚离开的那轮」。

### 三条既定数据通路,别发明第四条

出自 `.claude/skills/desktop-dev/SKILL.md` —— 动 `packages/desktop` 之前应该先读它:

1. **renderer 直调 analysis(首选)。** `derive/*.ts` → `toLegacySafe(source)` → 一个分析谓词。先例:`vulnWindows`、`deathRecap`、`statsTable`、`dampeningSeries`。
2. **main 服务 + IPC。** 凡是要落盘、扫目录、调 LLM 的都走这条。形状是:一个服务函数、`ipc.ts` 里一个 handler、preload 两处。进度与流式用推送频道(`gladlog:*:delta` / `:progress`)。
3. **纯数据 import。** 纯数据导出(`SPELL_CATEGORIES`、`zoneMetadata`、图标表)renderer 随便 import。

同一份文档里还有:回放时钟是 `ReplayView` 的局部 state(提升它会让三个视图随每个 tick 重渲);跨视图 seek 用 `seekReq {tMs, unitNames, nonce}` prop,nonce 防重复消费;以及 `CandidateEvent.t` 与全部 derive 输出用的是**相对秒**,而回放时钟与原始事件时间戳是**绝对毫秒**,换算只在 `MatchReport` 边界做一次。

### 战报的 tab

`MatchReport.tsx`(579 行)有五个:`report`(战报)、`replay`(回放)、`events`(事件)、`video`(录像,仅在关联到录像时出现)、`ai`(AI 分析)。`ShuffleReport.tsx` 在外面套一层轮次选择。

---

## 6. `@gladlog/analysis` 内部

35,325 行,分七个子目录。这是最大的包,也是唯一真正懂竞技场 PvP 的那个。非测试部分的分布:

| 子目录       | 文件数 |   行数 | 职责                               |
| ------------ | -----: | -----: | ---------------------------------- |
| `utils/`     |     39 | 14,141 | 推导「这场发生了什么」的事实       |
| `context/`   |      9 |  7,786 | 把这些事实渲染成 prompt 文本       |
| `data/`      |     30 |  4,204 | 游戏数据(外加约 17 MB 的 `.json`)  |
| `analysis/`  |     10 |  3,069 | LLM findings 闭环及其审计          |
| `learning/`  |      4 |    495 | 跨场模式挖掘                       |
| `benchmark/` |      2 |    423 | 离线的语料基线采集                 |
| `compare/`   |      6 |    362 | 把单个玩家放进已构建好的语料里定位 |

有两组划分容易混。**`utils/` 回答「发生了什么」;`context/` 回答「它在 prompt 字符串里长什么样、落在哪个时间网格上、用多大采样半径」** —— 而门规复算的是后者。另外,**`benchmark/` 是离线*产出*基线的(唯一消费方是 CLI `scripts/collectBenchmarks.ts`),`compare/` 是运行时*读取*已构建语料的**;两者不是彼此的辅助。

### `src/utils/` —— 39 个非测试分析模块

它们计算这场对局的事实。绝大多数成对出现:一个返回结构化数据的 `computeX`/`analyzeX`,和一个把它渲染成 prompt 文本的 `formatXForContext`。

**冷却与减伤**

| 模块                                | 行数     | 算什么                                                                                                                                                                                                                                                |
| ----------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cooldowns.ts`                      | 1,830    | 主力模块。时点 HP/法力采样、冷却可用性(`cdAvailableAt`、`isCooldownAvailableFromLastUse`)、大冷却提取、承压窗口、恐慌/重叠减伤检测,外加全仓通用的专精助手 `specToString` / `isHealerSpec` / `isMeleeSpec` 和时间渲染器 `fmtTime` / `toRenderSecond`。 |
| `counterfactual.ts`                 | 386      | 「这个减伤按了能省多少」—— 减伤审计、未按的自保、错过的外抬。                                                                                                                                                                                         |
| `enemyCDs.ts`                       | 573      | 重建敌方冷却时间线与击杀尝试窗口。                                                                                                                                                                                                                    |
| `talentBehaviors.ts`                | 353      | 策展的 PvP 天赋 → 行为目录(取自官方 tooltip,不是从日志推断的)。                                                                                                                                                                                       |
| `talents.ts` / `talentModifiers.ts` | 150 / 17 | 天赋串解码,以及天赋驱动的冷却/充能修正。                                                                                                                                                                                                              |

**控制、驱散、打断**

| 模块                                  | 行数      | 算什么                                                          |
| ------------------------------------- | --------- | --------------------------------------------------------------- |
| `dispelAnalysis.ts`                   | 1,372     | 防御性解控与进攻性驱散的机会/错失分析,带击杀窗口标注与豁免。    |
| `ccTrinketAnalysis.ts`                | 962       | 打在记录者身上的控制链与饰品使用;判定饰品类型。                 |
| `drAnalysis.ts`                       | 564       | 按目标按类别的递减状态 —— 为什么这个控制变短了,以及出控链质量。 |
| `kickAudit.ts` / `enemyInterrupts.ts` | 171 / 108 | 打断审计;每专精的基础打断可用性。                               |

**走位与视线**

| 模块                        | 行数 | 算什么                                                                      |
| --------------------------- | ---- | --------------------------------------------------------------------------- |
| `positionAnalysis.ts`       | 819  | 从真实 X/Y 坐标算记录者的接战状态:什么时候该压上、什么时候该拉开。          |
| `losAnalysis.ts`            | 395  | 位置插值、`hasLineOfSight`、`distanceBetween`、最近障碍物边缘、断视线选项。 |
| `positionSampling.ts`       | 34   | **共享采样谓词** —— 见 §9。                                                 |
| `healerExposureAnalysis.ts` | 835  | 在每个敌方爆发窗口:治疗有没有饰品、在不在控里、和敌人有没有视线?            |

**进攻与窗口**

| 模块                           | 行数 | 算什么                                     |
| ------------------------------ | ---- | ------------------------------------------ |
| `healerOffenseAnalysis.ts`     | 914  | 治疗的进攻贡献:空闲段、争夺段、窗口创造。  |
| `offensiveWindows.ts`          | 527  | 爆发子窗口与进攻窗口。                     |
| `killWindowTargetSelection.ts` | 461  | 击杀窗口里选对目标了吗(时点 HP、饰品状态)? |
| `burstLedger.ts`               | 416  | 每次爆发的施法台账与窗口目标审计。         |
| `offensiveWasteAnalysis.ts`    | 210  | 打在窗口之外的进攻冷却。                   |

**结果、资源、局势**

| 模块                                                                                              | 行数                 | 算什么                                                                  |
| ------------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------- |
| `deathOutcomeAnalysis.ts`                                                                         | 543                  | 每次死亡:当时什么是可用的、什么被锁住了。                               |
| `healingGaps.ts`                                                                                  | 289                  | 治疗覆盖的空档。                                                        |
| `dampening.ts`                                                                                    | 255                  | 各分段的经验削弱爬升、时间线、危险倍率。                                |
| `matchArchetype.ts` / `archetypeInference.ts` / `archetypeInjection.ts` / `enemyCompArchetype.ts` | 233 / 153 / 148 / 16 | 对局原始测量,以及查语料 cell 用的粗粒度敌方阵容分桶。                   |
| `combatStates.ts`                                                                                 | 257                  | 救赎之魂 / 变形 / 静止(Stasis)区间。                                    |
| `auraIntervals.ts`                                                                                | 163                  | 把光环事件配对成区间 —— 「这个 buff 在 _t_ 时刻在不在身上」的唯一答案。 |
| `healerMetrics.ts` / `dpsMetrics.ts`                                                              | 204 / 120            | 语料对比用的指标向量。                                                  |
| `crisisEvents.ts`                                                                                 | 85                   | 危机点周边的手法抽取。                                                  |
| `spellDanger.ts` / `spellSchools.ts`                                                              | 75 / 54              | 危险度加权与法术学派助手。                                              |
| `specBaselines.ts`                                                                                | 77                   | 静态的每专精基线锚点。                                                  |

**小型共享原语**
`stats.ts`(顺序统计量 —— 任何按索引取分位的地方都必须先过 `toSortedFinite`,不要各自 sort)、`binarySearch.ts`、`memoize.ts`(本地替身,免得整包为四个函数拖 215 KB lodash;它**刻意不缓存**后台数据表加载完成前算出的结果)、`utils.ts`。

### `src/context/` —— prompt 构建

这里是分析产物变成模型所见文本的地方。没有单一的巨型 prompt 构建器;有五个入口对应五种不同的 LLM 调用,其中三个是主要的:

| 入口                                                 | 定义于                              | 用于                           |
| ---------------------------------------------------- | ----------------------------------- | ------------------------------ |
| `buildMatchContext(combat, friends, enemies, opts)`  | `context/buildMatchContext.ts`      | 富上下文 —— 每个 prompt 的主体 |
| `buildFindingsPrompt(candidates, richContext, spec)` | `analysis/buildFindingsPrompt.ts`   | 教练闭环第一轮                 |
| `buildDeepDivePrompt(...)`                           | `analysis/deepDive.ts`              | 第二轮,自动追问                |
| `buildExemplarLedPrompt(...)`                        | `compare/buildExemplarLedPrompt.ts` | 群体对比的叙述                 |
| `buildDistillPrompt(...)`                            | `learning/distillRules.ts`          | 跨场习惯提炼                   |

`buildMatchContext` 是编排者而非计算者:它从 `utils/` import 约 25 个 `formatXForContext`,把共享的部分(对齐后的爆发窗口、控制/饰品摘要)只算一次再往下递,免得各个 section 各自重算出略有差异的版本。

| 模块                              | 行数    | 职责                                                                                             |
| --------------------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| `matchTimeline.ts`                | 2,617   | `buildMatchTimeline` —— 渲染后的事件时间轴,prompt 的主体。                                       |
| `buildMatchContext.ts`            | 1,241   | `buildMatchContext` —— 顶层 prompt 入口。                                                        |
| `timelineHelpers.ts`              | 924     | 共享渲染助手;导出 `DMG_SPIKE_THRESHOLD`,renderer 的承压泳道 import 它,以保证泳道数=prompt 行数。 |
| `matchTimelineSections.ts`        | 820     | `[STATE]` 等各 section 的渲染器。                                                                |
| `resourceSnapshot.ts`             | 818     | 配装、就绪充能、冷却中的名字,以及 JSON 局势快照。                                                |
| `matchNarrative.ts`               | 431     | 「Match Flow」叙事,按爆发窗口而非时间片切段,以保住因果顺序。                                     |
| `criticalWindows.ts` / `utils.ts` | 70 / 52 | 窗口助手。                                                                                       |

### `src/analysis/` —— findings、prompt、审计

| 模块                                                  | 行数         | 职责                                                                                                                                   |
| ----------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `candidateFindings.ts`                                | 1,133        | `extractCandidateFindings` —— 模型被允许谈论的确定性候选(冷却浪费、错失解控/驱散、被控住、吃打断、饰品浪费、死亡布置、未按自保/外抬)。 |
| `deepDive.ts`                                         | 1,066        | 追问轮:围绕某条 finding 或某个选定窗口的证据包,以及它们的 prompt 与审计。                                                              |
| `buildFindingsPrompt.ts`                              | 90           | findings prompt。                                                                                                                      |
| `auditFindings.ts`                                    | 134          | 出模型后的审计:凡带裸数字、编造事件、或违禁因果断言的一律丢弃。                                                                        |
| `causalLint.ts`                                       | 277          | 纯正则的强因果**措辞**检查(策略禁止),中英双语。它查的是措辞,不是真伪。                                                                 |
| `spellNameZhLint.ts`                                  | 171          | 防止输出里把技能名译成中文。                                                                                                           |
| `parseModelJson.ts`                                   | 63           | 容错的 JSON 抽取(带 markdown 围栏也认)—— `bad-json` 误杀那一类的修法。                                                                 |
| `findingCategories.ts` / `types.ts` / `factFormat.ts` | 81 / 38 / 16 | 类别归一化与共享类型。                                                                                                                 |

### `src/compare/`、`src/benchmark/`、`src/learning/`

- **`compare/`**(362 行):在预先构建的语料 cell 里查你的指标(`cellLookup.ts`),用三个存储锚点算成百分位(`verifiedComparison.ts`),构建 exemplar-led prompt,并强制占位符纪律(`claimChecker.ts` —— 占位符语法在这里单源定义,因为此前三个消费方各写各的正则、已经漂过)。
- **`benchmark/`**(423 行):`createBenchmarkAccumulator` / `computeBenchmarks` / `toPercentiles`,外加 `stratifiedSample`(按 spec × archetype 分层,每层确定性截断 —— 取前 N,不用随机数)。仅离线:唯一消费方是 CLI `scripts/collectBenchmarks.ts`,其输出被拷进 `src/data/benchmarks.json`。应用里没有任何地方调它。
- **`learning/`**(495 行):自学习教练闭环,四段 —— 台账(`types.ts`)→ 确定性筛(`patternScan.ts`)→ AI 提炼(`distillRules.ts`)→ 确定性规则应用(`matchRules.ts`)。`patternScan.ts` 是 `PATTERN_MIN_HITS`、`PATTERN_WINDOW_MATCHES`、`RULE_RETIRE_MAX_HITS` 及匹配谓词的唯一权威;规则退役(`main/learning.ts`)与习惯徽章(`matchRules.ts`)都 import 它而不是复制数值,这样「筛出来的模式」与「打上徽章的 finding」才是同一个判定。注意跨场的键是 **`category`(加候选事件类型),不是 `findingKey`** —— `findingKey` 内嵌了每场独有的 event id,按构造永不重复。`distillRules.ts` 允许模型把模式说成人话,但它能写的数字只有 `{{hits}}` 与 `{{windowMatches}}`,由代码插值。

### `src/data/` —— 游戏数据,生成的与策展的

两层,策展层恒赢。`spellEffectData.ts` 就是这个范式:`{...SPELL_EFFECTS_GENERATED, ...SPELL_EFFECT_OVERRIDES}`。

生成物由 `packages/analysis/scripts/datagen/` 从 wago.tools 的 DB2 导出产出,来源 build 记在 `src/data/datagen-manifest.json`。按签入的 manifest(build `12.1.0.68629`,生成于 2026-08-01):

| 生成物                            | 规模                                    |
| --------------------------------- | --------------------------------------- |
| `spellNames.json`                 | 413,355 条,12,223,778 字节              |
| `talentIdMap.json`                | 40 个专精(磁盘 3.2 MB)                  |
| `spellIconsGenerated.json`        | 41,707 条,7,110 个不同图标,780,473 字节 |
| `spellNamesZhGenerated.json`      | 39,668 条,960,177 字节                  |
| `spellEffectGenerated.ts`         | 3,560 条,219,135 字节                   |
| `mitigationGenerated.json`        | 15 条(3 条未解析),1,206 字节            |
| `parser-compat/enumsGenerated.ts` | 41 个专精,14 个职业                     |

策展表(`spellCategories.ts`、`classSpells.ts`、`drCategories.ts`、`spellTags.ts`、`spellEffectOverrides.ts`、`mitigationData.ts`、`arenaGeometry.ts`、`zoneMetadata.ts`、`spellNameStopwords.ts` 等)是手工维护的白名单。它们每个补丁都会腐烂 —— 见 §9.7。

还有第三类值得单独点名:**语料实证**数据。`dispelObservedGenerated.ts` 是「真实对局里确实有人驱散/偷取过」的法术 id 集合,它之所以存在,正是因为这跟 DB2 问的不是同一个问题。DB2 的 `dispelType` 说的是「理论上可驱散」;这张表说的是「真的发生过」。错失解控/错失驱散的候选是按后者把门,不是前者。

### 公共 API 面

`packages/analysis/src/index.ts`(92 行)re-export 了 prompt 构建器、`utils/` 的大部分、compare 与 findings 模块,以及具名的数据表。但注意:**main 刻意绕开这个 barrel。** `src/main/analysis.ts` 与 `compare.ts` 都从深路径 import(`@gladlog/analysis/src/analysis/...`),并附了理由 —— `index.ts` 会把那些带顶层 `await` 的数据模块拖进来,顶层 await 使 tree-shaking 失效,main 白付约 13.6 MB 读盘和约 40 MB 常驻堆,而它根本不查这些表。

---

## 7. `@gladlog/parser` 与 `@gladlog/parser-compat` 内部

### L1 —— 行解码(986 行,`src/l1/`)

纯粹且无状态:一行文本进,一个 `ParsedLine` 出,认不出的一律 `null`(整个分派体被 `try/catch → null` 包住)。

- `splitTopLevel.ts` —— 一个按逗号切但尊重引号、`[]` 深度与 `()` 深度的分词器;`splitLine` 在第一个双空格处把行切成 `{datePart, eventName, params}`。
- `timestamp.ts` —— `parseTimestamp`。带显式 `±offset` 后缀时是纯算术;不带时,它对着一个缓存的 `Intl.DateTimeFormat` 跑三轮定点迭代,把墙钟时间反解回 UTC。
- `decoders.ts` —— 12 个纯解码器(`decodeBaseUnits`、`decodeSpell`、`decodeDamage`、`decodeHeal`、`decodeAdvanced`、`decodeAura` 等)。advanced 参数的位置是**探测出来的**而非写死:`decodeAdvanced` 向前扫描第一对相邻的含点 token 来定位 `(x, y)`,所以暴雪加字段不会把它打坏。
- `combatantInfo.ts` —— 同样位置无关:它靠扫描下一个括号段来定位天赋 / PvP 天赋 / 装备 / interesting auras。
- `types.ts` —— `ParsedLine`,它那些可选的解码字段类型写成 `ReturnType<typeof decodeX>`,于是解码器本身就是 schema。`ParsedLine.known` 是未处理事件的信噪比标志。

### L2 —— 分段(197 行,`src/l2/`)

`Segmenter` 是三态状态机(`IDLE` / `IN_MATCH` / `IN_SHUFFLE`)。Solo Shuffle 的判据就是 `bracket === "Rated Solo Shuffle"`;它的各轮由连续的 `ARENA_MATCH_START` 行分隔,只有最后一个 `ARENA_MATCH_END` 才闭合整个 lobby。诊断码:`DOUBLE_START`、`ORPHAN_END`、`UNCLOSED_SEGMENT`。

L2 拥有两样对下游要紧的东西:

- **`lineIndex`** 在这里赋值(`line.lineIndex = currentSegment.rawLines.length`,紧挨着两个数组的 push 之前)。这是「从 UI 里的事件跳回原始日志行」这个功能的锚点。
- **`onOpen` / `onClose`** 只在真正的 IDLE↔开启转换上触发 —— 整个 shuffle lobby 一对,不是每轮一对。它们存在是为了让 OBS 录像知道对局何时开始、何时结束。

### L3 —— 收集与组装(959 行,`src/l3/`)

- `roster.ts` —— 建单位表。单位类型先按 GUID 前缀判、再按 flags;阵营(reaction)按该 GUID 见过的全部 flag 值**多数表决**。宠物经 advanced 的 `ownerGuid` 映射到主人,`SPELL_SUMMON` 是严格更低优先级的兜底。
- `collect.ts` —— 单趟把每条记录扇出到八个分组;同一个事件对象同时 push 进来源与目标单位的数组(共享引用,不是拷贝)。
- `compose.ts` —— `buildMatch` / `buildShuffle`。两个值得知道的事实:**match id 是 `rawLines` 的 FNV-1a 32 位哈希**,渲染成 8 个十六进制字符,所以 id 由内容决定且稳定;shuffle 单轮的 `endTime` 被夹到决定性死亡 + 2 秒宽限,因为轮次自己没有 `ARENA_MATCH_END`,而朴素的「最后一条记录」会把时长虚增约 35 秒(还会让死人看起来在施法)。
- `outcome.ts` —— 结果码,以及「本轮胜者是首次死亡那一方的对面」。
- `model.ts` —— 全部输出类型:`GladMatchBase`、`GladMatch`(`kind: "match"`)、`GladShuffleRound`(`kind: "shuffleRound"`,另有 `sequenceNumber`)、`GladShuffle`(它**不是** `GladMatchBase`,而是 `{kind, rounds, startTime, endTime, rawLines, result}`)、带 16 个事件数组的 `GladUnit`,以及各事件类型。

### `src/slim.ts` —— 文档为什么小

`slimMatchParams` 把每个事件的原始 `params` 数组截到 `SLIM_PARAMS_KEEP = 13` 项,并把除下标 2、6、10(单位旗标与法术学派,由 `parser-compat` 消费)以及非 HP 事件的 11、12(光环类型/层数、驱散/打断的额外法术,由 analysis 消费)之外的全部置空。下标 13 以后的全是 advanced logging 尾巴,早已被物化进 `advancedSamples` / `hp` / `crit` —— 实测占单份 442 MB shuffle 文档的 **53%**。

三条性质:它在 `compose.ts` 里于构造时就跑(文档出厂即瘦);截断前先从尾巴物化 `crit`,所以旧的肥档能正确自愈;而且幂等(已瘦事件的判据是 `params.length <= 13 && params[0] === ""`)。

`CHANGELOG.md` 记录的全库迁移把对局文件总量从 **75.2 GB 降到 49.0 GB(−35%)**。

### `src/api.ts` 与 `src/invariants.ts`

`GladLogParser` 是流式门面:`push(rawLine)` / `end()` / `on(event, cb)` / `stats()` / `hasOpenSegment()`,七个事件。`push()` 会先剥掉行尾 `\r` —— CRLF 日志下诈死位的比较变成了 `"1\r" !== "1"`,于是每一次假死都被算成真死。L3 组装失败会被降级成 `BUILD_FAILED` 诊断而不是抛出。

`checkParserInvariants(m)` 返回七类违规:`time-bounds`、`monotonic`、`hp-range`、`death-has-damage`、`pet-owner-resolves`、`start-before-end`、`line-resolves`。每个阈值都标注了定它的语料实测 —— 例如 `HP_OVER_MAX_RATIO = 1.75` 来自 3,841 个样本(p99 = 1.49、max = 1.58);`MONOTONIC_TOLERANCE_MS = 5000` 对应实测最大回退 2,084 ms。这就是本仓通用的「先测量、后锁定」范式。

### `@gladlog/parser-compat`

只有一个方向:新文档 → 旧的 `IArenaMatch` / `IShuffleMatch`,单位是 `ICombatUnit`。导出 `toLegacyMatch`、`toLegacyShuffle`、一个可直接替换的 `WoWCombatLogParser` shim 类、旗标→枚举助手,以及枚举本身。

不显然的转换:数字 id 变成字符串;伤害数值取**负**;吸收被并进攻击者的 `damageOut` 并按时间重排;宠物的伤害/治疗并入主人,而打**到**宠物身上的伤害置零;没有 `COMBATANT_INFO` 的玩家单位被整个丢弃;`advancedActorPowers` 恒为 `[]`,因为新 parser 不收集能量/法力(一处有记录的降级)。

`src/enums.ts` 里的枚举带有一条许可说明:它们此前是从另一个项目按 CC BY-NC-ND 4.0 抄来的,与本仓的 MIT 不兼容,现已逐条重新锚定到暴雪公开事实(专精/职业枚举由 DB2 生成到 `enumsGenerated.ts`;`LogEvent` 的值就是日志里的字面 token;旗标掩码是 `COMBATLOG_OBJECT_*`)。`data/legacy-enum-manifest.json` 锁住成员数量,`test/enums.test.ts` 逐成员断言。详见 [DATA-COMPLIANCE.zh-CN.md](DATA-COMPLIANCE.zh-CN.md)。

---

## 8. 数据落在哪

一切用户产生的数据都在 Electron 的 `userData` 目录下 —— macOS 是 `~/Library/Application Support/gladlog`,Windows 是 `%APPDATA%\gladlog`。

```
<userData>/
├── settings.json                 GladlogSettings;密钥字段经 safeStorage 加密
├── checkpoints.json              { files: { "<日志文件名>": {offset, firstLineChecksum} } }
├── reference_vectors.json        可选:覆盖内置对比语料
├── icons/                        <技能图标名>.jpg,取自 wow.zamimg.com,无驱逐
├── recordings/                   OBS 录像的 NDJSON 索引 + 视频文件
├── learning/
│   ├── ledger.ndjson             一行一次分析 run(只追加,按场取最新)
│   └── rules.json                提炼出的跨场规则
└── matches/
    ├── _index.ndjson             只追加的 StoredMatchMeta 行;同 id 以最后一行为准
    └── <matchId>/
        ├── meta.json             StoredMatchMeta(列表行:阵容、评分、时长…)
        ├── match.json            {schemaVersion, storedAt, kind, data}  ← 文档本体
        ├── raw.txt               原始日志行,按 "\n" 拼接
        ├── analysis-v2.<lang>.json     AI findings,按模型分槽(见下)
        ├── windowAnalysis.<lang>.json  选段分析,LRU 上限 20
        └── compare.json                参照语料对比结果
```

### 写入是原子的

一场对局先写进 `.tmp-<dir>`,再 `rename` 覆盖到最终目录。NDJSON 索引正常路径只追加,需要修复时用 tmp + rename 整体重写。`MatchStore.init()` 会拿磁盘上的目录名与索引对账 —— 把「目录在、索引行因崩溃丢了」的对局捞回来,把「目录已不在」的索引项删掉。同一套 tmp + rename 纪律也用于 `checkpoints.ts`、`learningLedger.compact()`、分析缓存与 `slimWorker.ts`。

### 实际会长到多大

2026-08-01 在作者本机实测。**这是一台机器的数字,不是规格** —— 按它做设计之前请测你自己的。

| 项目         |       数量 |      总量 |   中位数 |     p75 |      p95 |     最大 |
| ------------ | ---------: | --------: | -------: | ------: | -------: | -------: |
| 对局(目录数) |        808 |     62 GB |        — |       — |        — |        — |
| `match.json` |        808 |   49.2 GB |  46.3 MB | 99.6 MB | 161.2 MB | 264.1 MB |
| `raw.txt`    |        808 |   13.1 GB |  12.4 MB |       — |        — |  70.8 MB |
| `meta.json`  |        808 | 约 0.5 MB | 约 700 B |       — |        — |        — |
| `icons/`     | 121 个文件 |    484 KB |        — |       — |        — |        — |

这台机器上只有 2 场带分析缓存、1 场带对比结果 —— AI 功能是可选且按场触发的,所以库里压倒性地是解析后的文档。`recordings/` 与 `learning/` 目录不存在(本机从未用过)。

关键一句:**单场文档中位数 46 MB,长尾超过 260 MB。** §9 里每一条设计决定都是从这一个数字推出来的。

### 分析缓存的信封

`src/shared/analysisSlots.ts` 定义了按模型分槽的 v2 信封:

```ts
interface AnalysisCacheDocV2<T> {
  schemaVersion: 2;
  language: string;
  slots: Record<string, AnalysisSlot<T>>; // 键 = slotKeyOf(backend, model) = "agy:pro"
  lastSlotKey: string; // 当前应展示/消费的那一槽
}
interface AnalysisSlot<T> {
  promptVersion: number;
  createdAt: number;
  result: T;
}
```

同一场再换个模型跑,是**加一槽**而不是覆盖旧槽 —— 这正是多模型并排对比能成立的原因。`toSlottedDoc` 把 v1 的单结果文件在内存里懒包装成单槽 v2(不回写文件);`resolveActiveSlot` 是唯一的读侧判据;`upsertSlot` 是唯一的写侧判据;`slotKeyOf` / `splitSlotKey` 是槽键唯一被拼接与拆分的地方。

缓存失效由 `PROMPT_VERSION` 加语言决定。文件名是 `analysis-v2.<lang>.json`;旧的 `analysis-v2.json`(语言分键之前写的,那时输出恒为英文)只在请求英文时才会被读。

`windowAnalysis.<lang>.json` 是至多 20 条选段分析的 LRU,每条各自带 `promptVersion` 戳 —— 按条不按文件,因为一个文件里装着许多互不相干的窗口,一次版本 bump 不该把它们全炸掉。

另外注意:**学习台账刻意独立于分析缓存。** 它只记录 `promptVersion` 但从不据此作废 —— 教练的长期记忆不能每次 prompt 构建器一改就被抹掉。

---

## 9. 几条贯穿性约束

这些是会咬你的地方。每一条都附了实测代价。

### 9.1 大 JSON 必须走 `JSON.parse`,不能编成对象字面量

`spellNames.json` 有 413,355 个键。Vite 的默认值(`json.stringify: false`)会把 JSON import 编译成 JavaScript 对象字面量,而 V8 必须把它**当作源码**来解析。实测:首屏被阻塞约 **22 秒**。同样的数据走 `JSON.parse` 只要 **42 ms**。

修法是 `json: { stringify: true }`,而且**三个** electron-vite 构建目标都得显式打开(`packages/desktop/electron.vite.config.ts`),外加独立的浏览器试验台(`packages/desktop/dev/vite.config.mts`)—— 因为 main 与 renderer 都会经 analysis 包吃到这份数据。

前后对比(出自 `docs/BACKLOG.md`):

| 指标           | 修前       | 修后       |
| -------------- | ---------- | ---------- |
| 应用冷启动     | 18.7–24.0s | 1.59–1.72s |
| 报表首渲       | 21.9–27.0s | 2.12–2.19s |
| 视觉套件总耗时 | 3.0 分钟   | 22 秒      |
| E2E 套件总耗时 | 1.3 分钟   | 14.5 秒    |

这个失效模式**完全不报错** —— 只表现为「应用很慢」—— 所以它靠预算把门,而不是靠人肉察觉:`packages/desktop/qa/budgets.ts` 把 `parse` / `firstPaint` / `coldStart` 锁在 4900 / 3300 / 2600 ms(CI 采样最大值 × 1.5)。修复前这三个预算是 5100 / 41000 / 36000。放宽任何一个都要把理由写进 commit message。

生成的数据模块遵循同一规则:`spellIconsGenerated.ts` 与 `spellEffectGenerated.ts` 是薄薄的 `.ts` 包装,负载放在同名 `.json` 里。`spellIconsGenerated.json` 还额外做了字典编码 —— 41,707 条只用到 7,110 个不同图标名,平铺 `Record` 有 48% 是重复字符串(1.5 MB → 780 KB);包装层再展开回去,消费方 API 不变。

### 9.2 大表后台加载;prompt 路径必须等它

`spellNames.json`(12 MB)与 `talentIdMap.json` 是在模块求值时踢出一个 fire-and-forget 的动态 `import()` 加载的,**不是**顶层 `await` —— TLA 会让整个模块图(包括 renderer 首屏)串行等一张对局列表根本不查的表。

契约在 `packages/analysis/src/data/ensure.ts`:

- **任何构建 prompt 的入口必须先 `await ensureAnalysisData()`。** prompt 里的法术名与天赋名不许降级,因为门规会复算渲染文本。凡是能走到 prompt 构建函数的脚本都由 `packages/eval/test/ensureAnalysisDataEntrypoints.test.ts` 检查(会顺着库模块的导入往下追);2026-09-24 曾有 25 个脚本漏了这一步,导致进程里头几场的天赋冷却被悄悄降级。
- **UI 展示路径可以不等。** 它们走兜底(日志名、空数组),下次渲染自愈。

现有三个这样的入口:renderer 的 `StructuredAnalysisPanel`(有 `dataReady` 门)、`main/analysis.ts` 的深挖路径、`eval` 的语料构建器。新增第四个照抄。

相关:`memoize.ts` 拒绝缓存表还没载完时算出的结果,否则那个降级答案会被永久冻住。

### 9.3 一份对局文档全链路只物化一次

旧路径在 worker 解析一次、在 main 再解析一次、在 renderer 又解析一次。一场 426 MB 的对局实测**三个进程合计约 5 GB 峰值堆**,而且 main 的 LRU 长期常驻两份完整对象图(1–2 GB)。

现在的路径:

- `MatchStore.get(id)` 返回 `match.json` 的**原始 `Buffer`**。main 里没有任何地方 parse doc。
- main 的 LRU 缓存字节,按**总字节封顶**(`LRU_MAX_BYTES = 256 MB`、`LRU_MAX_ENTRIES = 2`)。单档超顶就干脆不缓存 —— 交给 OS 的 page cache。
- `parseDocBytes`(`src/shared/parseDocBytes.ts`)跑在 **preload**,与 renderer 同一个堆,于是唯一的那次物化就是 UI 在用的那份。

由此必须遵守的推论:

- **绝不要在 renderer 里 `JSON.stringify` 整场数据,也绝不要把整场经 IPC 传输。** 把一个 46 MB(中位)乃至 264 MB(长尾)的对象图做结构化克隆穿过进程边界,两头都会冻死。
- **绝不要为取其中一小块而整读一个文件。** `readNthLine` 按 1 MB 块流式扫 `raw.txt` 并在目标行早停,因为旧实现的「整读再 split」在中位 12 MB 的文件上就能冻住主线程。同理,shuffle 各轮的行偏移被缓存在 `meta.roundLinesTotal` 里,取一行原始日志不必 parse 整份文档。
- **重活交给 worker 线程。** `rebuildIndex()` 在 worker 里逐份 parse `match.json`(同步版本在 794 场上是约 83 GB 读盘 + 6–10 分钟纯冻结);`slimWorker.ts` 在后台对旧肥档做读-parse-瘦身-回写,不挡打开路径。

### 9.4 门规谓词即规范

这是本仓第一条铁律,写在 `CLAUDE.md` 里。同一个事实的任何两个消费者 —— 分析与验证门、main 与 renderer、prompt 与 UI —— 必须 import **同一个常量、同一个函数**,并**锚定在渲染值上**。prompt 用 `fmtTime` 渲染时间(向下取整到整秒),门规再去解析这段渲染文本;所以任何门规会复算的判定,都必须在渲染网格上做,而不是在小数秒上。

现存的例子:

| 谓词                                               | 定义于                                    | 还有谁 import                                                                                                                                        |
| -------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HP_SAMPLE_RADIUS_MS = 3000`                       | `analysis/src/utils/cooldowns.ts`         | `matchTimeline.ts`、`matchTimelineSections.ts`、`candidateFindings.ts`、`killWindowTargetSelection.ts`                                               |
| `LOS_SWEEP_SLACK_S = 2`、`LOS_SWEEP_GAP_MS = 3000` | `analysis/src/utils/positionSampling.ts`  | `analysis/src/utils/healerExposureAnalysis.ts`,以及 `eval/src/quality/positioningScan.ts`(在那里别名为 `TIME_SLACK_SECONDS` / `POSITION_MAX_GAP_MS`) |
| `INTERP_MAX_GAP_MS = 1500`                         | `analysis/src/utils/positionSampling.ts`  | 单点位置插值的 grounding 守卫 —— 刻意**不**等于 `LOS_SWEEP_GAP_MS`                                                                                   |
| `PATTERN_MIN_HITS` 及同族                          | `analysis/src/learning/patternScan.ts`    | `main/learning.ts`、`analysis/src/learning/matchRules.ts`                                                                                            |
| `DMG_SPIKE_THRESHOLD`                              | `analysis/src/context/timelineHelpers.ts` | renderer 的承压泳道                                                                                                                                  |
| `findingKey`                                       | `desktop/src/shared/findingKey.ts`        | main 的聚合与 renderer 的标记按钮                                                                                                                    |
| `slimStoredDoc`                                    | `desktop/src/shared/slimDoc.ts`           | `slimWorker.ts`、全库迁移脚本、preload 的解析兜底                                                                                                    |
| `slotKeyOf` / `splitSlotKey`                       | `desktop/src/shared/analysisSlots.ts`     | main 的深挖路径与 renderer 的槽标签                                                                                                                  |
| `BUDGET_MS`                                        | `desktop/qa/budgets.ts`                   | parser 的解析预算测试、视觉首渲 spec、E2E 冷启动 spec                                                                                                |

`positionSampling.ts` 的文件头值得整段读一遍:这些常量曾经散在四处私有声明,只靠一句「MUST stay equal to positioningScan.ts」的注释耦合。2026-07 全量审计里 5 个独立 bug 全是这一形态 —— HP 采样半径不一致、有界 vs 无界回溯、LoS 用插值 vs raw vs 非同时刻采样、小数秒 vs 渲染秒的扫描网格。修法永远是让分析消费门规的谓词,绝不是放松门规。

同一个文件还警告了一个同名陷阱:`INTERP_MAX_GAP_MS` 与 `LOS_SWEEP_GAP_MS` 都曾叫 `POSITION_MAX_GAP_MS`,值分别是 1500 和 3000。

另有两个很有教益的案例:

- **`context/criticalWindows.ts`。** 一次 50 场的 eval 里,31 + 6 个缺陷最后归到同一个根因:`[STATE]` tick 在关键窗口内把 HP 采样半径收窄到 ±1.5 秒,而 `[DMG SPIKE]` / `[CD]` 行用的是 ±3 秒 —— 而这些行**恰恰只出现在关键窗口里**。于是同一个渲染秒,一行报 2% HP、另一行报 88%。最终是把那个更窄的半径整个删掉,而不是逐处对齐数值。
- **被删掉的 `HP_SAMPLE_RADIUS_CRITICAL_MS`。** `cooldowns.ts` 里 `HP_SAMPLE_RADIUS_MS` 下方那段长注释记着理由:`getUnitHpAtTimestamp` 是先取最近样本、再用半径决定接受与否,所以改半径只能把值变成 null,**永远不会改变取到的数值**。收窄它什么都没修好(26/50 → 26/50),却在 24/50 场里把单位整个从 `[STATE]` 行删掉了。真根因是网格未对齐,由 `toRenderSecond` 修好。

`packages/analysis/test/cdAvailablePredicateConvergence.test.ts` 就是为这一类问题设的防漂移哨兵:它点名了六个曾经各自实现「死亡/终局时这个减伤可用且未按吗」的地方,断言它们如今都与 `cdAvailableAt` 结论一致,并写明了唯一一处因语义确实不同而刻意排除的调用点。

当你实在没法把谓词放到一处时,写一个断言两份副本相等的测试。别靠注释。

### 9.5 renderer 绝不能值引入 `main/`

`electron-vite` 把 renderer 按浏览器目标构建。从 `main/` 模块做值引入,会把该模块传递依赖的 Node 内置模块拖进浏览器包;而这个失败 —— `"join" is not exported by "__vite-browser-external"` —— **只在** `electron-vite build` 时现形。本地 `vitest` 和 `tsc` 都是绿的。

这事发生过。`analysisCache.ts` 顶部为 `analysisCachePath` 引了 `path` 的 `join`;renderer 的 `slotLabel.ts` 从它 import 了 `splitSlotKey`,presubmit 抓到了坏掉的产物。纯槽逻辑随后被拆到 `analysisSlots.ts`,该文件零 `fs`/`path` 依赖,两侧都能安全 import。`analysisCache.ts` 只留了一个 `export *` 给 main 侧既有 import 路径做向后兼容。

**规则:**任何要给 renderer 用的纯函数,必须待在 `src/shared/` 且不引 Node 模块。仅类型的 import(`import type`)从 `main/` 引是可以的,而且用得很广。

### 9.6 密钥绝不跨 IPC 边界

`GladlogSettings` 有三个密钥字段(`anthropicApiKey`、`deepseekApiKey`、`obsWebsocketPassword`)。落盘时用 Electron 的 `safeStorage` 加密(对没有 keyring 的平台有一个有记录的 no-op 降级)。过 IPC 时,`redactSettings` 把每个替换成哨兵常量(`API_KEY_REDACTED` 及同族,定义在 `shared/protocol.ts`)—— renderer 只知道「有没有配」这一个事实。回来的路上,`sanitizeSettingsPatch` 认出哨兵并保留已存的真值。

两个相关取舍:`aiDebugLog.ts` 只在内存里保留 prompt、绝不落盘,因为 prompt 含对局细节;`deepseekClient.ts` 在上游错误体可能到达 UI 报错横幅之前,先把配置的 key 本体和任何 `sk-…` 形态令牌抠掉。

`vod://` 协议处理器同样不是通用文件读取口:只有当某个路径确实出现在录像索引里,它才会提供该文件。

### 9.7 白名单会腐烂

每一份策展的法术 id 集合 —— 控制、驱散、打断、爆发冷却、图标 —— 都会随每个补丁悄悄衰减。本仓历史上记录了两种失效形态:一是某个法术换了新 id(于是施法/光环双 id 分叉,白名单半失效);二是上游目录掉了一条,导致整条下游白名单串联失效。而在语料里,「没发生过」和「发不出来」长得一模一样。

因此:新增任何跟踪之前先拿语料证据 —— 挖 `SPELL_CAST_SUCCESS` / `SPELL_DISPEL`,看**按专精的发生率**而不是绝对计数。缺失的数值(冷却、持续时间)来自语料测量(最小连续施放间隔;光环 applied → removed 的中位数),绝不靠猜。`packages/eval/scripts/rotScan.ts` 做语料挖矿检测腐烂;`docs/commands/update-wow-data.md` 把腐烂回归检查列进了刷新流程。

### 9.8 声称修好了,必须给前后数字

同样出自 `CLAUDE.md`,也是上文多处引用具体实测数字的原因。读代码 + 写一份有说服力的 commit message 不算验证。学费:一次修复凭着头头是道的根因分析进了 main,后来实测 26/50 → 26/50,一个数都没动。

在做得到的地方,判据要固化成挂进门规的确定性检查,而不是一次性脚本 —— 脚本随会话消失,下次回归就没人挡了。

---

## 10. 验证面

| 面                    | 位置                                              | 守住什么                                                              |
| --------------------- | ------------------------------------------------- | --------------------------------------------------------------------- |
| 单元测试              | 各包的 `test/` 与同目录 `*.test.ts`               | 谓词、derive 纯函数、组件渲染(jsdom)                                  |
| Parser 不变量         | `packages/parser/src/invariants.ts`               | 每份解析结果的七条结构性性质                                          |
| 差分预言机            | 私有仓(`oracle/`,`npm run gate`)                  | 164 对真实对局上,新旧 parser 输出的一致性                             |
| 确定性 prompt 门规    | `packages/eval/src/quality/promptQualityCheck.ts` | 百分位单调、同秒 HP 一致、窗口时长自洽、冷却台账一致,外加友方死亡覆盖 |
| 几何门规              | `packages/eval/src/quality/positioningScan.ts`    | 六类几何主张,用原始坐标独立复算                                       |
| 覆盖率预言机          | `packages/eval/src/quality/coverageManifest.ts`   | 只从原始 parser 事件构建,绝不经 prompt 构建器(防循环论证)             |
| LLM 判官 + 校准       | `packages/eval/src/judge/`、`src/provenance/`     | 判分、植入缺陷的校准、分数溯源                                        |
| 视觉回归 / a11y / E2E | `packages/desktop/qa/`(Playwright)                | 渲染、axe 规则、冷启动、导入、导出、证据链跳转                        |
| 性能预算              | `packages/desktop/qa/budgets.ts`                  | 解析 / 首渲 / 冷启动的数量级回退                                      |

两条操作提示。视觉基线由 CI 生成 —— 本机绝不能直接对着签入的基线跑 `test:visual`。以及 `packages/corpus-tools/scripts/` 是真的会去下载第三方志愿者项目 API 的数据,不要随手跑。

评估工作流本身(`/eval-baseline`、`/eval-ab`、`/calibrate-judge`、`/pipeline-audit`)记在 `docs/commands/`;它们的产物落在 `$GLADLOG_EVAL_HOME` 指向的私有仓,永远不进本仓。

---

## 11. 新人从哪读起

五条具体路径。每条都是一串按顺序打开的文件。

**1. 「一场对局怎么变成战报?」** —— 主干。

```
packages/parser/src/api.ts                        流式门面
packages/parser/src/l3/compose.ts                 「文档」到底是什么
packages/desktop/src/worker/pipeline.ts           tail 怎么喂给 parser
packages/desktop/src/main/matchStore.ts           怎么落到磁盘
packages/desktop/src/preload/api.ts               UI 看到的契约面
packages/desktop/src/renderer/src/report/derive/timeline.ts    一个有代表性的 derive 模块
packages/desktop/src/renderer/src/report/components/MatchReport.tsx
```

**2. 「我想加一个分析谓词。」**

先读 `CLAUDE.md` 的门规谓词即规范,然后:

```
packages/analysis/src/utils/positionSampling.ts   单源谓词长什么样
packages/analysis/src/utils/cooldowns.ts          采样、可用性、fmtTime —— 共享管道
packages/analysis/src/analysis/candidateFindings.ts   一个事实怎么变成可教的候选
packages/analysis/src/context/buildMatchContext.ts    它怎么进到 prompt 里
packages/eval/src/quality/promptQualityCheck.ts       它怎么被拿日志复算
```

动手前要回答的问题:_哪个门规会复算这件事,它会 import 我的常量还是自己抄一份?_ 如果答案是「自己抄一份」,停下来重构。

**3. 「我想改战报 UI。」**

先读 `.claude/skills/desktop-dev/SKILL.md` —— 三条数据通路、`seekReq` nonce 模式、合成注入的 fixture 测试法全在那里。然后:

```
packages/desktop/src/renderer/src/report/derive/legacySource.ts   toLegacySafe 接缝
packages/desktop/src/renderer/src/report/derive/types.ts          ReportSource
packages/desktop/src/renderer/src/report/components/MatchReport.tsx
packages/desktop/test/fixtures/real-match-sample.json             匿名化的测试 fixture
packages/desktop/dev/README.md                                    纯浏览器试验台
```

日常迭代在 `packages/desktop` 下跑 `npm run dev:ui`(纯浏览器 Vite 试验台,端口 5199 —— 不需要 Electron、不需要游戏客户端)。push 前:
`npm test --workspace=packages/desktop && npm run typecheck && npx eslint packages/desktop/src --quiet`。

**4. 「我想动 parser。」**

```
packages/parser/src/l1/parseLine.ts       分派器
packages/parser/src/l2/segmenter.ts       状态机,以及 lineIndex 从哪来
packages/parser/src/l3/compose.ts         id 哈希、shuffle 轮次末尾夹取、出厂即瘦
packages/parser/src/invariants.ts         改完之后什么必须仍然成立
packages/parser/src/slim.ts               params 为什么长这样
packages/parser/test/                     19 个文件,按 L1/L2/L3 分组
```

parser 的改动必须过私有仓里的差分预言机(`npm run gate`,在 164 对真实对局上比对新旧输出)。注意 golden 测试以 `GLADLOG_FIXTURES` 为开关,没有真实日志时会自己 skip —— 本地全绿不代表它们跑过。

**5. 「我想搞清楚 AI 这条链的首尾。」**

```
packages/desktop/src/renderer/src/report/derive/analysisInput.ts   候选 + owner 判定
packages/analysis/src/analysis/candidateFindings.ts                模型被允许谈什么
packages/analysis/src/context/buildMatchContext.ts                 → matchTimeline.ts,即 prompt
packages/desktop/src/main/analysis.ts                              缓存分槽、run/deepen/window
packages/analysis/src/analysis/auditFindings.ts                    什么会被丢掉
packages/analysis/src/analysis/causalLint.ts                       因果措辞策略
packages/desktop/src/main/learning.ts                              → analysis/src/learning/patternScan.ts
```

---

## 附录:本文的数字是怎么来的

- **文件数与行数** —— 2026-08-01、commit `375725b` 上跑 `find packages/*/src \( -name '*.ts' -o -name '*.tsx' \)` 接 `wc -l`。含同目录测试;不含独立的 `test/` 目录。
- **对局库规模** —— 2026-08-01 在作者本机对 `~/Library/Application Support/gladlog/matches` 跑 `find` + `stat -f '%z'`。一台机器、一个玩家的历史。
- **生成数据表的规模** —— 读自签入的 `packages/analysis/src/data/datagen-manifest.json`(build `12.1.0.68629`)。
- **性能数字(22 秒 → 42 ms、预算表、瘦身 −35%)** —— 引自当初把它们锁定下来的仓内记录:`packages/desktop/electron.vite.config.ts`、`packages/desktop/qa/budgets.ts`、`docs/BACKLOG.md`、`CHANGELOG.md`。它们是在当时的硬件上测的,此处按数量级引用。
- **本文未核实的部分** —— 私有 eval 仓的内容(`$GLADLOG_EVAL_HOME`,含 `audit/layerAAudit.mjs`)、parser 差分预言机的内容、Windows 上的行为,以及任何需要真正把应用跑起来才能确认的事。本文没有任何一条结论是通过启动 gladlog 得到的。
