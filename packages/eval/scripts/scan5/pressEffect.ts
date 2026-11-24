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
import { ENEMY_DEF_TAG_RE_SRC } from "@gladlog/analysis/src/utils/enemyDefensives";

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
/** The REFRESHes inside the line's second that no press of the name
 * explains (no press within 50 ms of one, none in `PRESS_AFTER_MS` after it):
 * activations of their own, each of which a `[no press logged]` line in that
 * second may be about instead of a pressed APPLIED beside it. 11346ea9 r1 1:53
 * (T259 / B192): Frenzied Regeneration APPLIED .197 with the druid's press at
 * .198 (its own line), then at .937 a REFRESH carrying the Well-Honed
 * Instincts marker 382912, the proc the second line prints. */
export function unpressedRefreshesInSecond(
  auras: readonly { event: string; ts: number }[],
  pressTs: readonly number[],
  lo: number,
): number {
  return auras.filter(
    (a) =>
      a.event === REFRESH &&
      a.ts >= lo &&
      a.ts < lo + 1000 &&
      !pressTs.some(
        (p) =>
          Math.abs(p - a.ts) <= 50 || (p >= a.ts && p <= a.ts + PRESS_AFTER_MS),
      ),
  ).length;
}

/** Whether the `nth` (0-based) `[no press logged]` line of a unit's spell in
 * one second is a proc's own line: only while every press of the name logged
 * in that second already has a line of its own without the tag, and only up to
 * the number of unpressed REFRESHes there. A press relabelled `[no press
 * logged]` beside a proc is still caught (B192 review: both lines tagged, the
 * labelled-press count falls short of the presses). */
export function isProcOwnNoPressLine(
  nth: number,
  unpressedRefreshes: number,
  labelledPressLines: number,
  pressesInSecond: number,
): boolean {
  return nth < unpressedRefreshes && labelledPressLines >= pressesInSecond;
}

export function run(ctx: IRoundCtx): void {
  // per unit-spell-second: lines without the tag, and tagged lines seen so far
  const keyOf = (m: RegExpExecArray): string =>
    `${m[3]}|${spellOf(m[4]!)}|${+m[1]! * 60 + +m[2]!}`;
  const labelled = new Map<string, number>();
  for (const line of ctx.lines) {
    const m = LINE.exec(line);
    if (m && !line.includes("[no press logged]"))
      labelled.set(keyOf(m), (labelled.get(keyOf(m)) ?? 0) + 1);
  }
  const taggedSeen = new Map<string, number>();
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
      const key = keyOf(m);
      const nth = taggedSeen.get(key) ?? 0;
      taggedSeen.set(key, nth + 1);
      if (
        isProcOwnNoPressLine(
          nth,
          unpressedRefreshesInSecond(
            auras.map((a) => ({ event: ev(a), ts: tsOf(a) })),
            presses.map(tsOf),
            lo,
          ),
          labelled.get(key) ?? 0,
          presses.filter((c) => tsOf(c) >= lo && tsOf(c) < lo + 1000).length,
        )
      )
        continue;
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
