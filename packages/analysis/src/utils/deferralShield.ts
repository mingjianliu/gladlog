/**
 * Time Dilation 357170's deferral as the log shows it — what a pressed one
 * held back and when that damage comes back, so the counterfactual prices a
 * missed one by the damage still held back at the death, not by the table's
 * 50 % of the window (user 2026-10-30: no 50 % in the prompt, tell the model
 * how much damage was actually taken).
 *
 * The rule (tooltip: 「延缓其即将受到的伤害的50%，改为在8秒内承受」; measured
 * on 138 October arena files with a Preservation Evoker, eval-private
 * runs/pevoker-pvp-2026-10-29 `probes/td_sim.py`, `td_phase.py`):
 * - while the buff is up, each hit is half absorbed (SPELL_ABSORBED by 357170);
 * - the held-back damage comes back as the unit's own periodic 361029: the
 *   first tick ~1 s after the first absorb (84 % of 10,562 episodes ≤ 1.0 s),
 *   then one a second; a tick with an absorb since the previous one is
 *   pending / 8, a tick with none repeats the previous amount until nothing
 *   is pending — so 43 % of the take-back lands while the buff is still up
 *   and the rest over the 8 s after it ends;
 * - run from the absorbs alone it reproduces the log, read as each take-back
 *   tick's baseAmount (the unit's own mitigation applies after the pool pays
 *   it out) with fully absorbed ticks (SPELL_PERIODIC_MISSED ABSORB) still
 *   paying the rule's amount: 90.6 % of 18,535 ticks within ±1 %, and at 93
 *   deaths 17.68 M still pending simulated vs 17.16 M logged (per unit median
 *   0.01 %, p90 4.7 %) — the simulation errs HIGH by ~3 % in aggregate (the
 *   first reading, amount + absorbed without the missed ticks, made it look
 *   low: 17.66 M vs 18.08 M);
 * - a pool a unit still holds when a round ends can come back with its next
 *   Time Dilation (Solo Shuffle; half of the October first ticks that exceed
 *   their own absorbs match the carried balance exactly), but carrying every
 *   balance fits worse, so when it carries is unresolved — and a hypothetical
 *   press never inherits one.
 *
 * Other deferral shields (Stretch Time, Fel Armor) run other schedules and
 * are not modelled here.
 */
export const TIME_DILATION_ID = "357170";
export const TIME_DILATION_TICK_MS = 1000;
export const TIME_DILATION_TICK_DIVISOR = 8;

/**
 * What a Time Dilation still holds back at `atMs`: the absorbs logged (or
 * assumed) at or before it, less the take-back ticks the rule above lands by
 * then. `absorbs` is one episode, in time order.
 */
export function timeDilationPendingAt(
  absorbs: ReadonlyArray<{ tsMs: number; amount: number }>,
  atMs: number,
): number {
  let pending = 0;
  let tick = 0;
  let fresh = false;
  let next: number | null = null;
  let i = 0;
  for (;;) {
    const ta = i < absorbs.length ? absorbs[i]!.tsMs : null;
    if (next !== null && (ta === null || next < ta) && next <= atMs) {
      if (fresh) {
        tick = pending / TIME_DILATION_TICK_DIVISOR;
        fresh = false;
      }
      pending -= Math.min(tick, pending);
      next = pending > 0 ? next + TIME_DILATION_TICK_MS : null;
    } else if (ta !== null && ta <= atMs) {
      pending += absorbs[i]!.amount;
      fresh = true;
      if (next === null) next = ta + TIME_DILATION_TICK_MS;
      i++;
    } else return pending;
  }
}
