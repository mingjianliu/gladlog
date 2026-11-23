// Baseline (zh) dictionary for the `errors.*` namespace: error text the main
// process hands to the renderer (thrown AI-client errors, recorder status,
// update state, OBS auto-config hints).
export const zhErrors = {
  "errors.ai.nodeNotFound":
    "未检测到 node(.mjs 包装脚本模式需要 Node.js):请安装 Node.js,或清空命令路径改用自动检测的 agy 直调",
  "errors.ai.cliNotFound":
    "未检测到 {tool} 命令:请先安装,或在 设置 → AI 分析 → 命令路径 填写完整路径",
  "errors.ai.versionDetected": "检测到的 {tool} 版本 {version}",
  "errors.ai.versionProbeFailed": "版本探测失败",
  "errors.ai.versionHint": "{message}({hint},可能版本不兼容)",
  "errors.ai.agyPromptTooLong":
    "agy 后端经命令行传入 prompt,本次 {length} 字符超出 Windows 命令行上限(约 32K):请改用 Claude CLI 或 Anthropic API 后端",
  "errors.ai.agyStatus": "agy 返回 status={status}",
  "errors.ai.cmdMetachar":
    "内部错误:传给 {file}(经 cmd.exe 执行的 .cmd/.bat)的参数含 cmd.exe 元字符(& | ^ % < > 之一)——cmd.exe 重新解析 argv 时会把它当命令 语法而非字面文本,已拒绝执行。这类内容必须先落盘,argv 只传文件路径。",
  "errors.ai.cmdUnbalancedQuote":
    "内部错误:传给 {file}(经 cmd.exe 执行的 .cmd/.bat)的参数含不平衡的 双引号——cmd.exe 重新解析时会让后续参数边界整体错位,已拒绝执行。",
  "errors.deepseek.timeout": "DeepSeek 超时:请求整体超过 {seconds}s 未完成",
  "errors.deepseek.stallConnect":
    "DeepSeek 流停滞:连接阶段超过 {seconds}s 未收到响应",
  "errors.deepseek.stallStream": "DeepSeek 流停滞:超过 {seconds}s 未收到新数据",
  "errors.deepseek.earlyEnd":
    "DeepSeek 流异常提前结束(未收到 [DONE]):服务端提前断连,输出可能被截断,已按失败处理",
  "errors.chat.seedNoSession": "播种未捕获到会话 id",
  "errors.obs.authUnknown":
    "OBS 鉴权状态未知(配置字段缺失或格式有变),可能需要密码;已尝试携带读到的密码连接",
  "errors.update.installerDidNotTakeOver":
    "更新安装器未能接管,请手动退出 gladlog 后重新打开",
  "errors.recorder.obsNotInstalled":
    "OBS 未安装 —— 请在设置页点击「下载并启用」",
  "errors.recorder.managedNotReady": "managed backend 未就绪",
  "errors.obs.timeout": "{label} 超时({ms}ms)",
  "errors.obs.bmpInvalid": "不是有效的 BMP(缺 'BM' 幻数或文件过短)",
  "errors.obs.bmpUnsupported":
    "不支持的 BMP 格式(bitCount={bitCount}, compression={compression});captureProbe 只请求 24bpp 无压缩",
  "errors.obs.requestNotConnected": "{req} 失败: 未连接",
  "errors.obs.requestFailed": "{req} 失败: {error}",
  "errors.obs.ensureProcessFailed": "ensureProcess 失败: {error}",
  "errors.obs.connectFailed": "连接失败: {error}",
  "errors.obs.notReady": "OBS 在 {seconds}s 内没有就绪: {error}",
  "errors.obs.recordNotStarted":
    "OBS 没有真正开始录制(StartRecord 已返回,但 GetRecordStatus 报告输出未激活)——多半是输出启动失败(编码器/录制目录/磁盘),OBS 日志里有确切原因",
  "errors.obs.firstChunkUnknown":
    "首个分片路径未知:STARTED 事件未带 outputPath 且 {dir} 下没有本次录制写出的 mp4 文件",
  "errors.obs.splitNotConnected": "splitChunk: 未连接",
  "errors.obs.splitTimeout":
    "SplitRecordFile: 等待 RecordFileChanged 超时({ms}ms)",
  "errors.obs.disconnectFailed": "disconnect 失败: {error}",
  "errors.obs.probeNotConnected": "captureProbe: 未连接",
  "errors.obs.probeDecodeFailed": "captureProbe: 读取/解码截图失败: {error}",
  "errors.obs.portableOff": "OBS 便携模式未生效({line});检查 portable_mode.txt",
  "errors.obs.noLog":
    "OBS 未产出日志(spawn 后 {ms}ms 内 {dir} 下没有出现新文件)",
  "errors.obs.readyTimeout": "OBS 就绪超时({ms}ms)。新日志尾部 {n} 行:\n{tail}",
  "errors.obs.exited":
    "OBS 进程已退出(code={code}, signal={signal})且未确认就绪",
  "errors.obs.spawnFailed":
    "OBS 进程 spawn 失败(不是连不上,是根本没起来):{error}",
};
