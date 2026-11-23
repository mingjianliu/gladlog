import type { MessageParams } from "../index";

// English dictionary for the `errors.*` namespace. Must mirror zh/errors.ts
// key-for-key (enforced by `satisfies Messages` in en/index.ts).
export const enErrors = {
  "errors.ai.nodeNotFound":
    "node not found (the .mjs wrapper-script mode needs Node.js): install Node.js, or clear the command path to call the auto-detected agy directly",
  "errors.ai.cliNotFound":
    "{tool} command not found: install it first, or enter its full path under Settings → AI analysis → Command path",
  "errors.ai.versionDetected": "detected {tool} version {version}",
  "errors.ai.versionProbeFailed": "version probe failed",
  "errors.ai.versionHint":
    "{message} ({hint}; the version may be incompatible)",
  "errors.ai.agyPromptTooLong":
    "The agy backend passes the prompt on the command line, and this one ({length} characters) exceeds the Windows command-line limit (about 32K): switch to the Claude CLI or Anthropic API backend",
  "errors.ai.agyStatus": "agy returned status={status}",
  "errors.deepseek.timeout":
    "DeepSeek timed out: the request did not finish within {seconds}s",
  "errors.deepseek.stallConnect":
    "DeepSeek stream stalled: no response within {seconds}s of connecting",
  "errors.deepseek.stallStream":
    "DeepSeek stream stalled: no new data for {seconds}s",
  "errors.deepseek.earlyEnd":
    "DeepSeek stream ended early (no [DONE]): the server disconnected and the output may be truncated, so it was treated as a failure",
  "errors.chat.seedNoSession": "Seeding did not capture a session id",
  "errors.obs.authUnknown":
    "OBS authentication state unknown (a config field is missing or its format changed), so a password may be needed; tried connecting with the password that was found",
  "errors.update.installerDidNotTakeOver":
    "The update installer did not take over. Quit gladlog manually, then open it again.",
  "errors.recorder.obsNotInstalled":
    'OBS is not installed — click "Download and enable" on the Settings page',
  "errors.recorder.managedNotReady": "managed backend not ready",
  "errors.obs.timeout": "{label} timed out ({ms}ms)",
  "errors.obs.bmpInvalid":
    "Not a valid BMP (missing the 'BM' magic number, or the file is too short)",
  "errors.obs.bmpUnsupported":
    "Unsupported BMP format (bitCount={bitCount}, compression={compression}); captureProbe only requests uncompressed 24bpp",
  "errors.obs.requestNotConnected": "{req} failed: not connected",
  "errors.obs.requestFailed": "{req} failed: {error}",
  "errors.obs.ensureProcessFailed": "ensureProcess failed: {error}",
  "errors.obs.connectFailed": "Connection failed: {error}",
  "errors.obs.notReady": "OBS was not ready within {seconds}s: {error}",
  "errors.obs.recordNotStarted":
    "OBS did not actually start recording (StartRecord returned, but GetRecordStatus reports the output inactive) — most likely the output failed to start (encoder / recording folder / disk); the OBS log has the exact reason",
  "errors.obs.firstChunkUnknown":
    "First chunk path unknown: the STARTED event carried no outputPath and {dir} holds no mp4 written by this recording",
  "errors.obs.splitNotConnected": "splitChunk: not connected",
  "errors.obs.splitTimeout":
    "SplitRecordFile: timed out waiting for RecordFileChanged ({ms}ms)",
  "errors.obs.disconnectFailed": "disconnect failed: {error}",
  "errors.obs.probeNotConnected": "captureProbe: not connected",
  "errors.obs.probeDecodeFailed":
    "captureProbe: failed to read/decode the screenshot: {error}",
  "errors.obs.portableOff":
    "OBS portable mode did not take effect ({line}); check portable_mode.txt",
  "errors.obs.noLog":
    "OBS produced no log (no new file appeared in {dir} within {ms}ms of spawning)",
  "errors.obs.readyTimeout": (p: MessageParams) =>
    `OBS readiness timed out (${p.ms}ms). Last ${Number(p.n) === 1 ? "line" : `${p.n} lines`} of the new log:\n${p.tail}`,
  "errors.obs.exited":
    "The OBS process exited (code={code}, signal={signal}) before readiness was confirmed",
  "errors.obs.spawnFailed":
    "Failed to spawn the OBS process (it never started, as opposed to failing to connect): {error}",
};
