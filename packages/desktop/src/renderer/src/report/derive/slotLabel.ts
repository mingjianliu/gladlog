import {
  AI_MODELS,
  type AiBackend,
  modelLabel,
} from "../../../../shared/aiModels";
// Must be imported from analysisSlots (zero fs/path dependencies), never from
// analysisCache — that module starts with `import { join } from "path"`, so
// importing it from the renderer drags a Node built-in into the browser bundle
// and only blows up at electron-vite build time (see the header comment in
// analysisCache.ts; presubmit caught this once).
import { splitSlotKey } from "../../../../shared/analysisSlots";
import type { Language } from "../../../../shared/i18n";

/**
 * Slot key → backend display name. This lives in its own small module (rather
 * than inside StructuredAnalysisPanel.tsx) because Task 4's slot-picker menu
 * reuses `slotLabel`, and that menu is likely to be rendered from
 * StructuredAnalysisPanel — putting a pure function inside a UI component file
 * plants a circular-dependency hazard (agy flash review F3). derive/ is a
 * presentation layer with zero React dependencies, safe for anyone to import.
 */
const BACKEND_LABELS: Record<AiBackend, string> = {
  anthropic: "Claude API",
  claudeCli: "Claude CLI",
  agy: "agy",
  codex: "Codex",
  codebuddy: "CodeBuddy",
  deepseek: "DeepSeek",
};

/**
 * Slot key (`${backend}:${model}`, see slotKeyOf in shared/analysisSlots.ts) →
 * the text shown in tabs and menus. The splitting predicate is single-source
 * (`splitSlotKey`, shared with deepenInner in main/analysis.ts; see that
 * function's comment) — no more hand-written `indexOf(":")` in each place. The
 * backend is looked up in BACKEND_LABELS and the model in AI_MODELS; both pass
 * unknown values through unchanged (hand-edited config or a future model must
 * not break).
 */
export function slotLabel(key: string, lang: Language = "zh"): string {
  const split = splitSlotKey(key);
  if (!split) return key;
  return backendModelLabel(split.backend, split.model, lang);
}

/**
 * backend+model → display text, without going through a slot key. The running
 * status lines (StructuredAnalysisPanel / ProComparisonVerified, 2026-08-05
 * 生产反馈) show "which backend/model is running right now" and share this
 * exact lookup with slotLabel — one fact, one predicate.
 */
export function backendModelLabel(
  backend: string,
  model: string,
  lang: Language = "zh",
): string {
  const backendLabel = BACKEND_LABELS[backend as AiBackend] ?? backend;
  const option = AI_MODELS[backend as AiBackend]?.find((m) => m.id === model);
  return `${backendLabel} · ${option ? modelLabel(option, lang) : model}`;
}
