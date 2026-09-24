/**
 * Pure aggregation over a review session's answers, split by card source
 * (deep-dive vs baseline). No rendering, no I/O — `ReviewPanel.tsx` is the
 * only consumer, and keeping this pure lets `summary.test.ts` exercise the
 * `novelValuable` operational definition without mounting React.
 */
import type {
  ReviewAnswer,
  ReviewSession,
} from "../../../eval/src/explore/reviewTypes";

const DIM_KEYS = [
  "truth",
  "awareness",
  "actionable",
  "adopt",
  "impact",
] as const;

interface SourceSummary {
  total: number;
  answered: number;
  novelValuable: number;
  dims: Record<string, Record<string, number>>;
}

interface ReviewSummary {
  bySource: Record<"deep" | "baseline", SourceSummary>;
}

function emptySourceSummary(): SourceSummary {
  return { total: 0, answered: 0, novelValuable: 0, dims: {} };
}

/** Operational definition of a "novel & valuable" finding (spec-fixed, do
 *  not weaken): the reviewer confirmed the claim was true, they did NOT
 *  already know it in the moment, and it mattered (high/med impact). */
function isNovelValuable(answer: ReviewAnswer): boolean {
  return (
    answer.truth === "true" &&
    answer.awareness === "unaware" &&
    (answer.impact === "high" || answer.impact === "med")
  );
}

export function summarize(
  session: ReviewSession,
  answers: ReviewAnswer[],
): ReviewSummary {
  const bySource: ReviewSummary["bySource"] = {
    deep: emptySourceSummary(),
    baseline: emptySourceSummary(),
  };
  const sourceByCardId = new Map(
    session.cards.map((c) => [c.cardId, c.source]),
  );
  for (const c of session.cards) {
    bySource[c.source].total += 1;
  }
  for (const a of answers) {
    const source = sourceByCardId.get(a.cardId);
    if (!source) continue; // answer for a card outside this session — ignore
    const bucket = bySource[source];
    bucket.answered += 1;
    if (isNovelValuable(a)) {
      bucket.novelValuable += 1;
    }
    for (const dim of DIM_KEYS) {
      const value = a[dim];
      const dimCounts = (bucket.dims[dim] ??= {});
      dimCounts[value] = (dimCounts[value] ?? 0) + 1;
    }
  }
  return { bySource };
}
