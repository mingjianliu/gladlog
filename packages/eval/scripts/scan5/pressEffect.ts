/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, missesOut) */
/**
 * scan5/pressEffect.ts — class 5 of the round-7 audit (fact7 F21, D27 / D36):
 * what an `[ENEMY DEF]` line says about a press against the rows of that press.
 *
 *  - `noPressButPressed` (D27): a line tagged `[no press logged]` for an aura
 *    the unit's own SPELL_CAST_SUCCESS of the same name landed on — within
 *    `PRESS_AFTER_MS` after the aura went up, a REFRESH beside it. 163de8f1
 *    1:00: Exhilaration's Survival of the Fittest at .584, the hunter's own
 *    press at .932 refreshing it.
 *  - `saveThatMissed` (D36): a line for a press whose own cast logged a
 *    SPELL_MISSED on its target, with no aura of the name on the unit around
 *    it. 9121b496 0:20: Touch of Karma, MISS on the warrior, no Karma aura.
 */
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import {
  ENEMY_DEF_TAG_RE_SRC,
  selfSaveCasts,
} from "@gladlog/analysis/src/utils/enemyDefensives";
import type { ICombatUnit } from "@gladlog/parser-compat";

import {
  APPLIED,
  ev,
  type IRoundCtx,
  nameOf,
  REFRESH,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["noPressButPressed", "saveThatMissed"] as const;

const PRESS_AFTER_MS = 1500;
const LINE = new RegExp(
  String.raw`^\s*(\d+):(\d\d)\s+${ENEMY_DEF_TAG_RE_SRC}\s+(\d+)\([^)]*\)(?: \([^)]*\))?: (.+)$`,
);
const spellOf = (rest: string): string =>
  /^(.+?)(?: \(| \[|$)/.exec(rest)?.[1] ?? rest;
/** The aura's activations (APPLIED / REFRESH rows) inside the line's second,
 * in log order. An activation is a proc's when the producer says so
 * (`selfSaveCasts`' `procOwned`: the row a FRESH marker of a proc that casts
 * the save paired — the same rule the [ENEMY DEF] line was rendered from;
 * B192 review 7: a re-listed marker is no new proc). Each press of the name
 * is given to ONE activation that is no proc's: the nearest it can explain
 * (within 50 ms of it, or in `PRESS_AFTER_MS` after it), paired over every
 * row it could fit and then cut to the second. 11346ea9 r1 1:53 (T259 /
 * B192): Frenzied Regeneration APPLIED .197, the druid's press .198, then the
 * Well-Honed Instincts proc's REFRESH at .937. 11dfa802 r3: APPLIED .906,
 * press .907, the proc's REFRESH .921 — the press is the APPLIED's alone.
 * bf679e40 r1: the proc 0:52.172, the press 0:53.500 beside its own REFRESH. */
export function activationsInSecond(
  auras: readonly { event: string; ts: number }[],
  pressTs: readonly number[],
  procTs: readonly number[],
  lo: number,
): { refresh: boolean; pressed: boolean; proc: boolean }[] {
  return activationRows(auras, pressTs, procTs, lo).map(
    ({ refresh, pressed, proc }) => ({ refresh, pressed, proc }),
  );
}

/** `activationsInSecond` with each row's instant and its press's. */
function activationRows(
  auras: readonly { event: string; ts: number }[],
  pressTs: readonly number[],
  procTs: readonly number[],
  lo: number,
): {
  ts: number;
  refresh: boolean;
  pressed: boolean;
  proc: boolean;
  lineTs: number;
}[] {
  const reach = PRESS_AFTER_MS + 50;
  // the producer's proc rows, as a count per millisecond: of several rows in
  // one millisecond only as many are a proc's as it named, the first in log
  // order (its pairing keeps the first row at the closest gap; B192 review 8)
  const procLeft = new Map<number, number>();
  for (const t of procTs) procLeft.set(t, (procLeft.get(t) ?? 0) + 1);
  const acts = auras
    .filter(
      (a) =>
        (a.event === APPLIED || a.event === REFRESH) &&
        a.ts >= lo - reach &&
        a.ts < lo + 1000 + reach,
    )
    .sort((x, y) => x.ts - y.ts) // stable: log order within a millisecond
    .map((a) => {
      const left = procLeft.get(a.ts) ?? 0;
      if (left) procLeft.set(a.ts, left - 1);
      return {
        ts: a.ts,
        refresh: a.event === REFRESH,
        pressed: false,
        proc: left > 0,
        // the line's own instant: a press's line sits at its cast row, any
        // other at its aura row (B192 review 8: APPLIED .170, the proc's
        // REFRESH .200, the cast .201 — the proc's line renders first)
        lineTs: a.ts,
      };
    });
  // each press goes to ONE activation that is no proc's: the nearest it fits
  for (const p of [...pressTs].sort((x, y) => x - y)) {
    const best = acts
      .filter(
        (a) =>
          !a.proc &&
          !a.pressed &&
          (Math.abs(p - a.ts) <= 50 ||
            (p >= a.ts && p <= a.ts + PRESS_AFTER_MS)),
      )
      .sort((x, y) => Math.abs(p - x.ts) - Math.abs(p - y.ts))[0];
    if (best) {
      best.pressed = true;
      best.lineTs = p;
    }
  }
  return acts
    .filter((a) => a.lineTs >= lo && a.lineTs < lo + 1000)
    .sort((x, y) => x.lineTs - y.lineTs);
}

/** Whether the `[no press logged]` line at position `pos` (0-based, in
 * rendered order) among the `lineCount` lines of a unit's spell in one second
 * is a proc's own line: only when the lines and the second's activations pair
 * one to one in order and the activation at `pos` is a proc's (the
 * producer's proc row) that no press was given to. B192 reviews: both lines tagged, or
 * the tags swapped, flags the press's line; an unmarked REFRESH a press
 * missed by 83 ms exempts nothing (review 3, constructed). */
export function isProcOwnNoPressLine(
  pos: number,
  lineCount: number,
  activations: readonly { pressed: boolean; proc: boolean }[],
): boolean {
  const a = activations[pos];
  return lineCount === activations.length && !!a && a.proc && !a.pressed;
}

export function run(ctx: IRoundCtx): void {
  // the producer's proc-owned activations per unit, by spell name (ms)
  const procCache = new Map<string, Map<string, number[]>>();
  const procTsOf = (unit: any, name: string): number[] => {
    let byName = procCache.get(unit.id);
    if (!byName) {
      byName = new Map();
      for (const c of selfSaveCasts(
        unit as ICombatUnit,
        ctx.start,
        ctx.units as ICombatUnit[],
      )) {
        if (!c.procOwned) continue;
        const ms = Math.round(ctx.start + c.atSeconds * 1000);
        byName.set(c.spellName, [...(byName.get(c.spellName) ?? []), ms]);
      }
      procCache.set(unit.id, byName);
    }
    return byName.get(name) ?? [];
  };
  // per unit-spell-second: its lines' indices in rendered order
  const keyOf = (m: RegExpExecArray): string =>
    `${m[3]}|${spellOf(m[4]!)}|${+m[1]! * 60 + +m[2]!}`;
  const linesOfKey = new Map<string, number[]>();
  ctx.lines.forEach((line, i) => {
    const m = LINE.exec(line);
    if (!m) return;
    const k = keyOf(m);
    linesOfKey.set(k, [...(linesOfKey.get(k) ?? []), i]);
  });
  for (const [i, line] of ctx.lines.entries()) {
    const m = LINE.exec(line);
    if (!m) continue;
    const unit = ctx.unitOfPid(m[3]);
    if (!unit) continue;
    const name = spellOf(m[4]!);
    const lo = ctx.start + (+m[1]! * 60 + +m[2]!) * 1000;
    const presses = successesOf(unit).filter(
      (c) => nameOf(c.spellId, c.spellName) === name,
    );
    const auras = ((unit.auraEvents ?? []) as any[]).filter(
      (a) =>
        a.destUnitId === unit.id &&
        getEnglishSpellName(a.spellId, a.spellName ?? "") === name,
    );
    if (line.includes("[no press logged]")) {
      const up = auras.find(
        (a) => ev(a) === APPLIED && tsOf(a) >= lo && tsOf(a) < lo + 1000,
      );
      const keyLines = linesOfKey.get(keyOf(m)) ?? [];
      const pos = keyLines.indexOf(i);
      const acts = activationRows(
        auras.map((a) => ({ event: ev(a), ts: tsOf(a) })),
        presses.map(tsOf),
        procTsOf(unit, name),
        lo,
      );
      if (!up) {
        // a second of REFRESH rows only: the line is a press's when its own
        // activation (lines and activations one to one) was given a press
        // (B192 review 5 — bf679e40 r1 0:53 tagged by mutation: the press
        // and its REFRESH at 53.500, no APPLIED in the second); a proc's
        // activation is never given a press
        const own = acts[pos];
        if (!own || keyLines.length !== acts.length) continue;
        ctx.bump("noPressButPressed");
        if (!own.pressed) continue;
        const rowTs = own.ts;
        const pressAt = own.lineTs;
        ctx.violate(
          "noPressButPressed",
          "refreshed",
          pressAt,
          `${unit.name}#${name}#${pressAt}`,
          `${unit.name} ${name}: refresh +${rowTs - ctx.start}ms, press +${pressAt - ctx.start}ms`,
          line,
        );
        continue;
      }
      ctx.bump("noPressButPressed");
      if (isProcOwnNoPressLine(pos, keyLines.length, acts)) continue;
      const press = presses.find(
        (c) => tsOf(c) >= tsOf(up) && tsOf(c) <= tsOf(up) + PRESS_AFTER_MS,
      );
      if (!press) continue;
      const refreshed = auras.some(
        (a) => ev(a) === REFRESH && Math.abs(tsOf(a) - tsOf(press)) <= 50,
      );
      ctx.violate(
        "noPressButPressed",
        refreshed ? "refreshed" : "noRefreshRow",
        tsOf(press),
        `${unit.name}#${name}#${tsOf(press)}`,
        `${unit.name} ${name}: aura +${tsOf(up) - ctx.start}ms, press +${tsOf(press) - ctx.start}ms`,
        line,
      );
      continue;
    }
    const press = presses.find((c) => tsOf(c) >= lo && tsOf(c) < lo + 1000);
    if (!press) continue;
    ctx.bump("saveThatMissed");
    const missed = ((unit.missesOut ?? []) as any[]).find(
      (x) =>
        String(x.spellId) === String(press.spellId) &&
        Math.abs(x.timestamp - tsOf(press)) <= 200,
    );
    if (!missed) continue;
    const auraUp = auras.some((a) => Math.abs(tsOf(a) - tsOf(press)) <= 1500);
    if (auraUp) continue;
    ctx.violate(
      "saveThatMissed",
      String(missed.missType),
      tsOf(press),
      `${unit.name}#${name}#${tsOf(press)}`,
      `${unit.name} ${name}: press +${tsOf(press) - ctx.start}ms, ${missed.missType} on ${missed.destUnitName ?? missed.destUnitId}, no aura`,
      line,
    );
  }
}
