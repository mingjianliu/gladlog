export type NextAction =
  | { type: "append"; startOffset: number }
  | { type: "gap"; expected: number; nextAvailable: number }
  | { type: "done" };

/**
 * One step of byte-exact reconstruction: the only appendable segment is the
 * one starting exactly at the current reconstructed size. Anything earlier is
 * an already-applied duplicate; anything later means a segment is missing and
 * appending would corrupt the log — surface it as a gap instead.
 */
export function nextAction(
  currentSize: number,
  availableOffsets: number[],
): NextAction {
  const candidates = [...new Set(availableOffsets)]
    .filter((o) => o >= currentSize)
    .sort((a, b) => a - b);
  if (candidates.length === 0) return { type: "done" };
  if (candidates[0] === currentSize)
    return { type: "append", startOffset: currentSize };
  return { type: "gap", expected: currentSize, nextAvailable: candidates[0] };
}
