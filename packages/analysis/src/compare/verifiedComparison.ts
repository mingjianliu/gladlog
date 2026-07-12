import type { ReferenceCell } from "./corpusTypes";

export interface PerDim {
  key: string;
  value: number | null;
  p10: number;
  p50: number;
  p90: number;
  percentile: number;
  verdict: string;
}
export interface VerifiedComparison {
  dims: PerDim[];
  facts: Record<string, string>;
}

/**
 * Piecewise-linear percentile from the 3 stored anchors; clamped to [10,90].
 * Assumes p10 ≤ p50 ≤ p90 — always true from the corpus builder (percentiles of
 * ascending-sorted values), including lower-is-better metrics (the distribution
 * is not inverted; only the value's meaning is).
 */
export function percentileRank(
  value: number,
  d: { p10: number; p50: number; p90: number },
): number {
  // At the median → 50, checked FIRST so a value sitting on a degenerate/sparse
  // clump (e.g. value=0 when p10=p50=0) reads "mid-pack", not "bottom quartile".
  if (value === d.p50) return 50;
  if (value <= d.p10) return 10;
  if (value >= d.p90) return 90;
  if (value < d.p50) {
    const t = (value - d.p10) / (d.p50 - d.p10 || 1);
    return 10 + t * 40;
  }
  const t = (value - d.p50) / (d.p90 - d.p50 || 1);
  return 50 + t * 40;
}

// Direction-neutral rank band. Uses "higher/lower than most" rather than
// "top/bottom quartile" so a high-is-bad metric (e.g. reactionLatency) doesn't
// read as praise — it states where the VALUE sits, letting the reader judge.
function verdictFor(percentile: number): string {
  if (percentile < 25) return "lower than most of your cohort";
  if (percentile > 75) return "higher than most of your cohort";
  return "around the cohort median";
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export function verifiedComparison(
  metrics: Record<string, number | null>,
  cell: ReferenceCell,
): VerifiedComparison {
  const dims: PerDim[] = [];
  const facts: Record<string, string> = {};
  for (const [key, dist] of Object.entries(cell.metrics)) {
    const value = metrics[key];
    if (typeof value !== "number" || Number.isNaN(value)) continue;
    // No cohort samples for this dim → the p10/p50/p90 are all 0 (empty pool),
    // so any comparison is bogus. Skip it rather than show a fake percentile.
    if (!dist || dist.n === 0) continue;
    const percentile = Math.round(percentileRank(value, dist));
    const verdict = verdictFor(percentile);
    dims.push({
      key,
      value,
      p10: dist.p10,
      p50: dist.p50,
      p90: dist.p90,
      percentile,
      verdict,
    });
    facts[key] = fmt(value);
    facts[`${key}.cohortMedian`] = fmt(dist.p50);
    facts[`${key}.p10`] = fmt(dist.p10);
    facts[`${key}.p90`] = fmt(dist.p90);
    facts[`${key}.percentile`] = ordinal(percentile); // "10th" — the LLM adds "percentile"
    facts[`${key}.verdict`] = verdict;
  }
  return { dims, facts };
}
