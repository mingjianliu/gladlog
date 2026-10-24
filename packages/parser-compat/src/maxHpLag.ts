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
 *
 * Two readings rule a run out (codex 20-F17-03 #1, 5c48e842 r1 127.4 s: a
 * logged 73,971 heal took a druid from 669,809 to 743,780 / 743,780, then
 * current and max both became 818,158 — the heal's 1.11 matched the max's
 * 1.10 and the full-HP heal row was rewritten to 90.9 %):
 *  - the max-change row's own current HP moving by the ratio — the rescale
 *    happened there, with the max, so nothing before it lags;
 *  - the jump explained by the heals and hits the unit took between the two
 *    rows (`hpEvents`, signed effective amounts) — a real heal or hit.
 */
export const MAX_HP_LAG_MS = 1000;
/** relative tolerance between the current-HP jump and the max-HP ratio
 * (the three audited cases: 0.7713 vs 0.7692, 0.8696 vs 0.8696, 0.7724 vs
 * 0.7692 — healing or a tick inside the lag moves the jump a little) */
export const MAX_HP_LAG_RATIO_TOL = 0.01;
/** how closely the logged heals / hits between two rows must add up to the
 * current-HP change for the change to be theirs (relative to the change) */
export const MAX_HP_LAG_EXPLAINED_TOL = 0.02;

/**
 * The max HP each sample should be read with: its own, or — for a sample
 * inside a lag run — the maximum the run ends on. Samples must be sorted by
 * time; returns an array of the same length.
 */
export function laggingMaxHpCorrected(
  samples: ReadonlyArray<{ timestamp: number; hp: number; maxHp: number }>,
  /** the unit's heals (+) and hits (−) by effective amount, sorted by time */
  hpEvents: ReadonlyArray<{ timestamp: number; amount: number }> = [],
): number[] {
  const out = samples.map((s) => s.maxHp);
  const explained = (fromMs: number, toMs: number, delta: number) => {
    let sum = 0;
    let any = false;
    for (const e of hpEvents) {
      if (e.timestamp <= fromMs) continue;
      if (e.timestamp > toMs) break;
      sum += e.amount;
      any = true;
    }
    return (
      any && Math.abs(sum - delta) <= MAX_HP_LAG_EXPLAINED_TOL * Math.abs(delta)
    );
  };
  for (let k = 1; k < samples.length; k++) {
    const oldMax = samples[k - 1]!.maxHp;
    const newMax = samples[k]!.maxHp;
    if (!(oldMax > 0) || !(newMax > 0) || oldMax === newMax) continue;
    const ratio = newMax / oldMax;
    // the current HP rescaled on the max-change row itself: no lag — unless
    // the logged heals / hits between the two rows account for that move
    // (codex 20-F17-05 #1, 8e2dab45 r0 86.144 s: a 40,791 hit on the
    // max-change row matched the ratio and hid the rescale at 85.823 s)
    const hpBefore = samples[k - 1]!.hp;
    if (
      hpBefore > 0 &&
      Math.abs(samples[k]!.hp / hpBefore - ratio) <=
        MAX_HP_LAG_RATIO_TOL * ratio &&
      !explained(
        samples[k - 1]!.timestamp,
        samples[k]!.timestamp,
        samples[k]!.hp - hpBefore,
      )
    )
      continue;
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
        // a real heal / hit of that size is no rescale: look further back
        // (codex 20-F17-05 #2, 0284fcd9 r3 115.453 s: a 44,302 hit matched
        // the ratio and the 115.417 s rescale was never reached)
        if (explained(prev.timestamp, s.timestamp, s.hp - prev.hp)) continue;
        for (let j = i; j < k; j++) out[j] = newMax;
        break;
      }
    }
  }
  return out;
}
