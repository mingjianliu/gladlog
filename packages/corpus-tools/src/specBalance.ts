// Spec balancing for the daily pull (user request 2026-11-02): the 2100+ feed
// is dominated by a few recorder specs (on 11-02 the patch's 920 stored
// downloads held 111 Restoration Druid and 96 Discipline Priest recordings,
// but 5 Demonology and 7 Survival), so taking the feed in order keeps
// re-sampling the same viewpoints. Balancing reads a small pool of candidates
// and takes the recorder specs we hold least of first.
//
// Pure functions only; fetchPvpLogs.ts reads the manifests and the feed.
import { CombatUnitSpec } from "@gladlog/parser-compat";

import type { DetailedMatchStub } from "./feedClient";
import type { ManifestEntry } from "./pvpLogFetch";

/**
 * Tank recorders go last rather than first. Every tank sits near zero in the
 * stored counts, so a plain fewest-first order would spend the quota on them;
 * the user ruled them not worth chasing ("没人玩", 2026-11-02). They are still
 * taken when the pool has nothing else left.
 */
export const DEPRIORITISED_SPECS: ReadonlySet<string> = new Set([
  CombatUnitSpec.DeathKnight_Blood,
  CombatUnitSpec.DemonHunter_Vengeance,
  CombatUnitSpec.Druid_Guardian,
  CombatUnitSpec.Monk_Brewmaster,
  CombatUnitSpec.Paladin_Protection,
  CombatUnitSpec.Warrior_Protection,
]);

/** Recorder spec of a stub, or "" when the recorder is not among its units. */
export function recorderSpecOf(stub: DetailedMatchStub): string {
  return stub.units.find((u) => u.id === stub.playerId)?.spec ?? "";
}

/**
 * How many stored downloads each recorder spec has since `sinceMs` (the
 * current patch's go-live). The manifests outlive their log files (old files
 * are archived to Drive and deleted locally), so this counts what was ever
 * taken, not what is on disk. A shuffle object is one entry: one quota unit,
 * one recorder.
 */
export function storedRecorderSpecCounts(
  entries: Iterable<ManifestEntry>,
  sinceMs: number,
): Map<string, number> {
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const e of entries) {
    if (e.startTime < sinceMs) continue;
    // The same log object can sit in two manifests (a targeted pull and the
    // daily one); count it once.
    if (seen.has(e.logObjectUrl)) continue;
    seen.add(e.logObjectUrl);
    const spec = e.recorder?.spec;
    if (!spec) continue;
    counts.set(spec, (counts.get(spec) ?? 0) + 1);
  }
  return counts;
}

/**
 * Order a candidate pool so the fewest-held recorder spec comes first,
 * counting each pick as it is made: two Demonology candidates do not both jump
 * ahead of a Fury one when Fury is only one behind. Ties keep feed order
 * (newest first). Deprioritised specs follow every other candidate, in the
 * same fewest-first order among themselves.
 *
 * The whole pool is ordered, not just the first `limit`, so a download that
 * fails its completeness check simply falls through to the next candidate.
 */
export function orderBySpecBalance(
  pool: DetailedMatchStub[],
  stored: ReadonlyMap<string, number>,
  deprioritised: ReadonlySet<string> = DEPRIORITISED_SPECS,
): DetailedMatchStub[] {
  const counts = new Map(stored);
  const left = pool.map((stub, i) => ({ stub, i, spec: recorderSpecOf(stub) }));
  const out: DetailedMatchStub[] = [];
  while (left.length > 0) {
    let best = 0;
    for (let k = 1; k < left.length; k++) {
      if (better(left[k], left[best])) best = k;
    }
    const [pick] = left.splice(best, 1);
    out.push(pick.stub);
    counts.set(pick.spec, (counts.get(pick.spec) ?? 0) + 1);
  }
  return out;

  function better(
    a: { i: number; spec: string },
    b: { i: number; spec: string },
  ): boolean {
    const da = deprioritised.has(a.spec) ? 1 : 0;
    const db = deprioritised.has(b.spec) ? 1 : 0;
    if (da !== db) return da < db;
    const ca = counts.get(a.spec) ?? 0;
    const cb = counts.get(b.spec) ?? 0;
    if (ca !== cb) return ca < cb;
    return a.i < b.i;
  }
}
