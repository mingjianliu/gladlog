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
 *  - `procActivationNoLine`: per owner context, every NEW proc activation
 *    on an enemy (the `[ENEMY DEF]` lines `selfSaveCasts` feeds) of a proc
 *    whose spell is a save a line states (`SELF_SAVE_IDS`): the marker's
 *    APPLIED (self → self) while the marker is not already up — no APPLIED
 *    that started a run of it (or REFRESH) within its DB2 length + 1 s
 *    before, with no REMOVED since, and no re-broadcast (the lockout makes a
 *    second proc inside it impossible, so such a row is the log re-listing
 *    the marker; a run past its length is over, and the next APPLIED starts
 *    a new one) — beside an APPLIED or REFRESH (a proc on an aura already up,
 *    12dc512f r3) of an aura the proc casts within the proc's pairing. A violation when no
 *    `[ENEMY DEF]` line naming the spell with the no-press tag
 *    (`ENEMY_DEF_NO_PRESS_TAG`) on that unit lies within 1 s: the proc's
 *    own line, whatever press stands beside it (18e3feae r4: the proc 0:41,
 *    the player's press 0:42 with its own line — codex 85-mac-minifix-T259-1
 *    #2). Kind `enemy/<spell>`. Checked = such activations. Truth from the
 *    marker and the log rows only, never through `selfSaveCasts`.
 */
import { CRISIS_PROC_ANSWERS } from "@gladlog/analysis/src/data/crisisProcAnswers";
import { spellEffectData } from "@gladlog/analysis/src/data/spellEffectData";
import { AURA_REBROADCAST_GAP_MS } from "@gladlog/analysis/src/utils/auraRebroadcast";
import {
  ENEMY_DEF_NO_PRESS_TAG,
  SELF_SAVE_IDS,
} from "@gladlog/analysis/src/utils/enemyDefensives";
import { PROC_OWN_ACTIVATION_PAIR_MS } from "@gladlog/analysis/src/utils/procTriggeredCast";

import {
  APPLIED,
  ev,
  fmtS,
  type IRoundCtx,
  nameOf,
  REFRESH,
  REMOVED,
  tsOf,
} from "./ctx";

export const CHECKS = ["procActivationNoLine"] as const;

const TIMED = /^\s*(\d+):(\d\d)\s/;
const FIRST_PID = /(?:^|\s)(\d+)\(/;

export function run(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  const timed: { t: number; text: string }[] = [];
  for (const l of ctx.lines) {
    const m = TIMED.exec(l);
    if (m && l.includes("[ENEMY DEF]") && l.includes(ENEMY_DEF_NO_PRESS_TAG))
      timed.push({ t: +m[1]! * 60 + +m[2]!, text: l });
  }
  for (const u of ctx.players as any[]) {
    if (u.info?.teamId === ctx.owner.info?.teamId) continue;
    const rows = (u.auraEvents ?? []) as any[];
    for (let i = 0; i < rows.length; i++) {
      const m = rows[i];
      const def = CRISIS_PROC_ANSWERS.get(String(m.spellId ?? ""));
      if (!def || def.via !== "aura" || ev(m) !== APPLIED) continue;
      if (m.srcUnitId !== u.id || m.destUnitId !== u.id) continue;
      const ms = tsOf(m);
      if (ms < ctx.start || ms > ctx.roundEndAt) continue;
      // the marker already up: a re-listing of it, no new proc. Its
      // lockout is its DB2 length + the log's lost-REMOVED slack (1 s), from
      // the row that started its run or its latest REFRESH; a REMOVED ends
      // it — unless the APPLIED follows it within the re-broadcast gap (the
      // same aura, re-broadcast)
      const lockMs =
        ((spellEffectData[String(m.spellId)]?.durationSeconds ?? 0) + 1) * 1000;
      let upSince: number | undefined;
      let removedAt: number | undefined;
      for (let k = 0; k < i; k++) {
        const b = rows[k];
        if (b.spellId !== m.spellId || b.destUnitId !== u.id) continue;
        if (ev(b) === REMOVED) {
          upSince = undefined;
          removedAt = tsOf(b);
        } else if (ev(b) === REFRESH) upSince = tsOf(b);
        else if (
          ev(b) === APPLIED &&
          (upSince === undefined || tsOf(b) - upSince > lockMs)
        )
          upSince = tsOf(b);
      }
      if (upSince !== undefined && ms - upSince <= lockMs) continue;
      if (
        upSince === undefined &&
        removedAt !== undefined &&
        ms - removedAt >= 0 &&
        ms - removedAt <= AURA_REBROADCAST_GAP_MS
      )
        continue;
      for (const id of def.triggers) {
        // the saves a line states (`SELF_SAVE_IDS`): Blazing Speed, Second
        // Wind and Cheating Death are procs with no press line of their own
        if (!SELF_SAVE_IDS.has(id)) continue;
        const aura = rows.find(
          (a) =>
            String(a.spellId) === id &&
            // a proc that fires while the aura is up refreshes it (12dc512f r3)
            (ev(a) === APPLIED || ev(a) === REFRESH) &&
            a.srcUnitId === u.id &&
            a.destUnitId === u.id &&
            Math.abs(tsOf(a) - ms) <= PROC_OWN_ACTIVATION_PAIR_MS,
        );
        if (!aura) continue;
        ctx.bump("procActivationNoLine");
        const name = nameOf(id);
        const t = Math.floor((ms - ctx.start) / 1000);
        const named = timed.some(
          (l) =>
            Math.abs(l.t - t) <= 1 &&
            l.text.includes(name) &&
            ctx.unitOfPid(FIRST_PID.exec(l.text)?.[1])?.id === u.id,
        );
        if (named) continue;
        ctx.violate(
          "procActivationNoLine",
          `enemy/${name}`,
          ms,
          `${ctx.roundKey}|${u.id}|${id}|${t}`,
          `enemy: ${def.name} cast ${name} on ${u.name} at ${fmtS(t)} (no cast row), no line`,
        );
      }
    }
  }
}
