/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents) */
/**
 * scan5/t43.ts — ticket T43 (r12 D13, r12b N5): the `in Z.Zs` of a
 * `[BURST ANSWERED] … P answered with X on H (Ns) in Z.Zs` line is the gap
 * from the opener to the press that made X. Truth is the cast and aura rows
 * of the log.
 *
 *  - `answerTimedBeforeItsCast`: the answerer's aura named X went on H at or
 *    after the opener, the answerer's own SUCCESS row named X is logged up
 *    to 100 ms AFTER that aura (the log orders the two either way) with no
 *    cast of that name in the 3 s before it, and the printed Z is not the
 *    gap from the opener's cast row to that SUCCESS row (0.05 s for the
 *    printed digit). Kind = X. Counted: every line whose named control has
 *    such a cast-after-aura pair.
 */
import {
  APPLIED,
  ev,
  type IRoundCtx,
  nameOf,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["answerTimedBeforeItsCast"] as const;

const LINE =
  /^(\d+:\d{2})\s+\[BURST ANSWERED\]\s+enemy opened (.+?) (?:\(\+.*\) )?\((\d+)\([^)]*\)\): (\d+)\([^)]*\) answered with (.+?) on (\d+)\([^)]*\) \(.*?\) in (\d+\.\d)s;/;
const CAST_AFTER_AURA_MS = 100;
const FUSE_MS = 3000;
const ANSWER_WINDOW_MS = 8000;

export function run(ctx: IRoundCtx): void {
  const C = "answerTimedBeforeItsCast";
  for (const l of ctx.lines) {
    const m = LINE.exec(l);
    if (!m) continue;
    const opener = ctx.unitOfPid(m[3]);
    const answerer = ctx.unitOfPid(m[4]);
    const holder = ctx.unitOfPid(m[6]);
    if (!opener || !answerer || !holder) continue;
    const lineMs = ctx.start + secOf(m[1]!) * 1000;
    const open = successesOf(opener).find(
      (c) =>
        nameOf(c.spellId, c.spellName) === m[2] &&
        tsOf(c) >= lineMs &&
        tsOf(c) < lineMs + 1000,
    );
    if (!open) continue;
    const openMs = tsOf(open);
    const casts = successesOf(answerer).filter(
      (c) => nameOf(c.spellId, c.spellName) === m[5],
    );
    const aura = ((holder.auraEvents ?? []) as any[]).find(
      (a) =>
        ev(a) === APPLIED &&
        a.srcUnitId === answerer.id &&
        nameOf(a.spellId, a.spellName) === m[5] &&
        tsOf(a) >= openMs &&
        tsOf(a) <= openMs + ANSWER_WINDOW_MS + FUSE_MS,
    );
    if (!aura) continue;
    const at = tsOf(aura);
    if (casts.some((c) => tsOf(c) <= at && tsOf(c) >= at - FUSE_MS)) continue;
    const after = casts.find(
      (c) => tsOf(c) > at && tsOf(c) <= at + CAST_AFTER_AURA_MS,
    );
    if (!after) continue;
    ctx.bump(C);
    const expected = (tsOf(after) - openMs) / 1000;
    if (Math.abs(Number(m[7]) - expected) <= 0.0501) continue;
    ctx.violate(
      C,
      m[5]!,
      lineMs,
      `${m[1]}#${m[4]}#${m[5]}`,
      `printed in ${m[7]}s; ${m[5]}'s cast row is ${expected.toFixed(3)}s after the opener (its aura ${((at - openMs) / 1000).toFixed(3)}s)`,
      l.slice(0, 300),
    );
  }
}
