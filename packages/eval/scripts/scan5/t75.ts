/**
 * scan5/t75.ts — ticket T75 (GH #141 item 3a): whom a KITED span was
 * measured to. The KITED line (`m:ss [X burst] opened A→Byd from <enemy>
 * (peak at m:ss)`) prints no span end, so the positioning gate's G4d read
 * STAYED IN lines only. The span is the evaluated part of the burst window
 * the timeline prints as `[OFFENSIVE WINDOW] a–b` at the line's start
 * second (`burstEvalEndSeconds`), and the gate now rebuilds it from there.
 *
 *  - `kitedMeasuredEnemy`: the gate's own G4d (`extractGeoClaims` →
 *    `checkGeoClaims`, which calls the producer's `spanMeasuredEnemy`) over
 *    every KITED line of the context. Counted: a line the gate could rebuild
 *    a span for and whose span has a measured enemy. Violation `named`: the
 *    line names another enemy (or carries a second one at its peak).
 *    Out of the total, counted as kinds for the report: `noHeader` (no
 *    `[OFFENSIVE WINDOW]` header starts in the line's second, or two do —
 *    the line stays unchecked) and `fallback` (the span has no measured
 *    enemy: no enemy damage, a tie, or no distance at an end — the line is
 *    on the nearest-enemy rule and names no one the gate can hold it to).
 *
 * This module runs the gate; it derives nothing of its own.
 */
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";

import {
  checkGeoClaims,
  extractGeoClaims,
} from "../../src/quality/positioningScan";
import { type IRoundCtx } from "./ctx";

export const CHECKS = ["kitedMeasuredEnemy"] as const;
const C = "kitedMeasuredEnemy";
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  `${C}|noHeader`,
  `${C}|fallback`,
]);

const KITED_LINE = /^ +\d+:\d{2} \[[^\]]+ burst\] opened /;

export function run(ctx: IRoundCtx): void {
  if (!ctx.owner || !ctx.lines.some((l) => KITED_LINE.test(l))) return;
  const { claims, unitIdMap } = extractGeoClaims(ctx.lines.join("\n"));
  const identity = claims.filter(
    (c) => c.kind === "MEASURED_ENEMY" && KITED_LINE.test(c.raw),
  );
  const rebuilt = new Set(identity.map((c) => c.lineNo));
  const geo = {
    owner: ctx.owner,
    friends: ctx.players.filter((u) => u.reaction === ctx.owner.reaction),
    enemies: ctx.players.filter((u) => u.reaction !== ctx.owner.reaction),
    zoneId: String(ctx.legacy.startInfo?.zoneId ?? ""),
    matchStartMs: ctx.start,
    unitIdMap,
    units: ctx.units,
    roundEndAtMs: roundEndMs(ctx.legacy),
  };
  ctx.lines.forEach((l, i) => {
    if (!KITED_LINE.test(l)) return;
    const at = /^ +(\d+):(\d{2}) /.exec(l)!;
    const ms = ctx.start + (Number(at[1]) * 60 + Number(at[2])) * 1000;
    const fact = `${ctx.owner.name}:${at[1]}:${at[2]}`;
    if (!rebuilt.has(i + 1)) {
      ctx.violate(C, "noHeader", ms, fact, "no single burst header", l);
      return;
    }
    const own = identity.filter((c) => c.lineNo === i + 1);
    const r = checkGeoClaims(own, geo);
    if (r.checked === 0) {
      ctx.violate(C, "fallback", ms, fact, "no measured enemy in the span", l);
      return;
    }
    ctx.bump(C);
    for (const v of r.violations)
      ctx.violate(C, "named", ms, fact, v.detail, l);
  });
}
