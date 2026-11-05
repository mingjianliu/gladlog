/**
 * resyncBatch.ts — the re-stating batch test (`isResyncBatchAt`) and its
 * sorted-instant helpers: a leaf module (parser-compat only), so a data table
 * can read the batch test without an import cycle (GH #179 batch 3c).
 * `hiddenPress.ts` re-exports every symbol.
 */
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

/** A re-stating batch: at least this many SPELL_AURA_APPLIED rows on the
 * unit in one millisecond (5f4142ec: 30; a press that applies several
 * auras at once — Deep Breath's five — stays under it). */
export const RESYNC_BATCH_MIN_APPLIED = 6;

/** One batch's rows can straddle a millisecond boundary (0284fcd9 r1 0:12:
 * ten rows at .108, five at .109, Tranquility among the second five). */
export const RESYNC_BATCH_SPAN_MS = 5;

/**
 * Is `ms` inside a batch that re-states `unit` after it was unseen —
 * `RESYNC_BATCH_MIN_APPLIED` APPLIED rows on it within
 * `RESYNC_BATCH_SPAN_MS`? An aura row in it is when the log showed the aura
 * again, not when it went up — `hiddenPressMs`' batch reading (codex
 * 20-F19-07: one helper, 0 disagreements with the inline count over 42,510
 * batch evaluations).
 */
export function isResyncBatchAt(
  unit: Pick<ICombatUnit, "id" | "auraEvents">,
  ms: number,
): boolean {
  const rows = unit.auraEvents;
  if (!rows || rows.length < RESYNC_BATCH_MIN_APPLIED) return false;
  // a non-finite instant never satisfies |t − ms| <= span (codex 20-F24-17
  // #1): the index holds the finite rows only
  if (!Number.isFinite(ms)) return false;
  const at = appliedOnSelfMs(rows, unit.id);
  // the index only narrows the rows; each is still read by the scan's own
  // test, so float edges (|0.2 − 5.2| is 5, 5.2 − 5 is not 0.2 — codex
  // 20-F24-17 #3) stay where they were. The 1 ms slack covers them.
  const hi = upperBound(at, ms + RESYNC_BATCH_SPAN_MS + 1);
  let n = 0;
  for (let i = lowerBound(at, ms - RESYNC_BATCH_SPAN_MS - 1); i < hi; i++)
    if (
      Math.abs(at[i]! - ms) <= RESYNC_BATCH_SPAN_MS &&
      ++n >= RESYNC_BATCH_MIN_APPLIED
    )
      return true;
  return false;
}

/** Performance only (the 2026-11-03 first-paint regression: a scan of the
 * whole stream per call made the aura-interval build quadratic — ×12 report
 * fixture, `isResyncBatchAt` 65 → 1,561 ms): the sorted instants of the
 * APPLIED rows on the holder itself (finite ones: no other row can count),
 * cached per stream array and holder.
 * Rebuilt when the array's length changes; a stream is never edited in
 * place at the same length. `test/restatedIndex.test.ts` holds it
 * to the plain scan. */
const appliedOnSelfCache = new WeakMap<
  object,
  { len: number; byId: Map<string, number[]> }
>();
function appliedOnSelfMs(
  rows: NonNullable<ICombatUnit["auraEvents"]>,
  unitId: string,
): number[] {
  let entry = appliedOnSelfCache.get(rows);
  if (!entry || entry.len !== rows.length) {
    entry = { len: rows.length, byId: new Map() };
    appliedOnSelfCache.set(rows, entry);
  }
  let at = entry.byId.get(unitId);
  if (!at) {
    at = [];
    for (const a of rows)
      if (
        a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
        a.destUnitId === unitId &&
        Number.isFinite(a.logLine.timestamp)
      )
        at.push(a.logLine.timestamp);
    at.sort((x, y) => x - y);
    entry.byId.set(unitId, at);
  }
  return at;
}

/** first index whose value is >= x (sorted ascending) */
export function lowerBound(arr: readonly number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** first index whose value is > x (sorted ascending) */
export function upperBound(arr: readonly number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
