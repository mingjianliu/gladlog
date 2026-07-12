export interface SegmentSpan {
  startOffset: number;
  length: number;
}

export type NextAction =
  | { type: "append"; startOffset: number; length: number }
  | { type: "gap"; expected: number; nextAvailable: number }
  | { type: "done" };

/**
 * One overlap-aware reconstruction step. Among segments that cover the current
 * size (startOffset <= currentSize < startOffset+length) pick the one reaching
 * furthest, so each step makes maximal progress and re-flush overlaps self-heal.
 * Segments wholly at/below currentSize are duplicates. If none covers but a
 * later segment exists, that is a gap (wait). The caller MUST advance by the
 * ACTUAL decompressed bytes appended, never by this `length` (a partially
 * synced file can be shorter than its name claims).
 */
export function nextAction(
  currentSize: number,
  segs: SegmentSpan[],
): NextAction {
  let best: SegmentSpan | null = null;
  let nextGap = Infinity;
  for (const s of segs) {
    const end = s.startOffset + s.length;
    if (s.startOffset <= currentSize && currentSize < end) {
      if (!best || end > best.startOffset + best.length) best = s;
    } else if (s.startOffset > currentSize && s.startOffset < nextGap) {
      nextGap = s.startOffset;
    }
  }
  if (best)
    return {
      type: "append",
      startOffset: best.startOffset,
      length: best.length,
    };
  if (nextGap !== Infinity)
    return { type: "gap", expected: currentSize, nextAvailable: nextGap };
  return { type: "done" };
}
