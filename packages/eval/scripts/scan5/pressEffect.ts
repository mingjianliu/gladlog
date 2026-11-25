/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, missesOut) */
/**
 * scan5/pressEffect.ts — class 5 of the round-7 audit (fact7 F21, D27 / D36):
 * what an `[ENEMY DEF]` line says about a press against the rows of that press.
 *
 *  - `noPressButPressed` (D27): a line tagged `[no press logged]` for an aura
 *    the unit's own SPELL_CAST_SUCCESS of the same name landed on — within
 *    `PRESS_AFTER_MS` after the aura went up, a REFRESH beside it — and no
 *    line of its own for that press in the press's second (with one, the
 *    tagged line is the earlier application's and both are true). 163de8f1
 *    1:00: Exhilaration's Survival of the Fittest at .584, the hunter's own
 *    press at .932 refreshing it.
 *  - `saveThatMissed` (D36): a line for a press whose own cast logged a
 *    SPELL_MISSED on its target, with no aura of the name on the unit around
 *    it. 9121b496 0:20: Touch of Karma, MISS on the warrior, no Karma aura.
 */
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import {
  ENEMY_DEF_TAG_RE_SRC,
  enemyDefensiveEvents,
  type IEnemyDefensiveEvent,
} from "@gladlog/analysis/src/utils/enemyDefensives";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";

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
/** The producer's own event behind one rendered line: `enemyDef.ts` prints a
 * caster's `enemyDefensiveEvents` in their order, each at the second of its
 * `atSeconds`, so the lines of one unit, spell and second pair with that
 * second's events of the name one to one, in order. Undefined when the two
 * counts differ — a line with no event to read is nobody's proc. The scan
 * reads ownership here and nowhere else (B192 reviews 1-9: every
 * re-derivation of "which row is the proc's, which line is the press's" from
 * the aura rows drew another counter-case — a swapped tag, a press given to
 * two rows, a tie in one millisecond). */
export function ownEventOfLine<T extends { atSeconds: number }>(
  pos: number,
  lineCount: number,
  eventsOfSecond: readonly T[],
): T | undefined {
  return lineCount === eventsOfSecond.length ? eventsOfSecond[pos] : undefined;
}

/** the producer's `[ENEMY DEF]` events of one caster, as `enemyDef.ts`
 * builds them (the round's units, the round's end), once per round view */
const EVENTS = new WeakMap<object, Map<string, IEnemyDefensiveEvent[]>>();
function enemyDefEventsOf(ctx: IRoundCtx, caster: any): IEnemyDefensiveEvent[] {
  let byCaster = EVENTS.get(ctx.legacy);
  if (!byCaster) EVENTS.set(ctx.legacy, (byCaster = new Map()));
  let out = byCaster.get(caster.id);
  if (!out) {
    const legacy: any = ctx.legacy;
    const team = (ctx.players as any[]).filter(
      (p) => p.reaction === caster.reaction,
    );
    out = enemyDefensiveEvents(
      caster,
      team,
      {
        startTime: ctx.start,
        endTime: legacy.endTime,
        units: legacy.units ?? {},
      } as any,
      roundEndMs(legacy),
    );
    byCaster.set(caster.id, out);
  }
  return out;
}

export function run(ctx: IRoundCtx): void {
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
      const sec = +m[1]! * 60 + +m[2]!;
      const own = ownEventOfLine(
        keyLines.indexOf(i),
        keyLines.length,
        enemyDefEventsOf(ctx, unit).filter(
          (e) =>
            e.spellName === name &&
            Math.max(0, Math.floor(e.atSeconds)) === sec,
        ),
      );
      // the line of a proc's own activation (the producer's `procOwned`:
      // Well-Honed Instincts' Frenzied Regeneration) is nobody's press,
      // whatever the player pressed beside it — 11346ea9 r1 1:53: APPLIED
      // .197, the druid's press .198, the proc's REFRESH .937; bf679e40 r1:
      // the proc 0:52.172, the press 0:53.500. A press's line that carries
      // the tag is not the proc's event and is judged below.
      if (own?.procOwned) {
        ctx.bump("noPressButPressed");
        continue;
      }
      if (!up) {
        // a second with no APPLIED of the aura: the line's own event says
        // where it sits (B192 review 5 — bf679e40 r1 0:53 tagged by
        // mutation: the press and its REFRESH at 53.500)
        if (!own) continue;
        ctx.bump("noPressButPressed");
        const at = Math.round(
          ctx.start + (own.pressSeconds ?? own.atSeconds) * 1000,
        );
        const pressed = presses.find(
          (c) =>
            Math.abs(tsOf(c) - at) <= 50 ||
            (tsOf(c) >= at && tsOf(c) <= at + PRESS_AFTER_MS),
        );
        if (!pressed) continue;
        ctx.violate(
          "noPressButPressed",
          "refreshed",
          tsOf(pressed),
          `${unit.name}#${name}#${tsOf(pressed)}`,
          `${unit.name} ${name}: line +${at - ctx.start}ms, press +${tsOf(pressed) - ctx.start}ms`,
          line,
        );
        continue;
      }
      ctx.bump("noPressButPressed");
      const press = presses.find(
        (c) => tsOf(c) >= tsOf(up) && tsOf(c) <= tsOf(up) + PRESS_AFTER_MS,
      );
      if (!press) continue;
      const refreshed = auras.some(
        (a) => ev(a) === REFRESH && Math.abs(tsOf(a) - tsOf(press)) <= 50,
      );
      // the press refreshed the aura and has a line of its own in its
      // second: the earlier application is another one (a proc's —
      // Exhilaration's 3 s Survival of the Fittest, Well-Honed Instincts'
      // Frenzied Regeneration), and both lines are true (T243). With no
      // REFRESH the application is the press's own and the tag is wrong
      // whatever else prints (codex 85-tk-L5-T243-1 #2).
      const pressSec = Math.floor((tsOf(press) - ctx.start) / 1000);
      if (
        refreshed &&
        ctx.lines.some((o) => {
          const om = LINE.exec(o);
          return (
            !!om &&
            o !== line &&
            om[3] === m[3] &&
            +om[1]! * 60 + +om[2]! === pressSec &&
            spellOf(om[4]!) === name &&
            !o.includes("[no press logged]")
          );
        })
      )
        continue;
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
