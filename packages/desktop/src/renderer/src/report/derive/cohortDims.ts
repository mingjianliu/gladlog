import { metricLabel, verdictLabel } from "@gladlog/analysis";

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
  keyLabel: string;
  value: number | null;
  valueLabel: string;
  percentile: number;
  percentileLabel: string;
  verdict: string;
  verdictLabel: string;
  p10: number;
  p50: number;
  p90: number;
}

export function cohortDims(
  dims: CohortDim[],
  lang: "en" | "zh" = "en",
): CohortDimRow[] {
  return dims.map((d) => ({
    key: d.key,
    keyLabel: metricLabel(d.key, lang),
    value: d.value,
    valueLabel: d.value !== null ? String(d.value) : "N/A",
    percentile: d.percentile,
    percentileLabel:
      lang === "zh" ? `第${d.percentile}百分位` : `${d.percentile}th`,
    verdict: d.verdict,
    verdictLabel: verdictLabel(d.verdict, lang),
    p10: d.p10,
    p50: d.p50,
    p90: d.p90,
  }));
}
