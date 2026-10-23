/**
 * The max-HP field of an advanced sample can lag a max-HP change (fact4 D13 /
 * D14 / D50, 2026-10-22). When a unit leaves Bear Form or loses a max-HP buff
 * (Ursine Vigor), the game rescales its CURRENT HP to the new maximum at once,
 * but the rows logged over the next ~0.3 s still carry the OLD maximum:
 *
 *   353ad51a r0 1:01  bear exit   1,607,106 / 1,644,592 (97.7 %)
 *                                 1,239,524 / 1,644,592 (75.4 %)   ← lagging
 *                                 1,251,259 / 1,265,069 (98.9 %)
 *   353ad51a r0 1:04  Ursine Vigor 1,265,069 / 1,265,069
 *                                 1,100,060 / 1,265,069 (87.0 %)   ← lagging
 *                                 1,100,060 / 1,100,060 (100 %)
 *
 * Read as written, a full-HP druid "fell to 75 %". A lagging row is told by
 * its current HP jumping by the very ratio the maximum then moves by: from
 * the row where current HP changes by a factor within `MAX_HP_LAG_RATIO_TOL`
 * of new max / old max while the max stays put, to the row the max catches up
 * on (at most `MAX_HP_LAG_MS` later), the new maximum is the row's.
 */
export const MAX_HP_LAG_MS = 1000;
/** relative tolerance between the current-HP jump and the max-HP ratio
 * (the three audited cases: 0.7713 vs 0.7692, 0.8696 vs 0.8696, 0.7724 vs
 * 0.7692 — healing or a tick inside the lag moves the jump a little) */
export const MAX_HP_LAG_RATIO_TOL = 0.01;

/**
 * The max HP each sample should be read with: its own, or — for a sample
 * inside a lag run — the maximum the run ends on. Samples must be sorted by
 * time; returns an array of the same length.
 */
export function laggingMaxHpCorrected(
  samples: ReadonlyArray<{ timestamp: number; hp: number; maxHp: number }>,
): number[] {
  const out = samples.map((s) => s.maxHp);
  for (let k = 1; k < samples.length; k++) {
    const oldMax = samples[k - 1]!.maxHp;
    const newMax = samples[k]!.maxHp;
    if (!(oldMax > 0) || !(newMax > 0) || oldMax === newMax) continue;
    const ratio = newMax / oldMax;
    // walk back over the rows still on the old maximum inside the lag window
    // for the current-HP jump by that ratio
    for (let i = k - 1; i >= 1; i--) {
      const s = samples[i]!;
      const prev = samples[i - 1]!;
      if (s.maxHp !== oldMax || prev.maxHp !== oldMax) break;
      if (samples[k]!.timestamp - s.timestamp > MAX_HP_LAG_MS) break;
      if (!(prev.hp > 0)) continue;
      const jump = s.hp / prev.hp;
      if (Math.abs(jump - ratio) <= MAX_HP_LAG_RATIO_TOL * ratio) {
        for (let j = i; j < k; j++) out[j] = newMax;
        break;
      }
    }
  }
  return out;
}
