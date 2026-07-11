# 子项目 2:桌面壳(Electron + Vite)设计

日期:2026-07-10
状态:待用户审阅
上游文档:`docs/specs/2026-07-10-clean-rewrite-roadmap-design.md`(路线图)、`HANDOFF-2026-07-10.md`

## 目标与范围

v1 桌面壳 = Electron + Vite + React 骨架,打通"日志目录监控 → 解析 → 落盘 → 界面呈现"的端到端数据流,并可打包安装。

**范围内**:

- 监控 WoW retail 日志目录(`_retail_/Logs` 下 `WoWCombatLog*.txt`,含轮转/多文件)
- 解析(`@gladlog/parser`,utilityProcess worker)
- 对局落盘持久化(解析结果 JSON + 原始日志段)
- 类型化 `window.gladlog` IPC bridge
- 调试级实时界面:监控状态 + 对局列表(时间/地图/胜负)+ JSON 详情
- 设置持久化(WoW 目录;Anthropic key/model 字段占位给子项目 4)
- electron-builder 打包:Windows(NSIS)+ macOS(dmg,不签名)

**范围外**(已决策):正式战报 UI(子项目 3)、AI 分析(子项目 4)、录像、自动更新(发布前独立小任务)、云端一切、WoW classic 支持(parser 目前 retail-only)。

## 已确认的用户决策

| 决策     | 选择                                     |
| -------- | ---------------------------------------- |
| 验收界面 | 调试级实时列表(非空壳)                   |
| 打包平台 | Windows + macOS                          |
| 自动更新 | v1 不做                                  |
| 持久化   | 壳层落盘:解析 JSON + 原始日志段双落盘    |
| 架构     | 方案 A:单包 + utilityProcess worker 解析 |

**方案 A vs 备选**:B(双包结构,解析在主进程)对只有一个调试页的 v1 是过度结构,且首扫几百 MB 日志会卡死主进程;C(renderer 解析)把数据地基绑在窗口生命周期,后台监控形态不成立。Vite 下日后拆包成本低,先单包。

## 包结构

```
packages/desktop          # @gladlog/desktop,electron-vite 三段构建
  src/main/               # 主进程:生命周期、窗口、worker 管理、存档、settings、IPC
    workerHost.ts         # utilityProcess 启动/配置/崩溃恢复/quarantine
    matchStore.ts         # 对局落盘/索引/去重
    settingsStore.ts      # settings.json(移植自有 settingsModule 逻辑)
    detectWowDir.ts       # WoW 目录探测(移植自有 pipeline-app/detect.ts)
    ipc.ts                # ipcMain handlers,bridge 面的唯一注册点
  src/worker/             # utilityProcess:监控+读取+解析全链路(见 debate 修订)
    watcher.ts            # 目录监控(移植自有 windows-agent/watcher.ts 语义)
    tailReader.ts         # 增量读字节→行,轮转/截断检测
    checkpoints.ts        # 安全边界 checkpoint(state.ts registry 模式)
    pipeline.ts           # 喂 GladLogParser,发 match/diagnostic/status 事件给 main
  src/preload/            # contextBridge:window.gladlog,导出 GladlogApi 类型
  src/renderer/           # React 调试页(Vite)
```

依赖:`@gladlog/parser`(workspace)、electron、electron-vite、electron-builder、react、react-dom、electron-log。零上游代码;`@gladlog/parser-compat` 不进壳(它是给子项目 4 旧代码消费的)。

加载方式:dev = Vite dev server + HMR;prod = `loadFile` 静态 bundle。**没有本地 HTTP server**(旧 fork 的 Next standalone + 等端口 3088 那套整体作废)。

## 核心组件

> 经 agy debate 修订(见辩论记录):**监控 + 读取 + 解析全部在 utilityProcess worker 内**,主进程不经手日志字节——避免几百 MB 字符串走 IPC 结构化克隆卡死主进程事件循环,同时整个 ack/背压协议被删掉。

### 1. LogWatcher(worker 进程)

移植自有 `windows-agent/watcher.ts` 的语义:`fs.watch(logsDir)`,过滤 `WoWCombatLog*.txt`,`rename` 事件丢弃(新文件竞态规避);脏文件集 + flush 间隔(默认 2s)+ 静默期补一次 flush;空闲时停表。flush 回调交给 TailReader。

### 2. TailReader + checkpoint(worker 进程)

- 每文件 checkpoint:`{ offset, firstLineChecksum }`(自有 `state.ts` 的 registry 模式,原子写 tmp+rename,存 userData)。
- 轮转/截断检测:`size < offset` 或首行校验和变化 → 视为新文件,从 0 读,parser 实例重建。
- 增量读:从 offset 读到 EOF,按 `\n` 切行(剥 `\r`),跨块残行缓存到下次。
- **checkpoint 只在安全边界推进**:段落闭合(match/shuffle 产出或段被判弃)且 parser 无进行中段时,推进到已消费的完整行尾。壳在对局进行中被重启 → 重启后从对局开始前的边界重放,进行中的那场完整重建,matchId(内容哈希)幂等去重吸收重放产生的重复事件。**不丢跨重启对局**。
- 依赖一个 parser 小改动:`GladLogParser` 暴露只读查询"当前是否有进行中的段/shuffle 序列"(如 `hasOpenSegment(): boolean`),零行为变化;确切名字实现计划时定。

### 3. Worker pipeline + WorkerHost

- worker 内 per-file 一个 `GladLogParser` 实例(轮转=新实例),行直接喂 `push()`;match/shuffle 事件(payload 含 `rawLines`,几百 KB/场,低频)发给主进程。
- worker→main:`{ type: 'match' | 'shuffle', fileKey, payload }`、`{ type: 'diagnostic', fileKey, payload }`、`{ type: 'status', ... }`(监控中/文件列表/进度/quarantine 状态)
- main→worker:`{ type: 'configure', logsDir }`(启动与目录变更)
- 主进程 `workerHost.ts`:spawn/configure/崩溃重启。崩溃恢复 = 重启后从各文件 checkpoint(安全边界)续读;**每文件 quarantine**:同一文件连续 3 次导致崩溃 → 隔离该文件(其余文件继续),diagnostic 记录 file+offset 供离线复现,该文件轮转后自动解除。
- 崩溃归因:worker 的 status 事件持续携带"当前正在处理的 fileKey+offset",main 缓存最近值;崩溃时以该值归因,连续 3 次同 file+相近 offset → 判定毒丸,quarantine 该文件。
- 事件处理写成纯函数 + 可注入 transport/fs,便于不起 Electron 就单测。

### 4. MatchStore

- 目录:`userData/matches/<matchId>/`,内含:
  - `match.json`:解析结果 + 信封 `{ schemaVersion, parserVersion, storedAt }`
  - `raw.txt`:该场原始日志行段(几百 KB/场;parser 升级后可离线重放重建,日志被 WoW 轮转删除也不怕)
- 原始段来源:`GladMatch`/`GladShuffle` 已自带 `rawLines: string[]`(l3/model.ts 已核实),parser 零改动;落盘时从 payload 取出写 `raw.txt`,`match.json` 里剥掉 `rawLines` 避免双份存储。
- 启动时扫目录建内存索引(id、时间、地图、模式、胜负、时长);索引推给 renderer。
- 写入原子(tmp+rename);matchId 已存在 → 跳过(幂等)。

### 5. SettingsStore

移植自有 `settingsModule.ts` 逻辑:`userData/settings.json`;字段:`wowDirectory`、`anthropicApiKey`、`anthropicModel`(后两者 v1 只存取,无消费方)。

### 6. WoW 目录探测

移植自有 `detect.ts`:Windows 探测 `C:\Program Files (x86)\World of Warcraft\_retail_` 等标准路径且 `Logs` 存在;macOS/探测失败 → 引导用户 `selectDirectory()` 手选。选定值存 settings。

## IPC bridge(window.gladlog)

手写类型化 contextBridge(不复刻旧 fork 的自动生成机制——审计证实自有代码对旧 bridge 的消费面趋近于零,新 UI 是子项目 3 从零写):

```ts
window.gladlog = {
  logs: { getStatus(), onStatusChanged(cb), onMatchStored(cb), onDiagnostic(cb) },
  matches: { list(), get(id) },        // list=索引元数据; get=读 match.json
  settings: { get(), save(partial) },
  app: { getVersion(), selectDirectory(), openExternal(url) },
}
```

`GladlogApi` 类型定义在 preload,renderer 通过 `declare global` 消费。事件用 `ipcRenderer.on` 包装,提供 unsubscribe。

## 数据流

```
启动(main)→ settings.wowDirectory(无 → 探测 → 仍无 → renderer 引导手选)
  → spawn worker + configure(logsDir)
  → worker:initial scan(每个 WoWCombatLog*.txt 从 checkpoint 续读)→ fs.watch 增量
    → 切行 → GladLogParser → match/shuffle 事件发 main
  → main:MatchStore 落盘 → IPC 推 renderer → 列表更新
```

## 错误处理

- worker 崩溃:自动重启,从各文件安全边界 checkpoint 续读 + matchId 幂等;同一文件连续 3 次致崩 → 该文件 quarantine(其余文件继续,app 不停摆),diagnostic 记 file+offset,轮转后解除。
- 日志目录不存在/无权限/被删:watcher 报错不退出,status 推 renderer,可去设置改目录;目录变更 = main 发 configure,worker 停旧 watcher + 起新 watcher(checkpoint 按文件路径键控,自然隔离)。
- parser diagnostic:透传 renderer 调试页 + electron-log 落日志文件。
- 主进程 uncaughtException/unhandledRejection:log 不退出(自有 pipeline-app 惯例)。
- 存档目录写失败(磁盘满等):diagnostic 上报,不崩。

## 测试策略

沿用子项目 1 工作方式:**测试契约 Claude 写,实现 agy exec,绿灯 Claude 独立验证**;TDD、逐任务 commit。

- **单元测试(不起 Electron)**:watcher 语义(注入 watchFn,自有 windows-agent 测试风格)、tailReader(增量/跨块残行/轮转/截断/CRLF)、checkpoint 安全边界推进(对局进行中不推进)、matchStore(原子写/去重/索引重建/rawLines 剥离)、worker 事件纯函数层、settingsStore、detectWowDir(注入 FsProbe)。
- **worker 集成**:node 环境直接实例化 worker pipeline + 真 `GladLogParser` 喂 fixture 日志段(含模拟追加、轮转、重启续读),断言 match 事件序与 checkpoint 行为;utilityProcess 本体只留薄封装。
- **端到端验收(Claude 独立跑)**:mac dev 模式指向本地语料样本目录,模拟追加写入(脚本按块 append 复制真实日志),断言:实时出对局、落盘文件完整、重启后索引恢复、轮转场景正确;Windows 打包安装包在用户 Windows 机上人工验收(用户参与)。
- fixture:用自采语料(`GLADLOG_FIXTURES` 惯例沿用)。

## 打包

electron-builder:Windows NSIS + macOS dmg(不签名、不公证,v1 自用);产物含 renderer 静态 bundle + worker bundle。CI 不在本子项目范围(发布前统一处理)。

## 合规边界(执行时约束)

- 实现者(agy/subagent)**不得读取**旧 fork 上游源码(`packages/app/src/`(除下列自有文件)、`packages/parser/src/` 等);尤其 `logsModule` / `logWatcher` / `nativeBridge` 自动生成机制一概不读不参考。
- **允许移植**(审计 CLEAN,自有):`windows-agent/src/watcher.ts`、`state.ts`、`initialScan.ts`、`pipeline-app/src/detect.ts`、`pipeline-app` 的 main/preload 惯用法、`app/src/nativeBridge/modules/settingsModule.ts`,及其配套测试。
- **允许提取逻辑重新安家**(自有 hunk):`app/src/main.ts` 等文件中用户自己的 diff(`git diff 7842b644 main -- <path>`),不携带上游文件本体。
- 移植文件进入本仓库时按本仓库命名/结构重排,不保留旧包路径。

## 设计决策辩论记录(agy debate 仪式)

2026-07-10,Gemini 3.1 Pro (High),conversation `81ed737d`。初始 **OPPOSE** → 一轮回复后 **CONCEDE**("The revised architecture is structurally sound, performant, and correctly scopes fault tolerance for a v1 release")。

**让步 1(已改设计)**:原方案 TailReader 在主进程、行批走 IPC 给 worker——对方指出几百 MB 字符串的结构化克隆序列化会在初扫时卡死主进程事件循环,恰好复现方案想避免的问题。采纳其 steelman:fs.watch + tail 读取整体移入 worker,主进程只收轻量 match/diagnostic/status 事件;附带删掉了 ack/背压协议。

**让步 2(已改设计)**:原方案接受"重启丢进行中对局"为已知限制——对方认为伤信任。修订:checkpoint 只在安全边界(无进行中段)推进,重启从对局前边界重放,配合 matchId 内容哈希幂等,不再丢场。

**辩护成立(对方收回)**:"毒丸行崩溃循环"的指控对其 steelman 同样成立(字节级 checkpoint 续读仍会重摄毒丸行);跳行机制是为 3.86 亿行零失败中从未观测到的故障模式做投机工程。落地为按比例的缓解:每文件 quarantine(单文件故障不拖垮全 app)+ 崩溃现场 file+offset 诊断。

## 未决事项

- 调试页要不要显示 shuffle 每回合明细(倾向:只显示场级,回合明细留子项目 3)。
