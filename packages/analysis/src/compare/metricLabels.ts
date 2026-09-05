/**
 * Single source of the display labels (en/zh) for comparison dimensions —
 * shared by the renderer table and main's commentary substitution. Predicates
 * are the spec: the key names equal cellAggregator SCALAR_METRICS /
 * verifiedComparison dims.key.
 */
export const METRIC_LABELS: Record<string, { en: string; zh: string }> = {
  // healer
  offensiveIndex: { en: "Offensive output index", zh: "进攻输出指数" },
  ccDensity: { en: "CC per minute", zh: "控制密度(次/分)" },
  reactionLatency: {
    en: "Defensive reaction latency (s)",
    zh: "防御反应延迟(秒)",
  },
  defensiveOverlapRatio: {
    en: "Defensive overlap ratio",
    zh: "减伤重叠浪费率",
  },
  effectiveCastRatio: { en: "Effective cast ratio", zh: "有效施法占比" },
  ccAvoidanceRate: { en: "CC avoidance rate", zh: "躲控成功率" },
  // dps
  burstCount: { en: "Burst windows", zh: "爆发窗口数" },
  burstConversionRate: { en: "Burst conversion rate", zh: "爆发转化率" },
  burstIntoDefensiveRatio: {
    en: "Burst into defensives",
    zh: "爆发打进减伤占比",
  },
  alignedBurstRatio: { en: "CD-aligned burst ratio", zh: "爆发与队友CD对齐率" },
  onTargetPct: { en: "On-target damage %", zh: "集火目标伤害占比" },
  kickLandedRate: { en: "Kick landed rate", zh: "打断命中率" },
  kicksJukedCount: { en: "Kicks juked", zh: "被骗断次数" },
  firstBurstSeconds: { en: "First burst timing (s)", zh: "首次爆发时刻(秒)" },
};

/** The three English verdicts from verifiedComparison's verdictFor →
 * localization. The keys must match its output verbatim. */
export const VERDICT_LABELS: Record<string, { en: string; zh: string }> = {
  "lower than most of your cohort": {
    en: "lower than most of your cohort",
    zh: "低于同组大多数玩家",
  },
  "higher than most of your cohort": {
    en: "higher than most of your cohort",
    zh: "高于同组大多数玩家",
  },
  "around the cohort median": {
    en: "around the cohort median",
    zh: "处于同组中位水平",
  },
};

export function metricLabel(key: string, lang: "en" | "zh"): string {
  return METRIC_LABELS[key]?.[lang] ?? key;
}

/**
 * Single source for score direction: a percentile is a neutral rank, so the
 * score must be direction-corrected.
 * "lower" = lower values are better (score = 100 - percentile); everything else
 * is higher-is-better.
 */
export const METRIC_LOWER_IS_BETTER = new Set<string>([
  "reactionLatency",
  "defensiveOverlapRatio",
  "burstIntoDefensiveRatio",
  "kicksJukedCount",
  "firstBurstSeconds",
]);

/** Direction-corrected 0-100 score (higher is better). */
export function metricScore(key: string, percentile: number): number {
  return METRIC_LOWER_IS_BETTER.has(key) ? 100 - percentile : percentile;
}

export function verdictLabel(verdict: string, lang: "en" | "zh"): string {
  return VERDICT_LABELS[verdict]?.[lang] ?? verdict;
}
