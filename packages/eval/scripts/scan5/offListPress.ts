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
 *    Time Spiral free press (`timeSpiralEchoMs`) is no press at all; a
 *    hold never released (`unreleasedHoldMs`) owns no line but still
 *    counts as a next press (the empower could not start on cooldown);
 *  - `lastsBeyond`: `lasts Ns`, and the APPLIED row the line read N from
 *    (`pressDuration` — the cast's target's first, the line's own predicate)
 *    lived to its REMOVED more than `LASTS_SLACK_S` past N (the printed
 *    duration is too short: an aura cannot outlive its duration); a floor
 *    (`lasts 10s+`, `pressDuration`'s `floor` — Timewalker) is not held to
 *    it.
 * Truth is the log's rows; the parse of the line is the only shared part.
 */
import { SHARED_CHARGE_CATEGORY } from "@gladlog/analysis/src/data/sharedChargeGenerated";
import { effectiveCooldownSeconds } from "@gladlog/analysis/src/data/spellEffectData";
import {
  timeSpiralEchoMs,
  timeSpiralFreePressMs,
} from "@gladlog/analysis/src/data/talentScriptedCooldowns";
import { isStasisReplayCast } from "@gladlog/analysis/src/utils/combatStates";
import { unreleasedHoldMs } from "@gladlog/analysis/src/utils/cooldowns";
import { pressDuration } from "@gladlog/analysis/src/utils/offListPress";
import type { ICombatUnit } from "@gladlog/parser-compat";

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
    // a hold never released prints no line (`unreleasedHoldMs`, the
    // renderer's own exclusion; GH #183: a cut Fire Breath at 0:35.4 took
    // the 0:35.99 press's line) — but it stays a next press below: the
    // empower could not start unless the spell was ready
    const press = presses.filter(
      (c) =>
        Math.floor((tsOf(c) - ctx.start) / 1000) === second &&
        !unreleasedHoldMs(unit, String(c.spellId), [tsOf(c)]).length,
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
      // …or a press of a button on the same DB2 charge pool
      // (`sharesChargePool`: Holy Bulwark / Sacred Weapon — fact10 D7, a
      // Sacred Weapon `back 2:41` with Holy Bulwark pressed at 2:35)
      // — the DB2 ChargeCategory itself, also when `canonicalSpellId` reads
      // the two as one cooldown (Sacred Weapon 432472 is Holy Bulwark
      // 432459's, so `sharesChargePool` says no); a follow-up button with a
      // pool of its own (Voidblade → Pierce the Veil) is no mate
      const pool = SHARED_CHARGE_CATEGORY[String(press.spellId)];
      const mates = successesOf(unit).filter(
        (c) =>
          String(c.spellId) !== String(press.spellId) &&
          pool !== undefined &&
          SHARED_CHARGE_CATEGORY[String(c.spellId)] === pool &&
          !isStasisReplayCast(unit, String(c.spellId), tsOf(c)),
      );
      const next = [...presses, ...mates]
        .filter(
          (r) =>
            tsOf(r) > at + 50 &&
            !freeRows.has(r) &&
            !timeSpiralFreePressMs(unit, String(r.spellId), [tsOf(r)])
              .length,
        )
        .map(tsOf)
        .sort((x, y) => x - y)[0];
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
      // the row the line read its duration from (`pressDuration`: the
      // cast's target's first), to its REMOVED on that unit
      const dur = pressDuration(
        unit,
        press,
        ctx.units as ICombatUnit[],
        unit.spellCastEvents ?? [],
      );
      let life: number | undefined;
      if (dur) {
        const rows = ((dur.unit.auraEvents ?? []) as any[]).filter(
          (r) => r.srcUnitId === unit.id && r.spellId === dur.row.spellId,
        );
        const i = rows.indexOf(dur.row);
        const start = tsOf(dur.row);
        for (let j = i + 1; i >= 0 && j < rows.length; j++) {
          const r = rows[j];
          if (ev(r) === REMOVED) {
            life = (tsOf(r) - start) / 1000;
            break;
          }
          if ((ev(r) === APPLIED || ev(r) === REFRESH) && tsOf(r) > start)
            break;
        }
      }
      // a floor (`lasts 10s+`, Timewalker) holds no life to it
      if (
        dur?.floor !== true &&
        life !== undefined &&
        life > Number(lasts) + LASTS_SLACK_S
      )
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
