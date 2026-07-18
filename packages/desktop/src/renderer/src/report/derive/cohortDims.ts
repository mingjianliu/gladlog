import { metricLabel, metricScore, verdictLabel } from "@gladlog/analysis";

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
  /** 方向修正后的 0-100 评分(越高越好)= metricScore 单源。 */
  score: number;
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
    score: metricScore(d.key, d.percentile),
    verdict: d.verdict,
    verdictLabel: verdictLabel(d.verdict, lang),
    p10: d.p10,
    p50: d.p50,
    p90: d.p90,
  }));
}
