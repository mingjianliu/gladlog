/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, spellCastEvents) */
/**
 * scan5/t259.ts — ticket T259: a low-HP proc's activation that prints no
 * line because an earlier application of the aura it casts logged no
 * REMOVED. Well-Honed Instincts (377847) casts Frenzied Regeneration below
 * 40 % health and puts its marker 382912 (a 120 s debuff: the proc's own
 * once-per-120-s lockout) on the druid in the same batch; the proc logs no
 * cast row. 8416188b r1: pressed 20:01:57.596 (no REMOVED), re-listed in a
 * re-stating batch at 58.885, the proc at 20:02:02.347 — the head printed no
 * line for it (T134's re-listing test had no time bound).
 *
 *  - `procActivationNoLine`: per owner context, every NEW proc activation —
 *    of a proc whose spell is a save a line states (`SELF_SAVE_IDS`) —
 *    the marker's APPLIED (self → self) while the marker is not already up
 *    (no earlier APPLIED of it within its DB2 length with no REMOVED since:
 *    the lockout makes a second proc inside it impossible, so such a row is
 *    the log re-listing the marker), beside an APPLIED of an aura the proc
 *    casts within the proc's pairing — and no SPELL_CAST_SUCCESS of that
 *    spell around it (a press line covers it then). A violation when no
 *    press line (`[ENEMY DEF]`, `[YOU] [PROC]`, …) naming the spell on that
 *    unit lies within 1 s. Kind `<side>/<spell>`. Checked = such
 *    activations. Truth from the marker and the log rows only, never
 *    through `selfSaveCasts`.
 */
import { CRISIS_PROC_ANSWERS } from "@gladlog/analysis/src/data/crisisProcAnswers";
import { spellEffectData } from "@gladlog/analysis/src/data/spellEffectData";
import { SELF_SAVE_IDS } from "@gladlog/analysis/src/utils/enemyDefensives";
import { PROC_OWN_ACTIVATION_PAIR_MS } from "@gladlog/analysis/src/utils/procTriggeredCast";

import {
  APPLIED,
  ev,
  fmtS,
  type IRoundCtx,
  nameOf,
  REMOVED,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["procActivationNoLine"] as const;

const TIMED = /^\s*(\d+):(\d\d)\s/;
const PRESS_LINE =
  /\[(YOU|TEAM)\] \[(CD|CC|PROC|CAST)\]|\[ENEMY (CD|DEF|UTILITY|HEAL CD)\]/;
const FIRST_PID = /(?:^|\s)(\d+)\(/;
/** a cast row this close to the proc is a press, with its own line */
const PRESS_BEFORE_MS = 3000;
const PRESS_AFTER_MS = 1500;

export function run(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  const timed: { t: number; text: string }[] = [];
  for (const l of ctx.lines) {
    const m = TIMED.exec(l);
    if (m && PRESS_LINE.test(l))
      timed.push({ t: +m[1]! * 60 + +m[2]!, text: l });
  }
  for (const u of ctx.players as any[]) {
    const rows = (u.auraEvents ?? []) as any[];
    for (let i = 0; i < rows.length; i++) {
      const m = rows[i];
      const def = CRISIS_PROC_ANSWERS.get(String(m.spellId ?? ""));
      if (!def || def.via !== "aura" || ev(m) !== APPLIED) continue;
      if (m.srcUnitId !== u.id || m.destUnitId !== u.id) continue;
      const ms = tsOf(m);
      if (ms < ctx.start || ms > ctx.roundEndAt) continue;
      // the marker already up: a re-listing of it, no new proc
      const lockMs =
        (spellEffectData[String(m.spellId)]?.durationSeconds ?? 0) * 1000;
      let upSince: number | undefined;
      for (let k = 0; k < i; k++) {
        const b = rows[k];
        if (b.spellId !== m.spellId || b.destUnitId !== u.id) continue;
        if (ev(b) === REMOVED) upSince = undefined;
        else if (ev(b) === APPLIED && upSince === undefined) upSince = tsOf(b);
      }
      if (upSince !== undefined && ms - upSince <= lockMs) continue;
      for (const id of def.triggers) {
        // the saves a line states (`SELF_SAVE_IDS`): Blazing Speed, Second
        // Wind and Cheating Death are procs with no press line of their own
        if (!SELF_SAVE_IDS.has(id)) continue;
        const aura = rows.find(
          (a) =>
            String(a.spellId) === id &&
            ev(a) === APPLIED &&
            a.srcUnitId === u.id &&
            a.destUnitId === u.id &&
            Math.abs(tsOf(a) - ms) <= PROC_OWN_ACTIVATION_PAIR_MS,
        );
        if (!aura) continue;
        if (
          successesOf(u).some(
            (c) =>
              String(c.spellId) === id &&
              tsOf(c) >= ms - PRESS_BEFORE_MS &&
              tsOf(c) <= ms + PRESS_AFTER_MS,
          )
        )
          continue;
        ctx.bump("procActivationNoLine");
        const name = nameOf(id);
        const t = Math.floor((ms - ctx.start) / 1000);
        const isOwner = u.id === ctx.owner.id;
        const named = timed.some(
          (l) =>
            Math.abs(l.t - t) <= 1 &&
            l.text.includes(name) &&
            (isOwner
              ? l.text.includes("[YOU]")
              : ctx.unitOfPid(FIRST_PID.exec(l.text)?.[1])?.id === u.id),
        );
        if (named) continue;
        const side = isOwner
          ? "owner"
          : u.info?.teamId === ctx.owner.info?.teamId
            ? "ally"
            : "enemy";
        ctx.violate(
          "procActivationNoLine",
          `${side}/${name}`,
          ms,
          `${ctx.roundKey}|${u.id}|${id}|${t}`,
          `${side}: ${def.name} cast ${name} on ${u.name} at ${fmtS(t)} (no cast row), no line`,
        );
      }
    }
  }
}
