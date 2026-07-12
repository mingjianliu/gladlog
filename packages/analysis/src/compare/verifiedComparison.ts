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

/** Piecewise-linear percentile from the 3 stored anchors; clamped to [10,90]. */
export function percentileRank(
  value: number,
  d: { p10: number; p50: number; p90: number },
): number {
  if (value <= d.p10) return 10;
  if (value >= d.p90) return 90;
  if (value <= d.p50) {
    const t = (value - d.p10) / (d.p50 - d.p10 || 1);
    return 10 + t * 40;
  }
  const t = (value - d.p50) / (d.p90 - d.p50 || 1);
  return 50 + t * 40;
}

// Direction-neutral rank band — states WHERE you rank, never good/bad.
function verdictFor(percentile: number): string {
  if (percentile < 25) return "bottom quartile of your cohort";
  if (percentile > 75) return "top quartile of your cohort";
  return "mid-pack in your cohort";
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export function verifiedComparison(
  metrics: Record<string, number | null>,
  cell: ReferenceCell,
): VerifiedComparison {
  const dims: PerDim[] = [];
  const facts: Record<string, string> = {};
  for (const [key, dist] of Object.entries(cell.metrics)) {
    const value = metrics[key];
    if (typeof value !== "number" || Number.isNaN(value)) continue;
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
    facts[`${key}.percentile`] = `${percentile}th percentile`;
    facts[`${key}.verdict`] = verdict;
  }
  return { dims, facts };
}
