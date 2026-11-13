/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, spellCastEvents, auraEvents) */
/**
 * scan5/offListPress.ts — GH #176: the numbers a `[PRESS]` line prints,
 * against the log rows (user ruling 2026-11-02: every talent's effect on the
 * cooldown and the duration worked out before the line is printed).
 *
 * Check `offListPressLine`, kinds:
 *  - `noPress`: no SPELL_CAST_SUCCESS of the named spell by that unit in the
 *    line's second (a button whose press logs only its aura —
 *    `NO_CAST_LOG_PRESS_IDS`, fact11 D42 — the ledger's aura-read press);
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
 *    it;
 *    …unless the log went silent across the printed end and the REMOVED
 *    sits in the burst that ended the silence (`stallAcross`, out of the
 *    total as `lastsLogStall`: GH #179, 5b724629 r5 Explosive Shot — no row
 *    from anyone for 2.6 s over its 4 s end, the REMOVED 0.2 s into the
 *    383-row burst after it); the end the log shows is the flush, not the
 *    aura's;
 *  - a next press after the round's end of play (`roundEndAt`) is no next
 *    press: a Solo Shuffle round's rows run into the next round's
 *    preparation, where Arena Preparation resets every cooldown (GH #179,
 *    c5b55e06 r1 Camouflage, 7b07c1de r1 Dream Breath);
 *  - `lastsOvershoot` (out of the total — a diagnostic): `lasts Ns`, and that
 *    row's aura was REMOVED (not broken, not dispelled) before half of N
 *    and more than `LASTS_SLACK_S` short of it. An aura may end early — a
 *    consumed buff, a cancel — so this is no violation on its own; it ranks
 *    the spells whose printed length the log never comes near (a toy's
 *    3,600 s, a channel read for a HoT), GH #179 batch 3d's overshoot gate.
 * Truth is the log's rows; the parse of the line is the only shared part.
 */
import { NO_CAST_LOG_PRESS_IDS } from "@gladlog/analysis/src/data/auraActivation";
import { SHARED_CHARGE_CATEGORY } from "@gladlog/analysis/src/data/sharedChargeGenerated";
import { effectiveCooldownSeconds } from "@gladlog/analysis/src/data/spellEffectData";
import {
  timeSpiralEchoMs,
  timeSpiralFreePressMs,
} from "@gladlog/analysis/src/data/talentScriptedCooldowns";
import { isStasisReplayCast } from "@gladlog/analysis/src/utils/combatStates";
import {
  auraOnlyActivationSeconds,
  unreleasedHoldMs,
} from "@gladlog/analysis/src/utils/cooldowns";
import { SAVE_CAST_AURA_PAIR_S } from "@gladlog/analysis/src/utils/enemyDefensives";
import { pressDuration } from "@gladlog/analysis/src/utils/offListPress";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

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
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "offListPressLine|lastsOvershoot",
  "offListPressLine|lastsLogStall",
]);

const PRESS_LINE =
  /^\s*(\d+:\d\d)\s+(\[YOU\] )?\[PRESS\]\s+(?:(\d+)\([^)]*\) \([^)]*\): )?(.+) \(([^()]*)\)\s*$/;
/** the back time may sit this far before the next press: a floored row */
const BACK_SLACK_MS = 2000;
/** an aura's logged life this far past the printed length is beyond it */
const LASTS_SLACK_S = 0.65;
/** a silence of the whole log this long is a stall (6 players and their
 * pets write rows every few hundred ms) */
const STALL_MS = 1000;
/** the REMOVED this close after a stall's end is in the burst that flushed it */
const STALL_BURST_MS = 500;

const rowTimesCache = new WeakMap<object, number[]>();
/** every row time of the round's units, ascending (the log's own clock):
 * every row list a unit carries — every array on it, not a hand list: a
 * swing's miss, an absorb or a heal-absorb row is not mirrored into
 * `actionIn` / `actionOut`, and a list left out reads as silence (codex
 * reviews) */
function rowTimes(ctx: IRoundCtx): number[] {
  const key = ctx.units as object;
  const hit = rowTimesCache.get(key);
  if (hit) return hit;
  const out: number[] = [];
  for (const u of ctx.units as any[])
    for (const list of Object.values(u))
      if (Array.isArray(list))
        for (const r of list as any[]) {
          const t = r && typeof r === "object" ? tsOf(r) : undefined;
          if (typeof t === "number") out.push(t);
        }
  out.sort((a, b) => a - b);
  rowTimesCache.set(key, out);
  return out;
}
/** a silence of the log (≥ `STALL_MS`, no row from anyone) that began at or
 * before `endMs` and ended after it, with `removedMs` in the burst that
 * ended it: the REMOVED's time is the flush, the aura's own end unseen */
function stallAcross(
  ctx: IRoundCtx,
  endMs: number,
  removedMs: number,
): { fromMs: number; toMs: number } | undefined {
  const ts = rowTimes(ctx);
  for (let i = 1; i < ts.length; i++) {
    const p = ts[i - 1]!;
    const q = ts[i]!;
    if (q <= endMs) continue;
    if (p > endMs) return undefined;
    if (q - p >= STALL_MS && removedMs >= q && removedMs - q <= STALL_BURST_MS)
      return { fromMs: p, toMs: q };
  }
  return undefined;
}

/** fact11 D42: a button whose press logs only its own aura
 * (`NO_CAST_LOG_PRESS_IDS` — Rain from Above, DB2 NO_CAST_LOG): the
 * ledger's own reading of those presses (`auraOnlyActivationSeconds`), as
 * press rows of the button */
function auraOnlyPressRows(unit: any, name: string, ctx: IRoundCtx): any[] {
  return [...NO_CAST_LOG_PRESS_IDS]
    .filter((id) => nameOf(id) === name)
    .flatMap((id) =>
      auraOnlyActivationSeconds(unit, id, ctx.start, ctx.roundEndAt)
        .map((t) => ctx.start + t * 1000)
        // a logged press beside it is that press
        .filter(
          (ms) =>
            !successesOf(unit).some(
              (c) =>
                String(c.spellId) === id &&
                Math.abs(tsOf(c) - ms) <= SAVE_CAST_AURA_PAIR_S * 1000,
            ),
        )
        .map((ms) => ({
          spellId: id,
          spellName: name,
          logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: ms },
        })),
    );
}

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
      ? [...successesOf(unit), ...auraOnlyPressRows(unit, name, ctx)]
          .filter(
            (c) =>
              nameOf(c.spellId, c.spellName) === name &&
              (effectiveCooldownSeconds(String(c.spellId)) ?? 0) > 0 &&
              !isStasisReplayCast(unit, String(c.spellId), tsOf(c)),
          )
          .sort((a, b) => tsOf(a) - tsOf(b))
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
            tsOf(r) <= ctx.roundEndAt &&
            !freeRows.has(r) &&
            !timeSpiralFreePressMs(unit, String(r.spellId), [tsOf(r)]).length,
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
        // the producer's own bound (`buildMatchContext`), not the scan's
        // end of play
        roundEndMs(ctx.legacy as never),
      );
      let life: number | undefined;
      let removedMs: number | undefined;
      let removedClean = false;
      // one aura of the effect, from its row to its REMOVED on that unit
      const endOf = (
        from: any,
      ): { removedMs: number; clean: boolean } | undefined => {
        const rows = ((dur!.unit.auraEvents ?? []) as any[]).filter(
          (r) => r.srcUnitId === from.srcUnitId && r.spellId === from.spellId,
        );
        const i = rows.indexOf(from);
        const start = tsOf(from);
        for (let j = i + 1; i >= 0 && j < rows.length; j++) {
          const r = rows[j];
          if (ev(r) === REMOVED)
            return {
              removedMs: tsOf(r),
              // a REMOVED of the press's own millisecond, logged after the
              // APPLIED, may end the previous instance (a Between the Eyes
              // re-press re-merges): no overshoot reading off it
              // …and none a purge or a steal took (codex 20-179d #2: those
              // rows sit in the unit's actions, naming the aura as
              // extraSpellId)
              clean:
                tsOf(r) > start &&
                !((dur!.unit as any).actionIn ?? []).some(
                  (x: any) =>
                    (ev(x) === "SPELL_DISPEL" || ev(x) === "SPELL_STOLEN") &&
                    String(x.extraSpellId) === String(from.spellId) &&
                    Math.abs(tsOf(x) - tsOf(r)) <= 50,
                ),
            };
          if (/BROKEN|DISPEL|STOLEN/.test(String(ev(r))) && tsOf(r) >= start)
            return undefined;
          // …or a later press stacks on it (Between the Eyes: each press a
          // stack of its own length, the aura ends with the last)
          if (
            (ev(r) === APPLIED ||
              ev(r) === REFRESH ||
              ev(r) === LogEvent.SPELL_AURA_APPLIED_DOSE) &&
            tsOf(r) > start
          )
            return undefined;
        }
        return undefined;
      };
      if (dur) {
        // the row the length was read from, then the series it heads
        // (`pressDuration` followUps — the printed length covers them, so
        // the life does: codex 85-tk-G-T40-1 #5, a 12.0 s Cheetah read
        // "removed after 3.0s" against `lasts 12s`). A follow-up the log
        // shows and never closes leaves no life to read.
        let end = endOf(dur.row);
        for (const f of dur.followUps) {
          if (!end || !f.applied) break;
          end = endOf(f.applied);
        }
        if (end) {
          removedMs = end.removedMs;
          life = (end.removedMs - tsOf(dur.row)) / 1000;
          removedClean = end.clean;
        }
      }
      // a floor (`lasts 10s+`, Timewalker) holds no life to it
      const beyond =
        dur?.floor !== true &&
        life !== undefined &&
        life > Number(lasts) + LASTS_SLACK_S;
      // the printed end itself, as the life above measures it (from the
      // row read): the silence must open at or before it — the slack is the
      // overshoot's allowance only, never a window a silence may start in
      // (codex review)
      const stall =
        beyond && dur && removedMs !== undefined
          ? stallAcross(ctx, tsOf(dur.row) + Number(lasts) * 1000, removedMs)
          : undefined;
      if (stall)
        ctx.violate(
          "offListPressLine",
          "lastsLogStall",
          at,
          `${ctx.roundKey}|${unit.id}|${name}|${second}`,
          `${unit.name} ${name} at ${fmtS(second)}: lasts ${lasts}s printed, REMOVED after ${life!.toFixed(1)}s, ${((stall.toMs - stall.fromMs) / 1000).toFixed(1)}s log silence before it`,
          line,
        );
      else if (beyond)
        ctx.violate(
          "offListPressLine",
          "lastsBeyond",
          at,
          `${ctx.roundKey}|${unit.id}|${name}|${second}`,
          `${unit.name} ${name} at ${fmtS(second)}: lasts ${lasts}s printed, lived ${life!.toFixed(1)}s`,
          line,
        );
      if (
        dur?.floor !== true &&
        removedClean &&
        life !== undefined &&
        life < Number(lasts) / 2 &&
        life < Number(lasts) - LASTS_SLACK_S
      )
        ctx.violate(
          "offListPressLine",
          "lastsOvershoot",
          at,
          `${ctx.roundKey}|${unit.id}|${name}|${second}`,
          `${unit.name} ${name} at ${fmtS(second)}: lasts ${lasts}s printed, removed after ${life.toFixed(1)}s`,
          line,
        );
    }
  }
}
