export interface CohortDim {
  key: string;
  value: number | null;
  p10: number;
  p50: number;
  p90: number;
  percentile: number;
  verdict: string;
}

export interface CohortDimRow {
  key: string;
  value: number | null;
  valueLabel: string;
  percentile: number;
  percentileLabel: string;
  verdict: string;
  p10: number;
  p50: number;
  p90: number;
}

export function cohortDims(dims: CohortDim[]): CohortDimRow[] {
  return dims.map((d) => ({
    key: d.key,
    value: d.value,
    valueLabel: d.value !== null ? String(d.value) : "N/A",
    percentile: d.percentile,
    percentileLabel: `${d.percentile}th`,
    verdict: d.verdict,
    p10: d.p10,
    p50: d.p50,
    p90: d.p90,
  }));
}
