import type { ReportSource } from "./types";

/** Fallback duration (ms) for a cast bar with no matching end event -- arena
 * casts almost never exceed 4s. */
export const CAST_BAR_MAX_MS = 4_000;
/** start->success pairing window (ms): beyond this they are treated as
 * unrelated (disconnect / missing event). */
const PAIR_WINDOW_MS = 12_000;
/** Spell-queue tolerance (ms): the next ability's CAST_START often lands in the
 * log before this cast's SUCCESS (client-side queuing), so a SUCCESS may follow
 * the next start by this much and still count as completing this cast.
 * A/B over 10 user matches on 2026-07-25: 10 falsely-cut bars fixed, 0
 * regressions; the more aggressive variant ("constrain by the next start of the
 * same spell + fall back to same name") fixed 8 but broke 42 (SUCCESSes from
 * proc'd instant casts get mispaired) and was rejected. */
const QUEUE_TOLERANCE_MS = 400;

interface CastBar {
  unitId: string;
  spellId: number;
  spellName: string;
  fromMs: number;
  toMs: number;
  /** completed = closed by a SUCCESS of the same spell; cut = interrupted /
   * cancelled / replaced by another cast (no SUCCESS). */
  outcome: "completed" | "cut";
}

/**
 * Real cast bars (#11b full version, once parser castStarts landed):
 * SPELL_CAST_START is paired with the following events -- a SUCCESS of the same
 * spell = completed; whichever comes first of the next CAST_START (recast after
 * a swap/cancel) or the 4s fallback = cut.
 * Instant casts have no CAST_START and naturally produce no bar. Old archived
 * docs lack the castStarts field -> empty array.
 */
export function deriveCastBars(
  source: ReportSource,
  unitId: string,
): CastBar[] {
  const u = source.units[unitId] as
    | {
        casts?: Array<{ timestamp: number; spellId: number }>;
        castStarts?: Array<{
          timestamp: number;
          spellId: number;
          spellName: string;
        }>;
      }
    | undefined;
  const starts = u?.castStarts ?? [];
  if (starts.length === 0) return [];
  const successes = [...(u?.casts ?? [])].sort(
    (a, b) => a.timestamp - b.timestamp,
  );

  const bars: CastBar[] = [];
  for (let i = 0; i < starts.length; i++) {
    const st = starts[i]!;
    const nextStartT = starts[i + 1]?.timestamp ?? Infinity;
    const success = successes.find(
      (c) =>
        c.spellId === st.spellId &&
        c.timestamp >= st.timestamp &&
        c.timestamp <= st.timestamp + PAIR_WINDOW_MS &&
        c.timestamp <= nextStartT + QUEUE_TOLERANCE_MS,
    );
    // The end of the match ends every cast: the fallback duration for a bar
    // with no SUCCESS must not cross endTime, or the replay's final moment
    // shows a bar that "never finishes" (reported by the user from real use).
    const endMs = (source as { endTime?: number }).endTime ?? Infinity;
    if (st.timestamp >= endMs) continue;
    const cap = Math.min(nextStartT, st.timestamp + CAST_BAR_MAX_MS, endMs);
    bars.push({
      unitId,
      spellId: st.spellId,
      spellName: st.spellName,
      fromMs: st.timestamp,
      toMs: success ? success.timestamp : cap,
      outcome: success ? "completed" : "cut",
    });
  }
  return bars;
}

/** The unit's in-progress cast at playback clock t (null if none). */
export function castBarAt(bars: CastBar[], tMs: number): CastBar | null {
  for (const b of bars) {
    if (tMs >= b.fromMs && tMs <= b.toMs) return b;
  }
  return null;
}
