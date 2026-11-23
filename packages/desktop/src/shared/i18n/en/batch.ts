import type { MessageParams } from "../index";

// English dictionary for the `batch.*` namespace. Must mirror zh/batch.ts
// key-for-key (enforced by `satisfies Messages` in en/index.ts).
const matches = (n: unknown): string =>
  Number(n) === 1 ? "1 match" : `${n} matches`;

export const enBatch = {
  "batch.title": "Batch AI analysis",
  "batch.titleHint":
    "By default takes the N newest matches; check rows in the list below to analyze only those (checking a shuffle selects all 6 rounds). Up to three run in parallel, with the same output as analyzing each match by hand (deep dive included).",
  "batch.empty.selected": "All checked matches are already analyzed",
  "batch.empty.recent": "No unanalyzed matches",
  "batch.running": "Analyzing {done}/{total}",
  "batch.cancel": "Cancel",
  "batch.cancelledPrefix": "Cancelled: ",
  "batch.finishedPrefix": "Batch done: ",
  "batch.summary": "{ok} succeeded · {skipped} skipped · {failed} failed",
  "batch.dismissAria": "Dismiss summary",
  "batch.selected": (p: MessageParams) => `${matches(p.n)} checked`,
  "batch.clearSelection": "Clear selection",
  "batch.recentBefore": "Latest",
  "batch.recentAfter": "matches",
  "batch.skip": "Skip analyzed",
  "batch.skipHint":
    "Checked (default): matches that already have a cached analysis are skipped, so you don't pay twice. Unchecked: re-analyze and overwrite the old result (same as \"Re-analyze\" on a match's panel). A match that is being analyzed is never run twice in either mode.",
  "batch.startSelected": (p: MessageParams) =>
    `Analyze ${p.n} checked ${Number(p.n) === 1 ? "match" : "matches"}`,
  "batch.start": "Start",
};
