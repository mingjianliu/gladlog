/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents) */
/**
 * scan5/t287.ts — pipeline T287 (audit-1215 06 D1, 2c832cac r0 1:29): our
 * side's `[YOU] / [TEAM] [PROC] X (no press)` line for an aura that went up
 * AFTER the round had ended. A Solo Shuffle round is over at its first player
 * death (`roundEndMs`); the press lane (the cooldown ledger) stops there, the
 * aura lane read on — the druid's Barkskin pressed 1:29.583, 0.49 s after the
 * hunter's death, had its press cut and its aura kept, and printed as a
 * proc.
 *
 *  - `ownNoPressLineAfterRoundEnd`: every our-side `[PROC] … (no press)` /
 *    `[CD] … (pressed; the log has only its aura)` line, each owner context.
 *    Read from the raw rows: the APPLIED / REFRESH rows of an aura of that
 *    English name (or put up by a cast of it) on the line's unit or cast by
 *    it (an external wall sits on its recipient), in the line's second — on
 *    to the log's end when that second holds the round's end. Kind:
 *      · `every such row after the round's end` (the total) — the aura went
 *        up after `roundEndMs`: no part of the round;
 *      · `no aura row of the name in the second` (out of the total) — the
 *        scan cannot place it (an effect aura under another name, an aura up
 *        before the log's first row at 0:00).
 */
import { castsOfEffectAura } from "@gladlog/analysis/src/data/castEffectAuras";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";

import {
  APPLIED,
  ev,
  type IRoundCtx,
  nameOf,
  REFRESH,
  secOf,
  tsOf,
} from "./ctx";

const A = "ownNoPressLineAfterRoundEnd";
export const CHECKS = [A] as const;
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  `${A}|no aura row of the name in the second`,
]);

const LINE_RE =
  /^(\d+:\d\d)\s+\[(YOU|TEAM)\] \[(?:PROC|CD)\]\s+(?:(\d+)\([^)]*\) \([^)]*\): )?(.+?)( \(no press\)| \(pressed; the log has only its aura\))$/;

export function run(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  const endAt = roundEndMs(ctx.legacy, ctx.players);
  for (const line of ctx.lines) {
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const unit = m[2] === "YOU" ? owner : ctx.unitOfPid(m[3]);
    if (!unit) continue;
    ctx.bump(A);
    const sec = secOf(m[1]!);
    const from = ctx.start + sec * 1000;
    const name = m[4]!;
    // the unit's own aura, or one it put on another (an external wall:
    // Pain Suppression, Time Dilation sit on the recipient); an APPLIED or
    // a REFRESH (a proc re-stating a running aura: Well-Honed Instincts'
    // Frenzied Regeneration, codex 85-tk-L6-T287-1 #3); by the aura's name
    // or the name of a cast that puts it up (Predator's Wake 1259431 is
    // The Hunt's, -1 #2). The line's second, and — when that second holds
    // the round's end, where a clamp puts the line — on to the log's end
    // (death 89.950, aura 90.583: a 1:29 line, -1 #2)
    const lineEndMs =
      Math.floor((endAt - ctx.start) / 1000) === sec ? ctx.end + 1 : from + 1000;
    const named = (a: any): boolean => {
      const sid = String(a.spellId ?? "");
      return (
        nameOf(sid, a.spellName ?? "") === name ||
        castsOfEffectAura(sid).some((c) => nameOf(c, "") === name)
      );
    };
    const rows = (ctx.units as any[])
      .flatMap((u) => (u.auraEvents ?? []) as any[])
      .filter(
        (a) =>
          (ev(a) === APPLIED || ev(a) === REFRESH) &&
          (a.destUnitId === unit.id || a.srcUnitId === unit.id) &&
          tsOf(a) >= from &&
          tsOf(a) < lineEndMs &&
          named(a),
      );
    const id = `${ctx.roundKey}|${unit.name}|${name}|${m[1]}`;
    if (rows.length === 0) {
      ctx.violate(
        A,
        "no aura row of the name in the second",
        from,
        id,
        `${m[1]} ${unit.name} ${name}${m[5]}: no APPLIED / REFRESH of the name in that second`,
        line.slice(0, 200),
      );
      continue;
    }
    if (rows.every((a) => tsOf(a) > endAt))
      ctx.violate(
        A,
        "every such row after the round's end",
        tsOf(rows[0]),
        id,
        `${m[1]} ${unit.name} ${name}${m[5]}: aura up ${((tsOf(rows[0]) - endAt) / 1000).toFixed(3)} s after the round's end (${((endAt - ctx.start) / 1000).toFixed(3)} s)`,
        line.slice(0, 200),
      );
  }
}
