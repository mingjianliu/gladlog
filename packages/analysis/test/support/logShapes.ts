/**
 * The log-shape matrix: the ways a real combat log differs from the clean one
 * a test author imagines, as mutations of a synthetic scenario. A predicate
 * declares an invariant and runs it on the scenario and on every shape it
 * must be indifferent to (or bounded under).
 *
 * Why it exists (weekly review 2026-10-24): of 299 fixes over three weeks
 * none was caught by a unit test, 86 % of the fixed functions already had a
 * direct test, and the same few log facts — a lost REMOVED, a same-ms
 * re-broadcast, pet damage folded into the owner, the Solo Shuffle round end
 * — were re-learned predicate by predicate. Each was known after its first
 * incident; nothing made the next predicate meet it. This file is that
 * knowledge in executable form; a new quirk joins the list once and every
 * matrix test meets it.
 *
 * Frequencies measured on the public wowarenalogs testlogs (13 arena logs,
 * 40 rounds, 2024–2025; read at runtime, not committed — DATA-COMPLIANCE §4):
 *  - lostRemoved: 545 of 8,043 player aura applications (6.8 %) never closed
 *    inside the round (the auraIntervals cap's own note: 11.0 % on the
 *    227-file archive);
 *  - rebroadcast: 102 same-ms REMOVED → APPLIED pairs of one aura;
 *  - fractionalMs: 7,036 of 120,160 rows (5.9 %) carry a 4-decimal stamp;
 *  - petDamage: 12,600 of 39,765 player damageOut rows (32 %) are a pet's or
 *    guardian's, folded into the owner by parser-compat;
 *  - dotTicks: 5,591 rows (14 %) periodic;
 *  - castRowLag: aura → own cast row p99 13 ms, max 16 ms here; 150 ms on the
 *    605-file corpus (`AURA_BEFORE_CAST_ROW_MAX_MS`);
 *  - sameMsReverse: rows of one ms come in log order, which a test's
 *    construction order need not match.
 */
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

type Row = {
  timestamp: number;
  spellId?: string | null;
  srcUnitId?: string;
  destUnitId?: string;
  logLine: { event: string; timestamp: number; lineIndex?: number };
  [k: string]: unknown;
};

export interface LogShape {
  name: string;
  apply(units: ICombatUnit[]): ICombatUnit[];
}

const STREAMS = [
  "auraEvents",
  "spellCastEvents",
  "damageIn",
  "damageOut",
  "healIn",
  "healOut",
  "absorbsIn",
  "absorbsOut",
  "actionIn",
  "actionOut",
  "advancedActions",
] as const;

function clone(units: ICombatUnit[]): ICombatUnit[] {
  return structuredClone(units);
}
const rows = (u: ICombatUnit, k: (typeof STREAMS)[number]): Row[] =>
  ((u as unknown as Record<string, Row[] | undefined>)[k] ??= []);
const sortRows = (r: Row[]) => r.sort((a, b) => a.timestamp - b.timestamp);
const at = (row: Row, ms: number): Row => ({
  ...row,
  timestamp: ms,
  logLine: { ...row.logLine, timestamp: ms },
});

/** Every SPELL_AURA_REMOVED of the given ids (all when omitted) is gone —
 * the log lost the line, or the unit left the recorder's sight. */
export const lostRemoved = (ids?: readonly string[]): LogShape => ({
  name: `lostRemoved${ids ? `(${ids.join(",")})` : ""}`,
  apply(units) {
    const out = clone(units);
    for (const u of out)
      (u as unknown as { auraEvents: Row[] }).auraEvents = rows(
        u,
        "auraEvents",
      ).filter(
        (a) =>
          a.logLine.event !== LogEvent.SPELL_AURA_REMOVED ||
          (ids !== undefined && !ids.includes(String(a.spellId))),
      );
    return out;
  },
});

/** Each closed aura is re-broadcast once mid-run: a REMOVED and an APPLIED
 * of it in the same ms — one aura, not two. */
export const rebroadcast: LogShape = {
  name: "rebroadcast",
  apply(units) {
    const out = clone(units);
    for (const u of out) {
      const aur = rows(u, "auraEvents");
      const add: Row[] = [];
      for (const a of aur) {
        if (a.logLine.event !== LogEvent.SPELL_AURA_APPLIED) continue;
        const close = aur.find(
          (r) =>
            r.logLine.event === LogEvent.SPELL_AURA_REMOVED &&
            r.spellId === a.spellId &&
            r.srcUnitId === a.srcUnitId &&
            r.timestamp > a.timestamp,
        );
        if (!close) continue;
        const mid = Math.round((a.timestamp + close.timestamp) / 2);
        const removed = at(close, mid);
        const reapplied = at(a, mid);
        add.push(removed, reapplied);
      }
      aur.push(...add);
      sortRows(aur);
    }
    return out;
  },
};

/** Every stamp moves by a fraction of a millisecond (4-decimal logs). */
export const fractionalMs: LogShape = {
  name: "fractionalMs",
  apply(units) {
    const out = clone(units);
    for (const u of out)
      for (const k of STREAMS)
        for (const r of rows(u, k)) {
          r.timestamp += 0.4;
          r.logLine.timestamp += 0.4;
        }
    return out;
  },
};

/** A pet of each unit that deals damage hits the same targets, folded into
 * the owner's damageOut as parser-compat folds it (srcUnitId = the pet). */
export const petDamage: LogShape = {
  name: "petDamage",
  apply(units) {
    const out = clone(units);
    for (const u of out) {
      const dmg = rows(u, "damageOut");
      const pet = `Pet-0-${u.id}`;
      const hits: Row[] = dmg.map((d) => ({
        ...at(d, d.timestamp - 300),
        srcUnitId: pet,
        srcUnitName: "Pet",
      }));
      // and one 0.3 s after every self-applied aura goes up (a pet keeps
      // attacking through its owner's invisibility)
      for (const a of rows(u, "auraEvents"))
        if (
          a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
          a.srcUnitId === u.id
        ) {
          const target =
            dmg[0]?.destUnitId ?? units.find((x) => x.id !== u.id)?.id ?? "x";
          hits.push({
            timestamp: a.timestamp + 300,
            spellId: "16827",
            spellName: "Claw",
            srcUnitId: pet,
            srcUnitName: "Pet",
            destUnitId: target,
            destUnitName: target,
            amount: -10_000,
            effectiveAmount: -10_000,
            logLine: {
              event: LogEvent.SPELL_DAMAGE,
              timestamp: a.timestamp + 300,
              parameters: [],
            },
          } as Row);
        }
      dmg.push(...hits);
      sortRows(dmg);
    }
    return out;
  },
};

/** The unit's damage keeps ticking as periodic rows every second after each
 * of its own hits (a DoT runs on through whatever the unit does). */
export const dotTicks: LogShape = {
  name: "dotTicks",
  apply(units) {
    const out = clone(units);
    for (const u of out) {
      const dmg = rows(u, "damageOut");
      const ticks: Row[] = [];
      for (const d of dmg.filter((x) => x.srcUnitId === u.id))
        for (let i = 1; i <= 8; i++)
          ticks.push({
            ...at(d, d.timestamp + i * 1000),
            spellId: "980",
            spellName: "Agony",
            amount: -2_000,
            effectiveAmount: -2_000,
            logLine: {
              ...d.logLine,
              event: LogEvent.SPELL_PERIODIC_DAMAGE,
              timestamp: d.timestamp + i * 1000,
            },
          });
      dmg.push(...ticks);
      sortRows(dmg);
    }
    return out;
  },
};

/** Each successful cast row is logged `lagMs` after its own aura went up —
 * the aura-before-cast lag (max 150 ms on the corpus). */
export const castRowLag = (lagMs = 120): LogShape => ({
  name: `castRowLag(${lagMs})`,
  apply(units) {
    const out = clone(units);
    for (const u of out) {
      const casts = rows(u, "spellCastEvents");
      for (let i = 0; i < casts.length; i++)
        if (casts[i]!.logLine.event === LogEvent.SPELL_CAST_SUCCESS)
          casts[i] = at(casts[i]!, casts[i]!.timestamp + lagMs);
      sortRows(casts);
    }
    return out;
  },
});

/** The log order inside each millisecond is the reverse of the order the
 * scenario was built in. */
export const sameMsReverse: LogShape = {
  name: "sameMsReverse",
  apply(units) {
    const out = clone(units);
    for (const u of out)
      for (const k of STREAMS) {
        const r = rows(u, k);
        const byMs = new Map<number, Row[]>();
        for (const x of r)
          byMs.set(x.timestamp, [...(byMs.get(x.timestamp) ?? []), x]);
        const reordered: Row[] = [];
        for (const ms of [...byMs.keys()].sort((a, b) => a - b))
          reordered.push(...byMs.get(ms)!.reverse());
        reordered.forEach((x, i) => {
          x.logLine.lineIndex = 1_000_000 + i;
        });
        r.splice(0, r.length, ...reordered);
      }
    return out;
  },
};

/** The shapes a reader of the scenario's facts must be indifferent to. */
export const NEUTRAL_SHAPES: readonly LogShape[] = [
  rebroadcast,
  fractionalMs,
  petDamage,
  dotTicks,
  castRowLag(),
  sameMsReverse,
];
