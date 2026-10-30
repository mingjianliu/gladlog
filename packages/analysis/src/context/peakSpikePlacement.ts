import { toRenderSecond } from "../utils/renderGrid";

export type PeakSpikePlacement = "inside" | "runs-past" | "after";

export const PEAK_SPIKE_MARKERS: Record<PeakSpikePlacement, string> = {
  inside: "",
  "runs-past": " (runs past window)",
  after: " (lands after window)",
};

/**
 * Classifies a peak damage spike's placement relative to an offensive window.
 *
 * Both intervals are compared on the **prompt's render grid** (floored to whole
 * seconds, the same rounding `fmtTime` uses), ensuring gate re-parsing of
 * rendered M:SS text yields identical decisions.
 *
 * - `"after"`: spikeFrom >= windowTo (e.g. 1:15–1:35 window with 1:37–1:47 spike)
 * - `"runs-past"`: spikeFrom < windowTo < spikeTo (starts inside, ends after)
 * - `"inside"`: spikeTo <= windowTo (entirely within or ending exactly at window edge)
 *
 * A bucket that prints ONE second (`isPointBucket` — closed in the second it
 * opened) both starts and ends "exactly at the window edge" when that second
 * is the window's last: it is `"inside"`, as `spikeWindowOverlapSeconds`
 * counts it in the window; it is `"after"` only from the next second on.
 */
export function peakSpikePlacement(
  windowToSeconds: number,
  spikeFromSeconds: number,
  spikeToSeconds: number,
): PeakSpikePlacement {
  const wTo = toRenderSecond(windowToSeconds);
  const sFrom = toRenderSecond(spikeFromSeconds);
  const sTo = toRenderSecond(spikeToSeconds);

  if (
    isPointBucket(spikeFromSeconds, spikeToSeconds) ? sFrom > wTo : sFrom >= wTo
  ) {
    return "after";
  }
  if (sTo > wTo) {
    return "runs-past";
  }
  return "inside";
}

export function peakSpikeMarker(placement: PeakSpikePlacement): string {
  return PEAK_SPIKE_MARKERS[placement];
}

/**
 * The clause an `[OFFENSIVE WINDOW]` header carries in place of `peak spike …`
 * when no listed `[DMG SPIKE]` is credited to it. The producer prints it and
 * the gate (`checkOffensiveWindowSpikeCredit`) matches it — one string.
 */
export const NO_CREDITED_SPIKE_CLAUSE = "no listed [DMG SPIKE] credited to it";

/**
 * Whether a `[DMG SPIKE]` bucket prints one second — both ends on the same
 * render second (`0:45–0:45`). A bucket closes at its victim's death or at the
 * round's end (`selectPressureWindows`, T12 ① c), so one that OPENED in that
 * second has no displayed length: the hits that killed the unit, or the last
 * ones of the round.
 */
export function isPointBucket(
  spikeFromSeconds: number,
  spikeToSeconds: number,
): boolean {
  return toRenderSecond(spikeToSeconds) <= toRenderSecond(spikeFromSeconds);
}

/**
 * How many **displayed** seconds a spike's bucket and an offensive window
 * share: both intervals floored onto the render grid first (the rounding
 * `fmtTime` prints), so the gate's re-parse of the two `M:SS–M:SS` pairs gives
 * the same number. Open at the far end, like `peakSpikePlacement`'s "after": a
 * spike that starts in the second the window ends shares nothing with it.
 *
 * A bucket that prints one second (`isPointBucket`) has no length to share
 * and would overlap nothing — not even the window it sits in the middle of
 * (post-hoc review 45-FT-98, finding 4). It is counted as that one second, in
 * every window whose printed span holds it, BOTH ends included: `0:45–0:45`
 * is in `0:40–0:45`. The far end is closed for it because that is where such
 * a bucket is — it closed at the round's end or its victim's death, and a
 * header cut at the round's end prints that same second as its own end; left
 * open, no window of a Solo Shuffle round could ever hold one.
 */
export function spikeWindowOverlapSeconds(
  windowFromSeconds: number,
  windowToSeconds: number,
  spikeFromSeconds: number,
  spikeToSeconds: number,
): number {
  const wFrom = toRenderSecond(windowFromSeconds);
  const wTo = toRenderSecond(windowToSeconds);
  const sFrom = toRenderSecond(spikeFromSeconds);
  if (isPointBucket(spikeFromSeconds, spikeToSeconds))
    return wFrom <= sFrom && sFrom <= wTo ? 1 : 0;
  const from = Math.max(wFrom, sFrom);
  const to = Math.min(wTo, toRenderSecond(spikeToSeconds));
  return Math.max(0, to - from);
}

interface CreditSpan {
  fromSeconds: number;
  toSeconds: number;
}

/**
 * Which offensive window each damage spike is credited to (T12 ③, user ruling
 * 2026-10-10): `result[s]` is an index into `windows`, or -1.
 *
 * - A spike is credited only to a window its bucket overlaps
 *   (`spikeWindowOverlapSeconds` > 0). The rule this replaces took any spike
 *   that *started* within 5 s of the window, so a window was handed the next
 *   window's damage (539b6ed0: Combustion's 0:32–0:54 named the 1.90M of
 *   0:57–1:07, which was Deathmark + Kingsbane's; its own 1.66M at 0:37–0:47
 *   went unnamed).
 * - One spike, one window: the one it overlaps longest; on a tie the window
 *   that starts first, then the one listed first. No threshold — the longest
 *   overlap is a comparison between the candidates, not against a constant.
 * - A bucket that prints one second (`isPointBucket`) is one second in every
 *   window whose printed span holds it — so among them it goes, by the same
 *   tie rule, to the one that starts first.
 *
 * Used by the `[OFFENSIVE WINDOW]` renderer (`emitOffensiveWindowEntries`)
 * and re-run by the gate on the rendered headers and `[DMG SPIKE]` lines.
 */
export function creditSpikesToWindows(
  windows: ReadonlyArray<CreditSpan>,
  spikes: ReadonlyArray<CreditSpan>,
): number[] {
  return spikes.map((spike) => {
    let best = -1;
    let bestOverlap = 0;
    windows.forEach((w, i) => {
      const overlap = spikeWindowOverlapSeconds(
        w.fromSeconds,
        w.toSeconds,
        spike.fromSeconds,
        spike.toSeconds,
      );
      if (overlap <= 0) return;
      const earlier =
        best >= 0 &&
        toRenderSecond(w.fromSeconds) <
          toRenderSecond(windows[best]!.fromSeconds);
      if (overlap > bestOverlap || (overlap === bestOverlap && earlier)) {
        best = i;
        bestOverlap = overlap;
      }
    });
    return best;
  });
}
