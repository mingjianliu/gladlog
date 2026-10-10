import { buildDampeningEvents, getInitialDampening } from "@gladlog/analysis";

import { toLegacySafe } from "./legacySource";
import type { ReportSource } from "./types";

/**
 * Dampening series on a 1s grid (backlog #11a). This has a LIVE consumer: the
 * replay page's "衰减 N%" scrub readout in ReplayView (via dampeningAt), so the
 * values here must be exact at the event timestamps — no rounding or grid
 * error.
 *
 * An earlier version (#10 T2, first cut) wrongly used
 * computeDampeningTimeline's 30s change-point sampling as the implementation —
 * that is sparse sampling designed for the AI text context summary, and reusing
 * it here coarsened the replay's live dampening readout onto a 30s grid. That
 * was a real regression and has been reverted.
 *
 * The right approach: consume buildDampeningEvents directly (the same event
 * table getDampeningPercentage uses — single-source predicate) plus
 * getInitialDampening (the same initial-value rule, rather than a second copy
 * of the rule table), then forward-fill the already-sorted event table into one
 * point per second with a monotonic pointer — the table is built exactly once
 * (O(events)), so the whole thing is O(events + seconds) instead of the old
 * implementation's O(events × seconds) ("call getDampeningPercentage every
 * second, and have that function rebuild buildDampeningEvents internally").
 *
 * For the final second (tS === durationS) the query boundary is the exact
 * legacy.endTime rather than startTime + durationS*1000: durationS is floored
 * to whole seconds, so a match can end with a <1s remainder, and a dampening
 * change inside that remainder (e.g. a dose triggering just before the end)
 * would be missed on a whole-second boundary. Using the exact endTime
 * guarantees this last cell reflects the true value at the moment the match
 * ended.
 *
 * The series starts where a value is first known. getInitialDampening states
 * one from 0:00 in 3v3 / Solo Shuffle; in 2v2 it states none (null) before the
 * round's first logged stack — the prompt prints no number there either
 * (FT-T13 D11) — so a 2v2 series has no point before that second, and is
 * empty when the log printed no stack at all. Seconds stay contiguous from the
 * first point on.
 */
export function deriveDampeningSeries(
  source: ReportSource,
): Array<{ tS: number; pct: number }> {
  try {
    const legacy = toLegacySafe(source);
    const players = Object.values(legacy.units).filter((u) => u.info);
    if (players.length === 0) return [];
    const bracket = (source as { bracket?: string }).bracket ?? "3v3";
    const durationS = Math.max(
      1,
      Math.floor((legacy.endTime - legacy.startTime) / 1000),
    );
    const events = buildDampeningEvents(players); // sorted event table, built once
    const fallback = getInitialDampening(bracket, players);
    const out: Array<{ tS: number; pct: number }> = [];
    let idx = 0;
    let cur = fallback;
    for (let s = 0; s <= durationS; s++) {
      const boundary =
        s === durationS ? legacy.endTime : legacy.startTime + s * 1000;
      while (idx < events.length && events[idx]!.timestamp <= boundary) {
        cur = events[idx]!.stacks;
        idx++;
      }
      if (cur !== null) out.push({ tS: s, pct: cur });
    }
    return out;
  } catch {
    return [];
  }
}

/** The current dampening at the playback clock (the latest sample at or before
 *  t) — null before the series' first point (a 2v2 round before its first
 *  logged stack), where no value is known. */
export function dampeningAt(
  series: Array<{ tS: number; pct: number }>,
  tS: number,
): number | null {
  if (series.length === 0) return null;
  if (series[0]!.tS > 0 && tS < series[0]!.tS) return null;
  let cur = series[0]!.pct;
  for (const p of series) {
    if (p.tS > tS) break;
    cur = p.pct;
  }
  return cur;
}
