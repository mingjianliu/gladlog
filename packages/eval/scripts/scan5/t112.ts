/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, missesIn) */
/**
 * scan5/t112.ts — ticket T112 (fact13 D8): a `[CC AVOIDED?]` line resting on
 * the log's own failed-control row (`… logged IMMUNE`) is that row's outcome,
 * so it prints the row's second — the gate (`checkCcAvoidedLandedConsistency`)
 * already centres such a line on its own second. 26c4ac25 r0: a Song of
 * Chi-Ji cast at 1:38.03 travelled to its target and logged IMMUNE there at
 * 1:39.59; the line printed 1:38 (the cast), while the same cast's IMMUNE on
 * another player printed at its own row, 1:41.
 *
 *  - `loggedLineOffItsRow`: a `[CC AVOIDED?] P: X (by …) logged T` line with
 *    no T miss row of X (by its English name) on P in the line's second.
 */
import { type IRoundCtx, nameOf } from "./ctx";

export const CHECKS = ["loggedLineOffItsRow"] as const;

const LINE_RE =
  /^(\d+):(\d\d)\s+\[CC AVOIDED\?\]\s+(\d+)\([^)]*\): (.+?) \(by (.+?)\) logged ([A-Z]+)/;

export function run(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    const m = LINE_RE.exec(line.trim());
    if (!m) continue;
    const C = "loggedLineOffItsRow";
    const lineS = Number(m[1]) * 60 + Number(m[2]);
    const unit = ctx.unitOfPid(m[3]);
    if (!unit) continue;
    const spell = m[4]!;
    const type = m[6]!;
    ctx.bump(C);
    const rows = (unit.missesIn ?? []).filter(
      (r: any) =>
        r.missType === type && nameOf(r.spellId, r.spellName ?? "") === spell,
    );
    const secOf = (r: any) => Math.floor((r.timestamp - ctx.start) / 1000);
    if (rows.some((r: any) => secOf(r) === lineS)) continue;
    const later = rows.find(
      (r: any) => secOf(r) > lineS && secOf(r) <= lineS + 10,
    );
    ctx.violate(
      C,
      spell,
      ctx.start + lineS * 1000,
      `${m[3]}#${spell}#${lineS}`,
      later
        ? `the ${type} row of ${spell} on ${m[3]} is at ${secOf(later)} s, the line at ${lineS} s`
        : `no ${type} row of ${spell} on ${m[3]} in the line's second`,
      line.trim().slice(0, 300),
    );
  }
}
