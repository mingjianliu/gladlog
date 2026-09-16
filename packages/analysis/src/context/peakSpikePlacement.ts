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
 */
export function peakSpikePlacement(
  windowToSeconds: number,
  spikeFromSeconds: number,
  spikeToSeconds: number,
): PeakSpikePlacement {
  const wTo = toRenderSecond(windowToSeconds);
  const sFrom = toRenderSecond(spikeFromSeconds);
  const sTo = toRenderSecond(spikeToSeconds);

  if (sFrom >= wTo) {
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
