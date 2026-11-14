import type { GladMatch } from "@gladlog/parser";
import { toLegacyMatch } from "@gladlog/parser-compat";

import { openTimed } from "../../openTrace";
import { dropSourceMemo, onSourceMemoUse } from "./sourceMemo";
import type { ReportSource } from "./types";

/** Unit event arrays that convert.ts iterates unconditionally (a trimmed doc or
 * fixture may be missing some of them). */
const UNIT_ARRAYS = [
  "absorbsIn",
  "absorbsOut",
  "actionsIn",
  "actionsOut",
  "advancedSamples",
  "auraEvents",
  "casts",
  "damageIn",
  "damageOut",
  "deaths",
  "healIn",
  "healOut",
  "petCasts",
] as const;

/** A bounded LRU (2) rather than a WeakMap: WeakMap's "entry dies with the key"
 * does not hold in the shuffle case — ShuffleReport keeps strong references to
 * all 6 round objects, so clicking through the rounds accumulates 6 inflated
 * legacy copies (each ≈ 2.5-3× the original round; on a 308MB archive, clicking
 * through every round reaches gigabytes — 2026-07-26 audit) and nothing is freed
 * until the whole doc is replaced. A cap of 2 = "the current round + the one just
 * left", so flipping back and forth does not thrash, and from the 3rd round on
 * the oldest is immediately collectable. */
const CACHE_MAX = 2;
const cache = new Map<ReportSource, ReturnType<typeof toLegacyMatch>>();

// A derive result served from sourceMemo is a use of this source's copy too:
// the two caches share one recency order (see sourceMemo.ts).
onSourceMemoUse((source) => {
  const cached = cache.get(source);
  if (!cached) return;
  cache.delete(source);
  cache.set(source, cached);
});

/**
 * A safe toLegacyMatch: pads missing unit event arrays with empty arrays before
 * converting. Render-test fixtures strip healIn/absorbsIn/actionsIn/Out to keep
 * their size down, and a bare conversion throws outright (which would silently
 * remove every analysis-derived piece of UI in fixture mode). Production docs are
 * complete, so this shim has zero effect there.
 */
export function toLegacySafe(source: ReportSource) {
  const cached = cache.get(source);
  if (cached) {
    // LRU touch: reinsert at the end so the most recently used entry lives longest
    cache.delete(source);
    cache.set(source, cached);
    return cached;
  }
  // timed for the open of THIS source, whoever asks (a report's render, or
  // its raw-stream effect after another report rendered)
  return openTimed(
    "toLegacy",
    () => convert(source),
    true,
    undefined,
    source as object,
  );
}

/** Drop `source`'s legacy copy and everything sourceMemo keeps for it, now
 * rather than when the LRU gets round to it. The off-thread derive worker
 * calls it once it has answered for a source (offThreadDerive.ts), so a
 * second inflated copy of a large match does not sit in the worker. */
export function forgetSource(source: ReportSource): void {
  cache.delete(source);
  dropSourceMemo(source);
}

function convert(source: ReportSource) {
  const units = Object.fromEntries(
    Object.entries(source.units).map(([id, u]) => {
      const padded: Record<string, unknown> = { ...u };
      for (const k of UNIT_ARRAYS) {
        if (!Array.isArray(padded[k])) padded[k] = [];
      }
      return [id, padded];
    }),
  );
  const result = toLegacyMatch({
    ...source,
    units,
    rawLines: [],
  } as unknown as GladMatch);
  cache.set(source, result);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value!;
    cache.delete(oldest);
    // nothing kept for that source may go on pointing into the copy
    dropSourceMemo(oldest);
  }
  return result;
}
