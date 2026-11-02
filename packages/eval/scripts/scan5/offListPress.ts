/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, spellCastEvents, auraEvents) */
/**
 * scan5/offListPress.ts — GH #176: the numbers a `[PRESS]` line prints,
 * against the log rows (user ruling 2026-11-02: every talent's effect on the
 * cooldown and the duration worked out before the line is printed).
 *
 * Check `offListPressLine`, kinds:
 *  - `noPress`: no SPELL_CAST_SUCCESS of the named spell by that unit in the
 *    line's second;
 *  - `backBeforeNextPress`: `back m:ss`, and the unit pressed the spell again
 *    more than `BACK_SLACK_MS` before it (the printed cooldown is too long —
 *    a reduction or reset the model does not read); a free press (the text's
 *    own `free press` on that press's line, or a Time Spiral one —
 *    `timeSpiralFreePressMs`) needs no readiness and is not that next
 *    press, and a Stasis replay (`isStasisReplayCast`) or a row echoing a
 *    Time Spiral free press (`timeSpiralEchoMs`) is no press at all;
 *  - `lastsBeyond`: `lasts Ns`, and the aura that press put up (its id or
 *    its effect aura's, APPLIED / REFRESH by the unit within 1 s) lived to
 *    its REMOVED more than `LASTS_SLACK_S` past N (the printed duration is
 *    too short: an aura cannot outlive its duration).
 * Truth is the log's rows; the parse of the line is the only shared part.
 */
import { effectAurasOfCast } from "@gladlog/analysis/src/data/castEffectAuras";
import { effectiveCooldownSeconds } from "@gladlog/analysis/src/data/spellEffectData";
import {
  timeSpiralEchoMs,
  timeSpiralFreePressMs,
} from "@gladlog/analysis/src/data/talentScriptedCooldowns";
import { isStasisReplayCast } from "@gladlog/analysis/src/utils/combatStates";

import {
  APPLIED,
  ev,
  fmtS,
  type IRoundCtx,
  nameOf,
  REFRESH,
  REMOVED,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["offListPressLine"] as const;

const PRESS_LINE =
  /^\s*(\d+:\d\d)\s+(\[YOU\] )?\[PRESS\]\s+(?:(\d+)\([^)]*\) \([^)]*\): )?(.+) \(([^()]*)\)\s*$/;
/** the back time may sit this far before the next press: a floored row */
const BACK_SLACK_MS = 2000;
/** an aura's logged life this far past the printed length is beyond it */
const LASTS_SLACK_S = 0.65;
const AURA_LEAD_MS = 1000;

export function run(ctx: IRoundCtx): void {
  // pass 1: each line's press (the k-th line of a second is its k-th press —
  // two presses in one second, Ace Up Your Sleeve's reset, print two lines in
  // log order). A Stasis replay is the stored press's copy, not a press
  // (`isStasisReplayCast`, the renderer's own exclusion).
  const seenInSecond = new Map<string, number>();
  const matched: Array<{
    line: string;
    m: RegExpExecArray;
    second: number;
    unit: any;
    presses: any[];
    press: any;
  }> = [];
  /** the presses whose own line states `free press`: no readiness needed,
   * so not the "next press" a `back` is checked against */
  const freeRows = new Set<any>();
  for (const line of ctx.lines) {
    const m = PRESS_LINE.exec(line);
    if (!m) continue;
    const second = secOf(m[1]!);
    const unit = m[2] ? ctx.owner : ctx.unitOfPid(m[3]!);
    const name = m[4]!;
    const named = unit
      ? successesOf(unit).filter(
          (c) =>
            nameOf(c.spellId, c.spellName) === name &&
            (effectiveCooldownSeconds(String(c.spellId)) ?? 0) > 0 &&
            !isStasisReplayCast(unit, String(c.spellId), tsOf(c)),
        )
      : [];
    // a row echoing a Time Spiral free press is no press either
    // (`timeSpiralEchoMs`, the renderer's own exclusion)
    const presses = named.filter(
      (c) =>
        !timeSpiralEchoMs(
          unit,
          String(c.spellId),
          named.filter((o) => o.spellId === c.spellId).map(tsOf),
        ).includes(tsOf(c)),
    );
    const ordKey = `${m[2] ? "you" : m[3]}|${name}|${second}`;
    const k = seenInSecond.get(ordKey) ?? 0;
    seenInSecond.set(ordKey, k + 1);
    const press = presses.filter(
      (c) => Math.floor((tsOf(c) - ctx.start) / 1000) === second,
    )[k];
    if (press && /\bfree press\b/.test(m[5]!)) freeRows.add(press);
    matched.push({ line, m, second, unit, presses, press });
  }
  for (const { line, m, second, unit, presses, press } of matched) {
    ctx.bump("offListPressLine");
    const name = m[4]!;
    const fields = m[5]!;
    const at0 = ctx.start + second * 1000;
    if (!unit || !press) {
      ctx.violate(
        "offListPressLine",
        "noPress",
        at0,
        `${ctx.roundKey}|${m[3] ?? "you"}|${name}|${second}`,
        `${name} at ${fmtS(second)}`,
        line,
      );
      continue;
    }
    const at = tsOf(press);
    const back = /back (\d+:\d\d)/.exec(fields)?.[1];
    if (back) {
      const backMs = ctx.start + secOf(back) * 1000;
      // the row itself, not its time: another player's free press in the
      // same millisecond frees nothing of this one's (codex review round 2)
      const next = presses
        .filter(
          (r) =>
            tsOf(r) > at + 50 &&
            !freeRows.has(r) &&
            !timeSpiralFreePressMs(unit, String(press.spellId), [tsOf(r)])
              .length,
        )
        .map(tsOf)[0];
      if (next !== undefined && next < backMs - BACK_SLACK_MS)
        ctx.violate(
          "offListPressLine",
          "backBeforeNextPress",
          at,
          `${ctx.roundKey}|${unit.id}|${name}|${second}`,
          `${unit.name} ${name} at ${fmtS(second)}: back ${back}, pressed ${fmtS((next - ctx.start) / 1000)}`,
          line,
        );
    }
    const lasts = /lasts ([\d.]+)s/.exec(fields)?.[1];
    if (lasts) {
      const ids = new Set([
        String(press.spellId),
        ...effectAurasOfCast(String(press.spellId)),
      ]);
      let life: number | undefined;
      for (const d of ctx.units as any[]) {
        const rows = ((d.auraEvents ?? []) as any[]).filter(
          (r) => r.srcUnitId === unit.id && ids.has(String(r.spellId)),
        );
        const i = rows.findIndex(
          (r) =>
            (ev(r) === APPLIED || ev(r) === REFRESH) &&
            tsOf(r) >= at &&
            tsOf(r) <= at + AURA_LEAD_MS,
        );
        if (i < 0) continue;
        const start = tsOf(rows[i]);
        for (let j = i + 1; j < rows.length; j++) {
          const r = rows[j];
          if (r.spellId !== rows[i].spellId) continue;
          if (ev(r) === REMOVED) {
            life = (tsOf(r) - start) / 1000;
            break;
          }
          if ((ev(r) === APPLIED || ev(r) === REFRESH) && tsOf(r) > start)
            break;
        }
        break;
      }
      if (life !== undefined && life > Number(lasts) + LASTS_SLACK_S)
        ctx.violate(
          "offListPressLine",
          "lastsBeyond",
          at,
          `${ctx.roundKey}|${unit.id}|${name}|${second}`,
          `${unit.name} ${name} at ${fmtS(second)}: lasts ${lasts}s printed, lived ${life.toFixed(1)}s`,
          line,
        );
    }
  }
}
