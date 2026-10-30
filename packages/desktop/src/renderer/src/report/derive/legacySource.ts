import type { GladMatch } from "@gladlog/parser";
import { toLegacyMatch } from "@gladlog/parser-compat";

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
  }
  return result;
}
