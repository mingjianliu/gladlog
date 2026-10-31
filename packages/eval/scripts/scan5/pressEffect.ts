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
const LINE =
  /^\s*(\d+):(\d\d)\s+\[ENEMY DEF\]\s+(\d+)\([^)]*\)(?: \([^)]*\))?: (.+)$/;
const spellOf = (rest: string): string =>
  /^(.+?)(?: \(| \[|$)/.exec(rest)?.[1] ?? rest;

export function run(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
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
      if (!up) continue;
      ctx.bump("noPressButPressed");
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
