# 跨机日志中继 + Lint + Windows 打包 设计

日期:2026-07-12
状态:待用户审阅

## 背景与目标

把旧 fork(`/Users/mingjianliu/code/wowarenalogs`,现为 CC BY-NC-ND)中三块**用户自有**基础设施搬进 gladlog,并产出主分析应用的 Windows 构建:

1. **windows-agent**(日志流式上传 agent)+ **wal-pilot**(streamer/collector 编排)→ 合并为一个 `packages/log-pipeline` 包。
2. **lint**(gladlog 当前无 ESLint)→ 根级 flat config。
3. **Windows 二进制**:主 gladlog 桌面应用的 electron-builder Windows 构建。

**部署拓扑(用户确认)**:跨机 Windows→Mac。在 Windows 游戏 PC 上跑 streamer,在 Mac 上跑 collector 复盘。旧设计用 GCS 桶做中间层;gladlog 无云端,改用 **Google Drive(Drive for Desktop)共享文件夹**作为传输(两端均设为「离线可用/镜像」)。

**Collector 职责(用户确认)**:仅重建(reconstruct-only)——把 segment 重建成完整 `.txt` 日志写入一个普通输出文件夹,不做分析。用户自行用 gladlog 打开该文件夹。

## 合规结论

`windows-agent`(18 commits)与 `pipeline-app`(19 commits)**100% 由用户(Mingjian Liu)本人编写**,是 fork 后的自有资产,非上游表达。子项目 0 审计对这三个包的唯一命中是 7 处**平凡配置样板**(`.eslintrc.js`/`jest.config.js`/`.eslintignore`,1–5 行,且匹配的是同 fork 内其它包的同类配置),外加 `cli.ts` 一处 1 行巧合——均非受版权保护的表达。据路线图规则「审计通过的文件 → 直接复制」,可将这些自有文件近乎原样搬入 gladlog。被搬的平凡配置本就要为 gladlog 工具链(vitest、flat ESLint)重写。**上游(原 wowarenalogs 作者)代码一行不碰**;控制器提取,子代理/agy 不读旧 fork。

## 范围外

- Electron pilot 托盘 GUI + 设置向导(`main.ts`/`preload.js`/`wizard.html`)——用户未选打包 pilot。其编排逻辑(role 解析、config)以 CLI 形式复用。
- Collector 的批量分析链(`localBatchAnalysis`、`claudeCli`、`collectLogs` 的分析步骤)——reconstruct-only。
- GCS 适配器 + `@google-cloud/storage` 依赖——无云端。
- 代码签名、真实 Windows 机安装验收——用户门槛项。

---

## 组件一:`packages/log-pipeline`

### 包结构与复用/丢弃

单包,两个 bin 命令。**逐字复用**(用户自有 CLEAN 文件,仅改 import 路径 + ESM + vitest):

- `protocol/{identity,segments,reconstruct}`(见下「协议加固」——segments/reconstruct 有针对性修改)
- `storage/{StorageAdapter,adapterContract,createAdapter,LocalDirStorageAdapter,MemoryStorageAdapter}`
- `config`(`AgentConfig` + `loadAgentConfig` 校验)
- `watcher`、`flusher`、`state`、`initialScan`、`heartbeat`、agent `index`(`flushBatch`)
- streamer/collector service 逻辑、`pilotConfig`、`detect`、`cleanup`
- `collectLogs.runCollection`(重建循环)+ `collect/{collectorConfig,statusFile}`

**丢弃**:`GcsStorageAdapter` + `@google-cloud/storage`;collector 分析调用;pilot Electron 壳。

命名去 Windows 化:`stream`/`collect` 两命令在两端 OS 均可跑;仅「运行 streamer」这一步是 Windows 侧。

### 数据流

1. **Windows streamer** — `startLogWatcher` 监视 WoW `Logs` 目录。逐文件用 `firstLineChecksum` → `gen8`(内容身份,同名重建日志视为新流),本地 `state` 记已上传字节 offset。每次 flush 读增量字节,以**不可变 segment** `put` 进 Drive 文件夹,另写 `status/<host>.json` 心跳。
2. **Google Drive** 整文件镜像 Win→Mac。
3. **Mac collector** — `runCollection` 列出 segment,按 (host, logfile, gen8) 分组,字节精确重建,追加进输出文件夹的 `.txt`,`cleanupAppliedSegments` 删除已完全应用的 segment,写运行状态文件。

### 协议加固(源自 agy 辩论——见末尾)

原方案 segment 仅以起始 offset 为键(`<startOffset>.seg`)且 delta 读到当前 EOF(长度非确定)。发现一条**与传输层无关**的静默损坏路径:若进程在 `adapter.put` 与 `saveState` 之间被杀,重启会以**相同 offset 键**重新 flush 一个**更长**的 delta;若 collector 已消费并清理了较短的那个,则较长 segment 因 `offset < currentSize` 被当作重复丢弃 → 静默丢字节 + 永久 stall。此缺陷在原 GCS 设计里同样潜伏,Drive 不制造它。

**采纳修复**(agy steelman,精化):

- Segment 键改为 `raw/<host>/<logfile>/<gen8>/<startOffset>_<length>.seg`(编码未压缩 delta 长度);内容仍为 `gzip(delta)`。同 offset 的两次不同长度 re-flush(如 `100_50.seg` 与 `100_200.seg`)成为**并存的不同文件**。
- Collector 重建改为**重叠感知**,按 startOffset 升序处理候选 segment:
  - `startOffset + length ≤ currentSize`:整体在已重建区内 → 重复,跳过。
  - `startOffset ≤ currentSize < startOffset + length`:**先 gunzip**;若失败(Drive 部分物化/在途损坏——gzip 自带 CRC32 + 长度尾)→ 视为未就绪,**不推进**,下轮 poll 再试;成功则从 `(currentSize − startOffset)` 处 seek 追加剩余字节,`currentSize` **按实际解压追加的字节数推进**(绝不按文件名声称的 length 推进)。
  - `startOffset > currentSize`:gap → 等待。
- **gzip 的 CRC32 兼任完整性校验**:部分同步或在途损坏的 `.seg` 解压即失败 → 安全推迟,无需在文件名另加 crc。WoW 日志严格追加,同 offset 重读源字节恒等,故无「重叠区内容分歧」情形。

此修复完全消除静默丢字节与永久 stall 两种失效。它是对用户自有代码在移植期的**针对性加固**,落点收敛于 `segments.ts`(键构建/解析加 length)、`reconstruct.ts`(`nextAction` → 重叠感知)、`flusher.ts`(`buildSegmentKey` 传 length)、collector 应用循环(gunzip 校验 + 按实推进)。

### CLI 与配置

两显式命令,JSON 配置驱动(复用 `loadAgentConfig`/`pilotConfig`/`collectorConfig` 校验):

- **Windows** `gladlog-stream --config stream.json`
  ```json
  {
    "wowDirectory": "C:\\...\\World of Warcraft\\_retail_\\Logs",
    "hostname": "gaming-pc",
    "flushIntervalMs": 60000,
    "storage": {
      "provider": "localDir",
      "directory": "G:\\My Drive\\gladlog-relay"
    }
  }
  ```
- **Mac** `gladlog-collect --config collect.json`
  ```json
  {
    "segmentsDir": "/Users/you/Google Drive/gladlog-relay",
    "outputDir": "/Users/you/gladlog-logs",
    "pollIntervalMs": 15000,
    "cleanup": true
  }
  ```

两端在 Node 下运行(`npm run stream`/`npm run collect` 或 bin 名)。`pilotConfig` 的 `resolveRole`/`detect` 保留在树内,便于日后加一个按平台自动派发的 `gladlog-pilot` 薄包装(复用而非删除,非主入口)。配置错误快速失败并给清晰信息;Drive 目录不存在按「暂无 segment」处理——等待轮询。

### Drive 设置要求(非代码)

Drive 文件夹在**两端**须设为「镜像/离线可用」,而非仅在线占位,否则读取返回占位而非字节。文档说明。同步延迟仅延长 gap 等待;心跳文件让 collector 能标记 streamer 陈旧。Drive 冲突副本(`… (1).seg`)因键解析不匹配被忽略。

### 隐私提示(非阻断)

Drive 传输意味着用户自己的战斗日志途经 Google 云。此为用户对自有数据、自有两台机器的个人选择,非产品默认、非旧 fork 的社区上传。文档如实标注。

---

## 组件二:Lint(根级 flat config)

新增单一根 `eslint.config.js`(ESLint 9 + `typescript-eslint`),覆盖所有包。复用旧 `linter/index.js` 的有效规则,丢弃 Next.js 专属部分:

- 复用:`@typescript-eslint` recommended、`simple-import-sort`(warn)、`no-console`(允许 `warn`/`error`)、`no-unused-vars`(`^_` 忽略)、`react/react-in-jsx-scope: off`。
- 为 gladlog 栈新增:`eslint-plugin-react-hooks`(rules-of-hooks + exhaustive-deps,面向 desktop renderer);`eslint-config-prettier`(格式交给既有 Prettier)。
- 忽略:`node_modules`、`dist`、`out`、`coverage`、构建产物。
- 脚本:根 `lint`(`eslint .`)+ `lint:fix`。根级 devDeps。

**严重度策略**:真 bug 类(`no-unused-vars`、rules-of-hooks)为 `error` 必修;风格类(`simple-import-sort`)起始为 `warn`。lint 任务含把 `npm run lint` 跑绿:修真实问题,不大规模改写无关代码。若违规量大,先报数字与用户定范围,不静默 churn。

---

## 组件三:Windows 构建(主 gladlog 桌面应用)

现状:`package:win` 脚本已在,electron-builder 26 已装,但**无 `build` 配置、无应用图标、本机无 Wine**(从 macOS 交叉构建 NSIS 需 Wine)。

- **加 electron-builder `build` 配置**(`packages/desktop/package.json`):`appId` `com.gladlog.desktop`、`productName` `gladlog`、输出 `release/`、`files` 覆盖 `out/**` + `package.json`、`win.target` = `nsis` + `zip`、`nsis` 选项(per-user、允许改安装目录)、`win.icon`。
- **原创应用图标**(`build/` 下 256px `.ico`):简单原创标记,不含上游/魔兽图像(合规)。
- **本机可产**:`--win zip`/`dir` 不需 Wine → 从 Mac 产出可运行的未打包 Windows 应用以端到端验证配置。
- **真 `.exe` NSIS 安装器**需二选一:本机 `brew install --cask wine-stable`,或在用户 Windows 机跑 `npm run package:win`。仓库**无 git remote**,故 CI 不在无远端下可用。
- **用户门槛**:代码签名(需证书;未签 → SmartScreen 警告)、真 Windows 机装-启动冒烟。

**推荐**:先完整配置 + 图标 + 从 Mac 产 win-zip 构建证明打包链路;NSIS 安装器经 Wine(本机)或 Windows 机产出作为验收步。安装器路线在实现计划中定。

---

## 错误处理

- **Streamer**:单文件失败隔离(一个坏文件不饿死整批);ENOENT(文件消失)丢出队列非重试;心跳写失败去重告警不阻断。
- **Reconstruct**:gap → 等待;gunzip 失败(部分同步/损坏)→ 推迟;重复 segment → 跳过;冲突副本 → 键解析忽略。
- **Config**:校验失败快速退出并给清晰信息。
- **Collector 输出**:原子写(tmp→rename)避免下游读到半文件。

## 测试策略(vitest)

- **协议单测**:`segments`(键构建/解析含 length,拒绝非法/冲突名)、`reconstruct` 重叠感知(重复 no-op、gap、部分重叠追加、按实推进)、`identity`(CRLF 首行校验)。
- **端到端往返**(`MemoryStorageAdapter`,无 Drive):写日志 → streamer flush → collector 重建 → 字节精确等于原日志。
- **回归/加固用例**(直击 agy 缺陷):模拟「put 后、saveState 前崩溃」→ 同 offset 更长 re-flush → 断言重建无丢字节、无 stall;模拟部分物化(截断 gzip 的 `.seg`)→ 断言 collector 推迟且后续补齐。
- **Lint**:`npm run lint` 跑绿作为门。
- **Windows 构建**:从 Mac 产 win-zip 成功、含图标、`out/**` 齐全作为验收(安装器 + 真机启动为用户门槛)。

## 子项目分解与顺序

三块松耦合,建议顺序(各自可独立测):

1. **Lint**(小、独立)——先做,后续新包一落地即受 lint 约束。
2. **log-pipeline**(主体)——协议加固 + streamer/collector CLI + 往返测试。
3. **Windows 构建**(小-中)——electron-builder 配置 + 图标 + win-zip 验证。

三者可置于一份实现计划(lint 与构建是小书挡,pipeline 是主体)。

## 设计决策辩论记录(agy 仪式)

2026-07-12 对「Google Drive 作字节精确日志重建传输」跑 debate-open/reply(conversation `10aa57bb`,OPPOSE → PARTIAL)。

- **surfaced(已修正设计)**:原 `<offset>.seg` 键 + 读到 EOF 的非确定分块,在「put 与 saveState 之间崩溃 + 文件已增长」时可静默丢字节并永久 stall。**与传输无关**,原 GCS 设计同样潜伏。采纳「length 编码键 + 重叠感知重建」修复。
- **PARTIAL(二次精化)**:agy 指出「按文件名声称 length 推进」在 Drive 部分物化下仍会蒸发在途尾字节。修正为**先 gunzip 校验、按实际解压字节推进**;gzip 内建 CRC32 兼作在途损坏检测,无需文件名加 crc。WoW 追加语义 → 无重叠区内容分歧。
- **辩护成立**:Drive 的最终一致性、同步延迟、冲突副本本身不致损坏——不可变+offset 键 + 严格键解析 + gap 等待已覆盖;真正的风险在 (put, saveState) 非原子 + 分块非确定,已由加固关闭。

## 未决事项

- Windows NSIS 安装器路线:本机 Wine vs 用户 Windows 机(实现计划中定)。
- 是否日后加 `gladlog-pilot` 单命令自动派发(保留 `resolveRole`/`detect`,非本次范围)。
