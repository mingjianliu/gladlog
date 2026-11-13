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

let onUse: ((source: ReportSource) => void) | undefined;

/** legacySource.ts registers its LRU touch here (a hook, not an import: that
 * module imports this one). */
export function onSourceMemoUse(hook: (source: ReportSource) => void): void {
  onUse = hook;
}

/** Forget everything kept for `source` — called when its legacy copy is
 * evicted, so no result here outlives the copy it may point into. */
export function dropSourceMemo(source: ReportSource): void {
  cache.delete(source);
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
  if (!dataReady) return value;
  // compute() may have evicted this very entry's neighbours; re-read ours
  entry = cache.get(source);
  if (!entry) {
    entry = new Map();
    cache.set(source, entry);
    while (cache.size > SOURCE_MEMO_MAX)
      cache.delete(cache.keys().next().value!);
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

/** Test seam: drop every entry and set the data gate. */
export function resetSourceMemoForTest(ready: boolean): void {
  cache.clear();
  dataReady = ready;
}
