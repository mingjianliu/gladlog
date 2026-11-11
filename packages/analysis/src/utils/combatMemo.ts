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

/**
 * The inputs a kept reading sees that are neither the round nor an argument:
 * the mutable flag singletons a harness or a test flips between two readings
 * of one round object (`OFFENSIVE_AURA_FLAGS.demonic` changes the enemy
 * cooldown timeline). A flag module registers its own reader next to the
 * object; the value is part of every `combatMemo` / `roundValue` fingerprint,
 * with which lazy tables are loaded.
 */
const memoInputs = new Map<string, () => string>();
export function registerMemoInput(name: string, read: () => string): void {
  memoInputs.set(name, read);
}
/** The registered inputs' names (tests: every flag singleton is one). */
export function memoInputNames(): string[] {
  return [...memoInputs.keys()];
}
function inputsEpoch(): number {
  let h = analysisDataEpoch();
  for (const read of memoInputs.values()) h = mix(h, hashString(read()));
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
  const fp = mix(roundFp, inputsEpoch());
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

const values = new WeakMap<
  object,
  Map<string, { fp: number; value: unknown }>
>();
let freezeShared =
  typeof process !== "undefined" && process.env?.GLADLOG_MEMO_FREEZE === "1";

/** Freeze a result's own arrays and plain objects, all the way down. */
function deepFreeze(v: unknown, seen = new Set<object>()): void {
  if (v === null || typeof v !== "object" || seen.has(v)) return;
  const proto = Object.getPrototypeOf(v) as unknown;
  if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) return;
  seen.add(v);
  for (const child of Object.values(v)) deepFreeze(child, seen);
  Object.freeze(v);
}

/**
 * A whole-round reading that is ONE object (a summary, a timeline, a holder
 * of several readings), computed once per round object and key. Unlike
 * `combatMemo` the SAME object comes back to every asker, so its rows are
 * read-only by contract: no asker may write to, sort or splice what it gets.
 *
 * That contract is checked, not assumed: with `setSharedReadingsFrozenForTest`
 * (or `GLADLOG_MEMO_FREEZE=1`) every stored result is frozen all the way
 * down, and a writer throws a TypeError — the real-fixture test and the
 * byte-identity capture run that way.
 *
 * The caller's key must hold the identity of every unit argument and every
 * option; `roundFp` is `roundFingerprint` over the same units, mixed with
 * any other input's shape. And the reading must have no side effect, since
 * it runs once for all its askers: the ones kept so far write no decision
 * trace (`traceDecision` is called by the candidate builders only).
 */
export function roundValue<T extends object>(
  combat: object,
  key: string,
  roundFp: number,
  compute: () => T,
): T {
  if (!enabled) return compute();
  const fp = mix(roundFp, inputsEpoch());
  let byKey = values.get(combat);
  const hit = byKey?.get(key);
  if (hit && hit.fp === fp) return hit.value as T;
  const value = compute();
  if (freezeShared) deepFreeze(value);
  if (!byKey) {
    byKey = new Map();
    values.set(combat, byKey);
  }
  byKey.set(key, { fp, value });
  return value;
}

/** Test seam: freeze every `roundValue` result stored from now on. */
export function setSharedReadingsFrozenForTest(on: boolean): void {
  freezeShared = on;
}

/** A stable number for one object argument (0 for none), as a key part. */
export function identityToken(o: object | null | undefined): number {
  return o ? tokenOf(o) : 0;
}

/** `h` mixed with `n` — for a caller adding another input's shape to a
 * `roundFingerprint`. */
export function mixFingerprint(h: number, n: number): number {
  return mix(h, n);
}

/** `h` mixed with a string input (a zone id, a bracket). */
export function mixFingerprintString(h: number, s: string | undefined): number {
  return mix(h, s === undefined ? -1 : hashString(s));
}

/** A thunk that runs `f` once and afterwards returns the same value — or
 * throws the same error: a reading that failed fails for every later asker,
 * as it did when each asker computed it. */
export function once<T>(f: () => T): () => T {
  let state = 0;
  let value: T | undefined;
  let error: unknown;
  return () => {
    if (state === 0) {
      try {
        value = f();
        state = 1;
      } catch (e) {
        error = e;
        state = 2;
      }
    }
    if (state === 2) throw error;
    return value as T;
  };
}

/** Test seam: `false` makes every `combatMemo` / `roundValue` call compute. */
export function setCombatMemoEnabledForTest(on: boolean): void {
  enabled = on;
}
