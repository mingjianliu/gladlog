/**
 * 对比维度的展示标签单源(en/zh)——renderer 表格与 main 解说替换共用,
 * 谓词即规范:键名 = cellAggregator SCALAR_METRICS / verifiedComparison dims.key。
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

/** verifiedComparison verdictFor 的三个英文判词 → 本地化。键必须与其输出逐字一致。 */
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
 * 评分方向单源:percentile 是中性排名,评分必须方向修正。
 * "lower" = 数值越低越好(评分 = 100 - percentile);其余越高越好。
 */
export const METRIC_LOWER_IS_BETTER = new Set<string>([
  "reactionLatency",
  "defensiveOverlapRatio",
  "burstIntoDefensiveRatio",
  "kicksJukedCount",
  "firstBurstSeconds",
]);

/** 方向修正后的 0-100 评分(越高越好)。 */
export function metricScore(key: string, percentile: number): number {
  return METRIC_LOWER_IS_BETTER.has(key) ? 100 - percentile : percentile;
}

export function verdictLabel(verdict: string, lang: "en" | "zh"): string {
  return VERDICT_LABELS[verdict]?.[lang] ?? verdict;
}
