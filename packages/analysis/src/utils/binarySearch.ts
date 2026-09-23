/**
 * The item of a timestamp-sorted array nearest to `targetTimestamp`.
 *
 * Ties are resolved by a fixed rule, never by which index a bisection happens
 * to visit (GH #100, user ruling 2026-09-23):
 *  1. equal distance on both sides → the EARLIER timestamp;
 *  2. several items at the chosen timestamp → the LAST one in array order.
 *
 * Rule 2 is what the HP / resource samplers mean by "the state at that
 * instant". The advanced log attaches a snapshot to every event line, so one
 * 0.1 ms stamp can carry several — e.g. a DoT tick line at 88 % then a heal
 * line at 90 % — and the game writes lines in the order it processed them.
 * The last line is the state after everything at that instant. The parser
 * keeps line order (records are collected in order, the compat sort is
 * stable), so array order is log order.
 *
 * Before this rule the pick among equals depended on array position: one
 * extra unrelated sample anywhere shifted the bisection path and flipped the
 * rendered HP (3.03 % of player `[STATE]` grid readings on a 57-file slice,
 * spread up to 48 pp — `packages/eval/scripts/hpTieScan.ts`).
 *
 * `arr` must be sorted ascending by `keyFn`.
 */
export function binarySearchClosest<T>(
  arr: T[],
  targetTimestamp: number,
  keyFn: (item: T) => number,
): T | null {
  if (arr.length === 0) {
    return null;
  }

  // First index whose key is >= target.
  let low = 0;
  let high = arr.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (keyFn(arr[mid]) < targetTimestamp) low = mid + 1;
    else high = mid;
  }

  // `low - 1` is already the last item of its timestamp (everything from
  // `low` on is later). `low` is the FIRST of its timestamp, so walk to the
  // last.
  const before = low - 1;
  let after = low;
  if (after < arr.length) {
    const t = keyFn(arr[after]);
    while (after + 1 < arr.length && keyFn(arr[after + 1]) === t) after++;
  }

  if (before < 0) return arr[after];
  if (after >= arr.length) return arr[before];
  const dBefore = targetTimestamp - keyFn(arr[before]);
  const dAfter = keyFn(arr[after]) - targetTimestamp;
  return dAfter < dBefore ? arr[after] : arr[before];
}
