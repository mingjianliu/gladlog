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
  "errors.deepseek.timeout": "DeepSeek 超时:请求整体超过 {seconds}s 未完成",
  "errors.deepseek.stallConnect":
    "DeepSeek 流停滞:连接阶段超过 {seconds}s 未收到响应",
  "errors.deepseek.stallStream": "DeepSeek 流停滞:超过 {seconds}s 未收到新数据",
  "errors.deepseek.earlyEnd":
    "DeepSeek 流异常提前结束(未收到 [DONE]):服务端提前断连,输出可能被截断,已按失败处理",
  "errors.chat.seedNoSession": "播种未捕获到会话 id",
};
