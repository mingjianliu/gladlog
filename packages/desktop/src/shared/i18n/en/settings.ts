import type { MessageParams } from "../index";

// English dictionary for the `settings.*` namespace. Must mirror
// zh/settings.ts key-for-key (enforced by `satisfies Messages` in en/index.ts).
export const enSettings = {
  "settings.group.general": "General",
  "settings.language.label": "Language",
  "settings.language.hint":
    "Used for the interface and AI replies; takes effect immediately",
  "settings.language.saved": "Language changed",
  "settings.language.endonym": "English",
  "settings.language.pickerTitle": "Choose language",
  "settings.language.pickerHint":
    "You can change this later at the top of Settings",
  "settings.language.saveFailed":
    "Couldn't save the language setting; it applies to this session only",
  "settings.title": "Settings",
  "settings.loading": "Loading…",
  "settings.chooseFolder": "Choose folder…",
  "settings.toggle.enable": "Turn on",
  "settings.toggle.disable": "Turn off",
  "settings.toggle.turnOn": "Turn on",
  "settings.toggle.turnOff": "Turn off",
  "settings.key.set": "Set",
  "settings.key.replacePlaceholder": "Type to replace",
  "settings.key.cleared": "Key cleared",
  "settings.key.clear": "Clear",
  "settings.group.game": "Game",
  "settings.group.ui": "Interface",
  "settings.group.ai": "AI analysis",
  "settings.group.recording": "Match recording (OBS)",
  "settings.group.about": "About",
  "settings.wowDir.label": "WoW folder",
  "settings.wowDir.unset":
    "Not set: choose it and the combat log is watched automatically",
  "settings.history.label": "Historical logs",
  "settings.history.note": "Re-importing skips matches already imported",
  "settings.uiZoom.label": "UI zoom",
  "settings.uiZoom.hint":
    "Scales text and layout together; takes effect on click, no restart needed.",
  "settings.uiZoom.note":
    "Scales text and layout together; raise it on 4K / high-DPI screens",
  "settings.uiZoom.saved": "UI zoom saved",
  "settings.anthropicKey.unset":
    "Not set (without a key, analysis uses the deterministic fallback)",
  "settings.anthropicKey.saved": "API key saved",
  "settings.deepseekKey.unset":
    "Not set (without a key, analysis uses the deterministic fallback; data is sent to api.deepseek.com)",
  "settings.deepseekKey.saveAria": "Save DeepSeek key",
  "settings.deepseekKey.saved": "DeepSeek key saved",
  "settings.backend.label": "Backend",
  "settings.backend.aria": "AI backend",
  "settings.backend.saved": "Backend switched",
  "settings.backend.claudeCli": "Claude CLI (local)",
  "settings.backend.agy": "agy / Gemini (local)",
  "settings.backend.codex": "Codex (local)",
  "settings.backend.codebuddy": "CodeBuddy CLI (local)",
  "settings.backend.note":
    "Local CLIs (Claude/agy/Codex/CodeBuddy) don't go through the network; DeepSeek is the official API: it needs a key and data leaves your machine",
  "settings.model.label": "Model",
  "settings.model.saved": "Model saved",
  "settings.command.label": "Command path",
  "settings.command.placeholderAgy":
    "Leave empty to auto-detect, or enter the full path to the agy executable (.mjs uses the old wrapper script)",
  "settings.command.placeholder":
    "Leave empty to auto-detect, or enter the full path to the {tool} executable",
  "settings.command.saved": "Command path saved",
  "settings.command.detected": "Detected: {path}",
  "settings.command.notDetected":
    "{tool} not found; install it and reopen Settings, or enter the full path",
  "settings.autoAnalyze.label": "Auto-analyze new matches",
  "settings.autoAnalyze.note":
    "When a new live match is stored, analyze it automatically with the current default model (imported logs don't trigger it).",
  "settings.autoAnalyze.offSaved": "Auto-analysis turned off",
  "settings.autoAnalyze.onSaved": "Auto-analysis turned on",
  "settings.selfReview.label": "AI self-review",
  "settings.selfReview.note":
    "After an analysis, the same model checks it once more against this match's data: it corrects or removes claims the data does not support and adds no new conclusions. Each analysis makes one more AI call: roughly double the usage and 1–2 minutes longer. Offline test (Opus, 51 matches): about two-thirds fewer wrong sentences. Off by default; after switching it, already-analyzed matches need to be analyzed again.",
  "settings.selfReview.offSaved": "AI self-review turned off",
  "settings.selfReview.onSaved": "AI self-review turned on",
  "settings.version.label": "Version",
  "settings.update.label": "Updates",
  "settings.update.unavailable": "Auto-update is not available here",
  "settings.update.checking": "Checking…",
  "settings.update.check": "Check for updates",
  "settings.update.schedule": (p: MessageParams) =>
    `Checks once ${p.delayS} ${Number(p.delayS) === 1 ? "second" : "seconds"} after launch, then every ${Number(p.hours) === 1 ? "hour" : `${p.hours} hours`}; downloads run in the background and install when you quit.`,
  "settings.autoCheck.label": "Check for updates automatically",
  "settings.autoCheck.offSaved": "Automatic checks turned off",
  "settings.autoCheck.onSaved": "Automatic checks turned on",
};
