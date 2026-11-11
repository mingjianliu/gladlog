import { analysisDataEpoch } from "../data/ensure";

/**
 * A whole-round reading computed once per round object (T81, first-paint
 * growers). Performance only.
 *
 * The report render and a prompt build ask for the same whole-round facts from
 * several places — `computeOffensiveWindows(enemies, friends, combat)` alone
 * from six (the mistake cards once per friendly, the kick-priority reader, the
 * vulnerability bands, the burst ledger, the dispel dashboard), each a full
 * recomputation: 11.4 s of a 52 s ×12 render. This keeps one result per round
 * object and argument identity.
 *
 * What makes a stored result the one a fresh call would return:
 *  - the key holds the IDENTITY of every unit argument (`unitTokens`), in
 *    order, so a rebuilt unit or the two sides swapped is another entry;
 *  - the fingerprint (`roundFingerprint`) holds the length of every event
 *    array of every unit the reading can reach (the arguments and the round's
 *    own `units`) and the round's bounds, so a round that had events appended
 *    in place (tests do) recomputes — the convention of auraIntervals.ts'
 *    row indexes;
 *  - the fingerprint also holds which lazily loaded tables are in
 *    (`analysisDataEpoch`): before one loads a reading may fall back (talent
 *    cooldown modifiers, replacement abilities), and that result is not the
 *    one to serve once the table is there.
 *
 * Entries live in a WeakMap on the round object and die with it. A caller
 * gets its own array (`slice`), so sorting or filtering a result in place
 * cannot reach another caller; the rows themselves are shared and must be
 * treated as read-only, as they already were between the six callers'
 * shared inputs.
 */
type Entry = { fp: number; value: readonly unknown[] };
const cache = new WeakMap<object, Map<string, Entry>>();

const tokens = new WeakMap<object, number>();
let nextToken = 1;
/** A stable number per object identity. */
function tokenOf(o: object): number {
  let t = tokens.get(o);
  if (t === undefined) {
    t = nextToken++;
    tokens.set(o, t);
  }
  return t;
}

/** The identities of a unit list, in order, as a key part. */
export function unitTokens(units: readonly object[]): string {
  let s = "";
  for (const u of units) s += `${tokenOf(u)},`;
  return s;
}

const mix = (h: number, n: number): number => (Math.imul(h, 31) + n) | 0;

function mixUnit(h: number, u: unknown): number {
  if (u === null || typeof u !== "object") return mix(h, -1);
  h = mix(h, tokenOf(u));
  for (const v of Object.values(u as Record<string, unknown>))
    if (Array.isArray(v)) h = mix(h, v.length);
  return h;
}

/** The shape of everything a whole-round reading can reach: the round's
 * bounds, and per unit (the round's own and every argument list's) its
 * identity and the length of each of its event arrays. */
export function roundFingerprint(
  combat: {
    startTime: number;
    endTime: number;
    units?: Record<string, unknown> | ReadonlyArray<unknown>;
  },
  ...unitLists: ReadonlyArray<readonly unknown[]>
): number {
  let h = mix(mix(17, combat.startTime | 0), combat.endTime | 0);
  h = mix(h, Math.round((combat.endTime - combat.startTime) * 1000) | 0);
  const own = combat.units
    ? Array.isArray(combat.units)
      ? (combat.units as readonly unknown[])
      : Object.values(combat.units)
    : [];
  h = mix(h, own.length);
  for (const u of own) h = mixUnit(h, u);
  for (const list of unitLists) {
    h = mix(h, list.length);
    for (const u of list) h = mixUnit(h, u);
  }
  return h;
}

const unitCache = new WeakMap<object, Map<string, Entry>>();
/**
 * A per-unit reading of the unit's own rows only (its presses, its trinket
 * uses), computed once per unit object: the per-CC readers asked for the
 * whole list again for every control (`ccRemovalCause`). Keyed by the unit's
 * identity; recomputed when its id or the length of any of its event arrays
 * changes. Not gated on the lazy tables: only for readers that use none.
 */
export function unitMemo<T>(
  unit: object,
  key: string,
  compute: () => T[],
): T[] {
  const fp = mix(
    mixUnit(17, unit),
    hashString(String((unit as { id?: unknown }).id)),
  );
  let byKey = unitCache.get(unit);
  const hit = byKey?.get(key);
  if (hit && hit.fp === fp) return (hit.value as readonly T[]).slice();
  const value = compute();
  if (!byKey) {
    byKey = new Map();
    unitCache.set(unit, byKey);
  }
  byKey.set(key, { fp, value });
  return value.slice();
}

function hashString(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = mix(h, s.charCodeAt(i));
  return h;
}

let enabled = true;

export function combatMemo<T>(
  combat: object,
  key: string,
  roundFp: number,
  compute: () => T[],
): T[] {
  if (!enabled) return compute();
  // which lazy tables are loaded is part of what the reading saw
  const fp = mix(roundFp, analysisDataEpoch());
  let byKey = cache.get(combat);
  const hit = byKey?.get(key);
  if (hit && hit.fp === fp) return (hit.value as readonly T[]).slice();
  const value = compute();
  if (!byKey) {
    byKey = new Map();
    cache.set(combat, byKey);
  }
  byKey.set(key, { fp, value });
  return value.slice();
}

/** Test seam: `false` makes every `combatMemo` call compute. */
export function setCombatMemoEnabledForTest(on: boolean): void {
  enabled = on;
}
