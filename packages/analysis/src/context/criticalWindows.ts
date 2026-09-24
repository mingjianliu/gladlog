import { DMG_SPIKE_THRESHOLD } from "./timelineHelpers";

/**
 * Single-source definition of a "critical window" — which whole seconds belong
 * to the densely sampled region.
 *
 * Why it MUST be single-source (2026-07-20, 50-match eval: 31 matches + 6
 * matches, two defect classes with one root cause): the `[STATE]` tick narrows
 * the HP sampling radius to ±1.5s inside critical windows (for a legitimate
 * reason: dense 1s ticks must not re-read the same sample), while the HP
 * embedded in `[DMG SPIKE]` / `[CD]` lines always used ±3s — and those lines
 * **appear only inside critical windows**, so two HP figures under the same
 * rendered second necessarily disagreed (worst case: the spike reported 2% and
 * STATE reported 88%).
 *
 * The fix is not to align the numbers spot by spot, but to have every HP
 * consumer take its radius from **the same window set** (see hpSampleRadiusMs
 * in utils/cooldowns.ts). Any new "HP at a rendered instant" call site must be
 * wired to this set rather than passing a hard-coded HP_SAMPLE_RADIUS_MS.
 */
interface CriticalWindowInputs {
  friendlyDeaths: ReadonlyArray<{ atSeconds: number }>;
  enemyDeaths: ReadonlyArray<{ atSeconds: number }>;
  pressureWindows: ReadonlyArray<{ fromSeconds: number; totalDamage: number }>;
  ccTrinketSummaries: ReadonlyArray<{
    ccInstances: ReadonlyArray<{ atSeconds: number }>;
  }>;
  matchDurationSeconds: number;
}

// GH #34 batch 4 (2026-08-28), measured on the last 300 matches / 1,126
// rounds (1,237 deaths, 5,235 spikes ≥ DMG_SPIKE_THRESHOLD, 23,973 CC
// instances): the union set covers **75.7 % of all match seconds** — death
// windows alone 7.0 %, spike windows 28.4 %, CC look-ahead 66.3 %. So the
// "critical" set is most of the match, and the CC term dominates it:
// CC_LOOKAHEAD 10 → 5 drops coverage to 61.3 %, → 15 raises it to 83.6 %;
// DEATH_LOOKBACK 5/15 moves it by < 1 pp; SPIKE_HALF_WIDTH 3/8 gives
// 72.8 % / 79.8 %. Consumers (matchTimeline.ts): casts OUTSIDE the set are
// foldable (F151) and [STATE] ticks are sparser — i.e. these numbers decide
// how much of the timeline gets the compact treatment. Token effect measured
// 2026-08-29 (same 300 matches): CC_LOOKAHEAD 10 → 5 shrinks the match
// context by only 2.3 % (32,471 → 31,736 chars, ≈ 230 tokens of ~10k),
// −9 [STATE] ticks and −8 lines per prompt, cast folding unchanged (4.4
// markers either way — folding rides on the death/spike terms). User ruling
// 2026-08-29: keep 10 — the "critical" set is not where prompt size lives.
// Re-run the coverage script before moving any of the three.
/** Look-back window before a death (seconds). */
const DEATH_LOOKBACK_S = 10;
/** Half-width around a DMG SPIKE start (seconds). */
const SPIKE_HALF_WIDTH_S = 5;
/** Look-ahead window after CC is applied (seconds). */
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

  // [T-10, T] before a death — friendly and enemy weighted alike
  for (const d of [...friendlyDeaths, ...enemyDeaths]) {
    addRange(d.atSeconds - DEATH_LOOKBACK_S, d.atSeconds);
  }
  // DMG SPIKE start ±5s
  for (const pw of pressureWindows) {
    if (pw.totalDamage >= DMG_SPIKE_THRESHOLD) {
      addRange(
        pw.fromSeconds - SPIKE_HALF_WIDTH_S,
        pw.fromSeconds + SPIKE_HALF_WIDTH_S,
      );
    }
  }
  // +10s after CC is applied
  for (const summary of ccTrinketSummaries) {
    for (const cc of summary.ccInstances) {
      addRange(cc.atSeconds, cc.atSeconds + CC_LOOKAHEAD_S);
    }
  }
  return set;
}
