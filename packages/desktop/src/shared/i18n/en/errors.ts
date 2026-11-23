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
};
