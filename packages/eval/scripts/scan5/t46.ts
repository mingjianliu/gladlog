/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (actionIn, spellCastEvents) */
/**
 * scan5/t46.ts — pipeline T46: does an interrupt's school lockout stop a
 * spell DB2 says a silence does not stop? Log rows are the truth; the DB2
 * school, the silence bit and the lockout length are lookups.
 *
 * Every enemy SPELL_INTERRUPT on a player opens a lock of the interrupted
 * spell's schools for `kickLockoutSecondsFor` (the victim's own length). A
 * spell whose every school is inside that lock (`schoolLockedBy`) is
 * "in-school". The lock's DEEP part is its first half, more than
 * `EDGE_MS` after the kick: a lock an unmodelled effect shortened (an aura
 * that cuts interrupt durations) is still running there.
 *
 *  - `lockedWentOut`: an in-school SPELL_CAST_SUCCESS of the player in the
 *    deep part of a lock, of a spell the product's reading
 *    (`intervalBlocksSpell` on that lock) says the lock stops. Kind = the
 *    spell's silence class (`silenceable` / `unsilenceable` / `no row`).
 *    Counted: every in-school deep SUCCESS.
 *  - `notStoppedNeverOut` (judged on the whole run): a "not ready" refusal
 *    of an in-school spell in the deep part of a lock that the product reads
 *    as NOT stopped by the lock — "its own cooldown or the GCD" — for a
 *    spell the run never once saw go out in the deep part of a lock of its
 *    school, over at least `MIN_REFUSALS` such refusals. Kind = the spell.
 *    Counted: every in-school deep "not ready" refusal the product reads as
 *    not stopped.
 *
 * `report()` prints the forward table the two checks stand on: per spell,
 * deep in-school successes against deep in-school "not ready" refusals,
 * with its silence class and what the product reads.
 */
import { NOT_READY_REASONS } from "@gladlog/analysis/src/analysis/candidates/shared";
import {
  schoolLockedBy,
  spellSchoolMask,
} from "@gladlog/analysis/src/data/spellSchools";
import { intervalBlocksSpell } from "@gladlog/analysis/src/utils/cannotCastIntervals";
import { LOCK_IGNORING_CAST_IDS } from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import { kickLockoutSecondsFor } from "@gladlog/analysis/src/utils/kickLockout";
import {
  isSilenceableCast,
  isUnsilenceableCast,
} from "@gladlog/analysis/src/utils/spellMechanics";

import {
  ev,
  fmtS,
  type IRoundCtx,
  nameOf,
  type RecordViolation,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["lockedWentOut", "notStoppedNeverOut"] as const;
/** a row with no SpellCategories row is one nobody presses (Shadowy
 * Apparition, Reclamation): the product keeps it stopped for want of
 * evidence, and no reader asks about it — counted, not in the total */
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "lockedWentOut|no row",
]);

/** the two rows of one instant are logged in either order */
export const EDGE_MS = 150;
/** the part of the modelled lock read as certainly locked */
export const DEEP_FRACTION = 0.5;
/** a spell is judged "never out" only over this many deep refusals */
export const MIN_REFUSALS = 5;
const OUT_AT_CAP = 6;

type Klass = "silenceable" | "unsilenceable" | "no row";
export const klassOf = (id: string): Klass =>
  isSilenceableCast(id)
    ? "silenceable"
    : isUnsilenceableCast(id)
      ? "unsilenceable"
      : "no row";

interface IRefusal {
  ref: IRoundCtx["ref"];
  atMs: number;
  factId: string;
  detail: string;
}
interface IRow {
  name: string;
  klass: Klass;
  out: number;
  /** deep in-school "not ready" refusals, all */
  refused: number;
  /** …of them, the ones the product reads as not stopped by the lock */
  notStopped: IRefusal[];
  /** locks (player × kick) with a deep success / a deep refusal */
  outLocks: number;
  refusedLocks: number;
  /** the same two over the whole modelled lock, `EDGE_MS` off both ends: a
   * shortened lock's tail is in here, so the silenceable row is its noise */
  outWhole: number;
  refusedWhole: number;
  /** where a spell with no silence bit went out inside a lock (capped) */
  outAt: string[];
  /** whole-lock out / refused per locked school mask */
  byMask: Map<number, [number, number]>;
}
let rows = new Map<string, IRow>();
const rowOf = (id: string): IRow => {
  let r = rows.get(id);
  if (!r) {
    r = {
      name: nameOf(id, id),
      klass: klassOf(id),
      out: 0,
      refused: 0,
      notStopped: [],
      outLocks: 0,
      refusedLocks: 0,
      outWhole: 0,
      refusedWhole: 0,
      outAt: [],
      byMask: new Map(),
    };
    rows.set(id, r);
  }
  return r;
};

const tallyMask = (r: IRow, mask: number, i: 0 | 1): void => {
  const t = r.byMask.get(mask) ?? [0, 0];
  t[i]++;
  r.byMask.set(mask, t);
};

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  const failedAll = ctx.rawStreams().castFailed;
  for (const p of ctx.players) {
    const enemy = new Set(
      ctx.units
        .filter((u) => u.reaction !== p.reaction)
        .map((u) => u.id as string),
    );
    const kicks = ((p.actionIn ?? []) as any[]).filter(
      (k) => ev(k) === "SPELL_INTERRUPT" && enemy.has(k.srcUnitId),
    );
    if (kicks.length === 0) continue;
    const casts = successesOf(p);
    const failed = failedAll.filter(
      (f) => f.unitGuid === p.id && NOT_READY_REASONS.has(f.reason),
    );
    for (const k of kicks) {
      const lockedMask = spellSchoolMask(String(k.extraSpellId));
      if (lockedMask === undefined) continue;
      const lockMs =
        kickLockoutSecondsFor(
          String(k.spellId),
          p,
          String(k.extraSpellId),
          tsOf(k),
          ctx.units.find((u) => u.id === k.srcUnitId),
        ) * 1000;
      const from = tsOf(k) + EDGE_MS;
      const to = tsOf(k) + lockMs * DEEP_FRACTION;
      const end = tsOf(k) + lockMs - EDGE_MS;
      if (to <= from) continue;
      const iv = { lockout: true as const, lockedSchoolMask: lockedMask };
      const inSchool = (id: string) => {
        const m = spellSchoolMask(id);
        return m !== undefined && schoolLockedBy(m, lockedMask);
      };
      const kickS = (tsOf(k) - ctx.start) / 1000;
      const seenOut = new Set<string>();
      const seenRefused = new Set<string>();
      for (const c of casts) {
        const id = String(c.spellId);
        if (tsOf(c) <= from || tsOf(c) >= end || !inSchool(id)) continue;
        if (LOCK_IGNORING_CAST_IDS.has(id)) continue;
        const r = rowOf(id);
        r.outWhole++;
        tallyMask(r, lockedMask, 0);
        if (r.klass !== "silenceable" && r.outAt.length < OUT_AT_CAP)
          r.outAt.push(
            `${ctx.where} +${((tsOf(c) - tsOf(k)) / 1000).toFixed(1)}/${(lockMs / 1000).toFixed(1)}s ${nameOf(k.spellId)} on ${nameOf(k.extraSpellId)} (school ${lockedMask}) at ${fmtS(kickS)}`,
          );
        if (tsOf(c) >= to) continue;
        ctx.bump("lockedWentOut");
        r.out++;
        if (!seenOut.has(id)) r.outLocks++;
        seenOut.add(id);
        if (!intervalBlocksSpell(iv, id)) continue;
        ctx.violate(
          "lockedWentOut",
          r.klass,
          tsOf(c),
          `${p.name}#${id}#${Math.floor(tsOf(c) / 100)}`,
          `${r.name} ${id} went out at ${fmtS((tsOf(c) - ctx.start) / 1000)}, +${((tsOf(c) - tsOf(k)) / 1000).toFixed(1)}s into a ${(lockMs / 1000).toFixed(1)}s lock of school ${lockedMask} (${nameOf(k.spellId)} on ${nameOf(k.extraSpellId)} at ${fmtS(kickS)})`,
        );
      }
      for (const f of failed) {
        const id = String(f.spellId);
        const at = ctx.start + f.tSeconds * 1000;
        if (at <= from || at >= end || !inSchool(id)) continue;
        const r = rowOf(id);
        r.refusedWhole++;
        tallyMask(r, lockedMask, 1);
        if (at >= to) continue;
        r.refused++;
        if (!seenRefused.has(id)) r.refusedLocks++;
        seenRefused.add(id);
        if (intervalBlocksSpell(iv, id)) continue;
        ctx.bump("notStoppedNeverOut");
        r.notStopped.push({
          ref: ctx.ref,
          atMs: at,
          factId: `${p.name}#${id}#${Math.floor(at / 100)}`,
          detail: `${r.name} ${id} refused "not ready" at ${fmtS(f.tSeconds)}, +${((at - tsOf(k)) / 1000).toFixed(1)}s into a ${(lockMs / 1000).toFixed(1)}s lock of school ${lockedMask} (${nameOf(k.spellId)} at ${fmtS(kickS)}), read as not stopped by it`,
        });
      }
    }
  }
}

export function finalize(record: RecordViolation): void {
  for (const [id, r] of rows) {
    if (r.out > 0 || r.refused < MIN_REFUSALS) continue;
    for (const v of r.notStopped)
      record(
        v.ref,
        "notStoppedNeverOut",
        `${r.name} ${id}`,
        v.atMs,
        v.factId,
        v.detail,
      );
  }
}

export function report(): string[] {
  const list = [...rows].sort(
    (a, b) =>
      b[1].outWhole + b[1].refusedWhole - (a[1].outWhole + a[1].refusedWhole),
  );
  const tally = (k: Klass) => {
    const of = list.filter(([, r]) => r.klass === k);
    const sum = (f: (r: IRow) => number) =>
      of.reduce((n, [, r]) => n + f(r), 0);
    return `${k}: out ${sum((r) => r.out)} / refused ${sum((r) => r.refused)}, whole lock ${sum((r) => r.outWhole)} / ${sum((r) => r.refusedWhole)} (${of.length} spells)`;
  };
  return [
    `t46 deep in-school presses by silence class — ${tally("silenceable")}; ${tally("unsilenceable")}; ${tally("no row")}`,
    `t46 per spell (${list.length}): out(locks) refused(locks) readNotStopped wholeOut/wholeRefused id name class`,
    ...list.flatMap(([id, r]) => [
      `  ${r.out}(${r.outLocks}) ${r.refused}(${r.refusedLocks}) ${r.notStopped.length} ${r.outWhole}/${r.refusedWhole} ${id} ${r.name} [${r.klass}] locks ${[...r.byMask].map(([m, [o, f]]) => `${m}:${o}/${f}`).join(" ")}`,
      ...r.outAt.map((x) => `      out: ${x}`),
    ]),
  ];
}

export const state = () => ({ rows });
export const load = (s: ReturnType<typeof state>): void => {
  ({ rows } = s);
};
export const merge = {
  rows: (a: Map<string, IRow>, b: Map<string, IRow>) => {
    for (const [id, r] of b) {
      const x = a.get(id);
      if (!x) {
        a.set(id, r);
        continue;
      }
      x.out += r.out;
      x.refused += r.refused;
      x.outLocks += r.outLocks;
      x.refusedLocks += r.refusedLocks;
      x.outWhole += r.outWhole;
      x.refusedWhole += r.refusedWhole;
      for (const v of r.notStopped) x.notStopped.push(v);
      for (const v of r.outAt) if (x.outAt.length < OUT_AT_CAP) x.outAt.push(v);
      for (const [m, [o, f]] of r.byMask) {
        const t = x.byMask.get(m) ?? [0, 0];
        x.byMask.set(m, [t[0] + o, t[1] + f]);
      }
    }
    return a;
  },
};
