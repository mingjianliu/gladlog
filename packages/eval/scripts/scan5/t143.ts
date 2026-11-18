/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects */
/**
 * scan5/t143.ts — ticket T143 (user ruling A2, 2026-11-17; GH #221 g1): a
 * press whose only line is a deliberate `[MINOR DISPELS]` part — `Spell ×N
 * (m:ss removed …)` — had its `[PRESS]` line dropped, and with it
 * `(Ns cd, back m:ss)`. Ruling: a press with a cooldown of 30 s or more
 * keeps the `[PRESS]` line; a short-cooldown dispel stays folded.
 *
 *  - `pressReplacedByMinorDispels`: every press the producer has for a
 *    `[PRESS]` line (`extractOffListPresses`) that a deliberate
 *    `[MINOR DISPELS]` part of its unit states within
 *    `PRESS_LINE_NEAR_S` and no line of another tag does
 *    (`lineStatesPress`); a violation when its cooldown is at or above the
 *    producer's `MINOR_DISPELS_KEEPS_PRESS_CD_S` and no `[PRESS]` line of
 *    that unit states it. Kind = the spell. Inventory kind (out of the
 *    total) `short cd` for one below the threshold with no
 *    `[PRESS]` line — what the ruling leaves folded.
 */
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import {
  extractOffListPresses,
  lineStatesPress,
  MINOR_DISPELS_KEEPS_PRESS_CD_S,
  minorDispelsLineStatesSpell,
  PRESS_LINE_NEAR_S,
  pressLineCaster,
} from "@gladlog/analysis/src/utils/offListPress";

import { type IRoundCtx } from "./ctx";

export const CHECKS = ["pressReplacedByMinorDispels"] as const;
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "pressReplacedByMinorDispels|short cd",
]);

const LINE_AT = /^\s*(\d+):(\d\d)\s+(.*)$/;

export function run(ctx: IRoundCtx): void {
  // every owner's context: whether another line states the press depends
  // on whose timeline it is (the presser's own has `[YOU] [CD]` where a
  // mate's has only the fold — codex 85-tk-CD-T143-1 #1); the fact key is
  // the press, so `distinct facts` counts presses
  const ownerPid = ctx.pidOf(ctx.owner.name);
  const timed = ctx.lines
    .map((l) => {
      const m = LINE_AT.exec(l);
      return m ? { t: +m[1]! * 60 + +m[2]!, text: m[3]! } : undefined;
    })
    .filter((x): x is { t: number; text: string } => x !== undefined);
  for (const p of extractOffListPresses(
    ctx.players,
    ctx.legacy,
    ctx.roundEndAt,
  )) {
    const name = getEnglishSpellName(p.spellId, "");
    if (!name) continue;
    const pid = ctx.pidOf((p.unit as any).name);
    const sec = Math.floor(p.timeSeconds);
    const near = timed.filter(
      (l) =>
        Math.abs(l.t - sec) <= PRESS_LINE_NEAR_S &&
        l.text.includes(name) &&
        pressLineCaster(l.text, name, ownerPid) === pid,
    );
    const minor = near.find(
      (l) =>
        l.text.includes("[MINOR DISPELS]") &&
        minorDispelsLineStatesSpell(l.text, name),
    );
    if (!minor) continue;
    // another tag's line of the unit states the press (`[YOU] [CD]`,
    // `[CLEANSE] … (Spell)`): the part replaced nothing — the producer's
    // own question, `lineStatesPress`
    if (
      near.some(
        (l) =>
          !l.text.includes("[MINOR DISPELS]") &&
          !l.text.includes("[PRESS]") &&
          lineStatesPress(l.text, name, pid, ownerPid, p.cooldownSeconds),
      )
    )
      continue;
    ctx.bump("pressReplacedByMinorDispels");
    if (near.some((l) => l.text.includes("[PRESS]"))) continue;
    const long = p.cooldownSeconds >= MINOR_DISPELS_KEEPS_PRESS_CD_S;
    ctx.violate(
      "pressReplacedByMinorDispels",
      long ? name : "short cd",
      ctx.start + p.timeSeconds * 1000,
      `${ctx.roundKey}|${p.unit.id}|${p.spellId}|${sec}`,
      `${(p.unit as any).name} ${name} at ${p.timeSeconds.toFixed(1)}s, ${p.cooldownSeconds}s cd: no [PRESS] line`,
      minor.text.slice(0, 200),
    );
  }
}
