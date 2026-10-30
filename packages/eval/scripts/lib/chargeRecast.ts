/**
 * The static reading of `cooldownRecastScan.ts`: which presses of one spell
 * were impossible under a fixed cooldown `cd` with `charges` charges.
 *
 * Charges come back one at a time (the game's sequential recharge, as
 * `chargeStateAt` reads it): a press with no charge left is impossible. The
 * old pairwise check (press i against press i − charges) passed 0 / 5 / 20 /
 * 25 s with two 20 s charges — both gaps are 20 s — yet at 25 s no charge is
 * back (the second recharge only starts at 20 s and ends at 40 s; codex
 * 59-POSTHOC-11b #1). An impossible press is still a press the game took, so
 * the reading re-anchors on it: the recharge in progress restarts there, as
 * the pairwise check did for one charge (where both readings agree).
 *
 * `slackS` bends the verdict only, never the state: the recharge advances on
 * the press's own second and a press with nothing in hand re-anchors there —
 * `chargeStateAt`'s simulation step for step — and that press is impossible
 * only when the next charge is more than `slackS` away. Advancing the state
 * to `p + slackS` let an early press fill the pool and restart its timer, so
 * the slack leaked into every later verdict (codex 30-RV-04 #1).
 */
export function chargeImpossibleAt(
  presses: readonly number[],
  cd: number,
  charges: number,
  slackS: number,
): number[] {
  const cap = Math.max(1, charges);
  const t = [...presses].sort((a, b) => a - b);
  const out: number[] = [];
  let left = cap;
  let rechargeEnd = Infinity;
  for (const p of t) {
    while (left < cap && rechargeEnd <= p) {
      left++;
      rechargeEnd = left < cap ? rechargeEnd + cd : Infinity;
    }
    if (left <= 0) {
      if (rechargeEnd > p + slackS) out.push(p);
      rechargeEnd = p + cd;
      continue;
    }
    left--;
    if (rechargeEnd === Infinity) rechargeEnd = p + cd;
  }
  return out;
}

/** the summary's grouping: a spell's cooldown differs by spec and talents
 * (Fire Dragon's Breath 40 s, Frost 28 s), so one spell id pooled over specs
 * lets a correct spec's ratios hide a wrong one's (codex 59-POSTHOC-11b #2) */
export const recastAggKey = (
  spellId: string,
  spec: string,
  cd: number,
  charges: number,
): string => `${spellId}|${spec}|${cd}s×${Math.max(1, charges)}`;
