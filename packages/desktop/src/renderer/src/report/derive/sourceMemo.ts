import { ensureAnalysisData } from "@gladlog/analysis";

import type { ReportSource } from "./types";

/**
 * Whole-match derive results, kept across component mounts (T80).
 *
 * Every derive hook in the report is a `useMemo(..., [source])`, which dies
 * with the component: leaving the matches page for another top tab and coming
 * back remounts MatchReport and re-runs the whole analysis layer over a match
 * object that never changed (measured on a 1,100-match library: 0.55-1.4 s per
 * return, 1.1 s of it inside these derives; the AI tab and a shuffle round
 * visited before pay the same again). The results are a pure function of the
 * source object, so they are kept here by source identity instead.
 *
 * Bounded like toLegacySafe's cache and for the same reason (see
 * legacySource.ts): a derive result may hold references into the inflated
 * legacy copy, so an entry that outlived that cache would pin gigabytes on a
 * large shuffle. The cap is the same 2 sources — "this round + the one just
 * left" — and the two caches are kept on one recency order rather than two
 * that can drift: a hit here counts as a use of the source's legacy copy
 * (`onSourceMemoUse`), and legacySource.ts drops a source's entry here the
 * moment it evicts that source's copy (`dropSourceMemo`). Without that, a
 * round served from this cache alone ages out of the other one and its
 * results keep a third inflated copy alive (codex 85-tk-I-T80-1).
 *
 * Nothing is stored before the lazily loaded analysis tables are in: until
 * then a display path may fall back (spell names, talent modifiers) and is
 * expected to heal on a later mount, which a stored fallback would prevent.
 */
export const SOURCE_MEMO_MAX = 2;
const cache = new Map<ReportSource, Map<string, unknown>>();

let dataReady = false;
void ensureAnalysisData().then(
  () => {
    dataReady = true;
  },
  () => {
    /* never ready: every call computes, as before */
  },
);

/** Whether results may be kept yet (the analysis tables are loaded) — the
 * gate idMemo.ts shares. */
export function sourceMemoReady(): boolean {
  return dataReady;
}

let onUse: ((source: ReportSource) => void) | undefined;

/** legacySource.ts registers its LRU touch here (a hook, not an import: that
 * module imports this one). */
export function onSourceMemoUse(hook: (source: ReportSource) => void): void {
  onUse = hook;
}

/** Forget everything kept for `source` — called when its legacy copy is
 * evicted, so no result here outlives the copy it may point into. */
export function dropSourceMemo(source: ReportSource): void {
  evict(source);
}

/** Sources whose entry was thrown away since their fill began. An entry
 * started again after that (a worker reply filed late, the fill's later
 * steps) holds only what came after the eviction: the fill's earlier results
 * live on in the component's own memo and are not in it (pipeline T199-2). */
let evictedInFill = new WeakSet<ReportSource>();

function evict(source: ReportSource): void {
  if (cache.delete(source)) evictedInFill.add(source);
}

const FILLED = "\u0000filled";

/** Keys computed for a source since its fill began whose result was NOT kept
 * (the analysis tables were not loaded yet). A fill that has one did not
 * leave a complete entry behind, whatever was stored after the tables came
 * in mid-fill (pipeline T199). */
let unkept = new WeakMap<ReportSource, Set<string>>();

/** A staged fill of `source` starts: what earlier renders failed to keep is
 * its to compute again. */
export function beginSourceFill(source: ReportSource): void {
  unkept.delete(source);
  evictedInFill.delete(source);
}

/** MatchReport's staged fill (T93) has run every step for `source` and all
 * the report view's whole-match derive results are in the entry. The mark
 * lives IN the entry: evicting the source drops it with the results, and an
 * entry begun again by a later, unfinished fill does not carry it (codex
 * 85-tk-G-T93-1g: a marker kept outside survived the eviction, and a refill
 * abandoned at step 1 left a partial entry that read as complete). No entry
 * (the analysis tables not loaded yet, so nothing is stored), no mark.
 *
 * It is set only for a fill that left every result it computed in the entry
 * (T199; until then it was "every step has run"):
 *  - a result computed before the tables were loaded is not kept, so a fill
 *    the tables arrived in the middle of has the later steps' results and
 *    not the earlier ones' — not marked (`unkept`); the next mount fills in
 *    steps again and is marked then;
 *  - an entry evicted while its fill was running and started again by what
 *    came later has the later results only — not marked (`evictedInFill`).
 *    Measured path (codex 80-PIPE-122): a shuffle read as one document,
 *    rounds A -> B -> C visited before the worker answered; A's and B's
 *    late replies evict C, C's reply starts its entry again, steps 3-4
 *    finish, and the mark made the next visit of C compute steps 1-2 in one
 *    render;
 *  - a render under a time range computes its ranged derives outside this
 *    cache, so their whole-match entries are absent — the caller does not
 *    mark while a range is selected (MatchReport).
 * What it does not cover, by design: derives only another view asks for
 * (the AI tab's prompt input, the replay's). A one-pass render of the report
 * view does not ask for them either. */
export function markSourceFilled(source: ReportSource): void {
  if ((unkept.get(source)?.size ?? 0) > 0) return;
  if (evictedInFill.has(source)) return;
  cache.get(source)?.set(FILLED, true);
}

/** Whether `source`'s entry is still the one a completed fill left. A peek:
 * no recency touch. */
export function isSourceFilled(source: ReportSource): boolean {
  return cache.get(source)?.has(FILLED) === true;
}

export function sourceMemo<T>(
  source: ReportSource,
  key: string,
  compute: () => T,
): T {
  let entry = cache.get(source);
  if (entry) {
    // LRU touch, here and on the source's legacy copy
    cache.delete(source);
    cache.set(source, entry);
    onUse?.(source);
    if (entry.has(key)) return entry.get(key) as T;
  }
  const value = compute();
  if (!dataReady) {
    let missed = unkept.get(source);
    if (!missed) unkept.set(source, (missed = new Set()));
    missed.add(key);
    return value;
  }
  unkept.get(source)?.delete(key);
  // compute() may have evicted this very entry's neighbours; re-read ours
  entry = cache.get(source);
  if (!entry) {
    entry = new Map();
    cache.set(source, entry);
    while (cache.size > SOURCE_MEMO_MAX) evict(cache.keys().next().value!);
  }
  entry.set(key, value);
  return value;
}

/**
 * sourceMemo for a derive with inputs besides the source object (the raw
 * streams, which arrive asynchronously; a duration; an anchor list). One slot
 * per key: a call whose `inputs` differ element-wise (Object.is) from the
 * stored ones recomputes and replaces it.
 */
export function sourceMemoWith<T>(
  source: ReportSource,
  key: string,
  inputs: readonly unknown[],
  compute: () => T,
): T {
  const slot = sourceMemo<{ inputs: readonly unknown[]; value: T }>(
    source,
    key,
    () => ({ inputs, value: compute() }),
  );
  const same =
    slot.inputs.length === inputs.length &&
    slot.inputs.every((v, i) => Object.is(v, inputs[i]));
  if (!same) {
    slot.inputs = inputs;
    slot.value = compute();
  }
  return slot.value;
}

/** Whether `source` already has a value under `key` (no recency touch). */
export function sourceMemoHas(source: ReportSource, key: string): boolean {
  return cache.get(source)?.has(key) === true;
}

/** The value sourceMemoWith(source, key, inputs, ...) would return without
 * computing, or undefined when that slot is absent or built against other
 * inputs. A peek: no recency touch. */
export function sourceMemoWithPeek<T>(
  source: ReportSource,
  key: string,
  inputs: readonly unknown[],
): T | undefined {
  const slot = cache.get(source)?.get(key) as
    { inputs: readonly unknown[]; value: T } | undefined;
  if (!slot) return undefined;
  const same =
    slot.inputs.length === inputs.length &&
    slot.inputs.every((v, i) => Object.is(v, inputs[i]));
  return same ? slot.value : undefined;
}

/** File a value computed elsewhere (offThreadDerive.ts: the same function,
 * run off the main thread) as what sourceMemo(source, key, ...) would have
 * computed — same data gate and same bound as a computed one. */
export function sourceMemoPut<T>(
  source: ReportSource,
  key: string,
  value: T,
): void {
  sourceMemo(source, key, () => value);
}

/** sourceMemoPut for a sourceMemoWith slot. */
export function sourceMemoWithPut<T>(
  source: ReportSource,
  key: string,
  inputs: readonly unknown[],
  value: T,
): void {
  sourceMemoWith(source, key, inputs, () => value);
}

/** Test seam: drop every entry and set the data gate. */
export function resetSourceMemoForTest(ready: boolean): void {
  cache.clear();
  unkept = new WeakMap();
  evictedInFill = new WeakSet();
  dataReady = ready;
}

/** Test seam: flip the data gate only — the tables arriving in the middle of
 * a fill (entries and the fill's bookkeeping stay). */
export function setSourceMemoReadyForTest(ready: boolean): void {
  dataReady = ready;
}
