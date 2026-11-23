import type { StoredMatchMeta } from "../../../main/matchStore";
import { type Language, localeToLanguage } from "../../../shared/i18n";
import { bridge } from "../bridge";
import {
  type BatchItem,
  getBatchStatus,
  startBatch,
  subscribeBatch,
} from "./batchAnalysis";
import { batchItemLabel } from "./itemLabel";

type LiveStoredMatchMeta = StoredMatchMeta & { live?: boolean };

/**
 * Auto-analysis of new matches (2026-08-01, spec:
 * docs/superpowers/specs/2026-08-01-auto-analyze-design.md).
 *
 * A module-level queue: one new match = one meta.id, deduplicated and then
 * handed to the batch driver (batchAnalysis.ts) — skip-if-cached, serial
 * execution and auto deep-dive get zero new logic, so auto-analysis and manual
 * batch analysis share one pipeline.
 *
 * Iron rule for the decision: only a matchStored payload with live===true (set
 * by the live path in main/index.ts) triggers it. The import path
 * (importLogs.ts) does not carry that field and is therefore blocked by the
 * very first check in handleMatchStored — an import flood can never be fed
 * into this queue.
 */
const pending: string[] = [];
const pendingLabels = new Map<string, string>();

/** Unsubscribe handle for waiting while busy; non-null means we are already
 * waiting for one idle notification, so concurrent drain() calls do not attach
 * several subscribeBatch listeners for the same pending batch. */
let waitingForIdle: (() => void) | null = null;

/** Same label as the batch bar (batchItemLabel); with no valid startTime it
 * degrades to the first eight characters of the id. */
function labelFor(meta: StoredMatchMeta, lang: Language): string {
  if (Number.isNaN(new Date(meta.startTime).getTime()))
    return meta.id.slice(0, 8);
  return batchItemLabel(meta.startTime, meta.bracket, lang);
}

function drain(): void {
  if (pending.length === 0) return;
  if (getBatchStatus().running) {
    // A batch is already running (the user started one manually, or the
    // previous auto-analysis round has not wrapped up): wait for idle and
    // retry, without attaching multiple subscriptions.
    if (!waitingForIdle) {
      waitingForIdle = subscribeBatch(() => {
        if (getBatchStatus().running) return;
        waitingForIdle?.();
        waitingForIdle = null;
        drain();
      });
    }
    return;
  }
  const items: BatchItem[] = pending.splice(0).map((id) => ({
    id,
    label: pendingLabels.get(id) ?? id.slice(0, 8),
  }));
  for (const item of items) pendingLabels.delete(item.id);
  void startBatch(items);
}

function enqueue(meta: StoredMatchMeta, lang: Language): void {
  // Deduplicate: repeated notifications for the same match queue only once
  if (pending.includes(meta.id)) return;
  pending.push(meta.id);
  pendingLabels.set(meta.id, labelFor(meta, lang));
  drain();
}

async function handleMatchStored(meta: LiveStoredMatchMeta): Promise<void> {
  // Iron rule: the import path carries no live flag and is blocked right here
  if (!meta.live) return;
  let settings: { autoAnalyzeNew: boolean; language?: Language | null };
  try {
    settings = await bridge().settings.get();
  } catch {
    return; // stub without a settings surface (some test beds / fixtures)
  }
  if (!settings.autoAnalyzeNew) return;
  // The UI language, resolved the way LangProvider does when it is unset.
  const lang =
    settings.language === "zh" || settings.language === "en"
      ? settings.language
      : localeToLanguage(
          typeof navigator === "undefined" ? undefined : navigator.language,
        );
  enqueue(meta, lang);
}

/**
 * Called once when the App mounts; returns an unsubscribe function. The caller
 * (App.tsx) must try/catch it itself — with a stub lacking the logs surface,
 * bridge().logs.onMatchStored can throw outright.
 */
export function startAutoAnalyzeListener(): () => void {
  return bridge().logs.onMatchStored((meta) => {
    void handleMatchStored(meta as LiveStoredMatchMeta);
  });
}
