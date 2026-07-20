import { DMG_SPIKE_THRESHOLD } from "./timelineHelpers";

/**
 * 「关键窗口」的单源定义 —— 哪些整数秒属于高密度采样区。
 *
 * 为什么必须单源(2026-07-20 的 50 场 eval,31 场 + 6 场两类缺陷同一根因):
 * `[STATE]` tick 在关键窗口内把 HP 采样半径收窄到 ±1.5s(理由正当:1s 密集
 * tick 不该重复取样),而 `[DMG SPIKE]` / `[CD]` 行内嵌的 HP 恒用 ±3s ——
 * 而这些行**恰恰只出现在关键窗口里**,于是同一渲染秒的两行 HP 必然打架
 * (最极端:spike 报 2%、STATE 报 88%)。
 *
 * 修法不是逐处对齐数值,而是让所有 HP 消费者从**同一个窗口集合**取半径
 * (见 utils/cooldowns.ts 的 hpSampleRadiusMs)。任何新的「渲染时刻 HP」
 * 调用点都必须接这个集合,而不是传死 HP_SAMPLE_RADIUS_MS。
 */
export interface CriticalWindowInputs {
  friendlyDeaths: ReadonlyArray<{ atSeconds: number }>;
  enemyDeaths: ReadonlyArray<{ atSeconds: number }>;
  pressureWindows: ReadonlyArray<{ fromSeconds: number; totalDamage: number }>;
  ccTrinketSummaries: ReadonlyArray<{
    ccInstances: ReadonlyArray<{ atSeconds: number }>;
  }>;
  matchDurationSeconds: number;
}

/** 死亡前回溯窗口(秒)。 */
const DEATH_LOOKBACK_S = 10;
/** DMG SPIKE 起点两侧的半宽(秒)。 */
const SPIKE_HALF_WIDTH_S = 5;
/** CC 施加后的前瞻窗口(秒)。 */
const CC_LOOKAHEAD_S = 10;

export function buildCriticalWindowSet(
  inputs: CriticalWindowInputs,
): Set<number> {
  const {
    friendlyDeaths,
    enemyDeaths,
    pressureWindows,
    ccTrinketSummaries,
    matchDurationSeconds,
  } = inputs;
  const set = new Set<number>();
  const addRange = (fromS: number, toS: number) => {
    const from = Math.max(0, Math.ceil(fromS));
    const to = Math.min(Math.floor(matchDurationSeconds), Math.floor(toS));
    for (let t = from; t <= to; t++) set.add(t);
  };

  // 死亡前 [T-10, T] —— 敌我同权重
  for (const d of [...friendlyDeaths, ...enemyDeaths]) {
    addRange(d.atSeconds - DEATH_LOOKBACK_S, d.atSeconds);
  }
  // DMG SPIKE 起点 ±5s
  for (const pw of pressureWindows) {
    if (pw.totalDamage >= DMG_SPIKE_THRESHOLD) {
      addRange(
        pw.fromSeconds - SPIKE_HALF_WIDTH_S,
        pw.fromSeconds + SPIKE_HALF_WIDTH_S,
      );
    }
  }
  // CC 施加后 +10s
  for (const summary of ccTrinketSummaries) {
    for (const cc of summary.ccInstances) {
      addRange(cc.atSeconds, cc.atSeconds + CC_LOOKAHEAD_S);
    }
  }
  return set;
}
