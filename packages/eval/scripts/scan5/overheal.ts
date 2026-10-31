/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, healOut) */
/**
 * scan5/overheal.ts — class 13 of the round-7 audit (fact7 F21, D9): the
 * `[HEALING] … Overheal: N%` under a `[YOU] [CD]` line, against the owner's
 * heal rows on players inside the printed window. A heal on a pet keeps its
 * `amount` while its `effectiveAmount` is zeroed, so read together the whole
 * of it reads as overheal.
 *
 * Log truth: rows of the owner's `healOut` with a player destination, between
 * the printed spell's press and the last printed bucket's end. Violation:
 * printed differs from that share by more than `SLACK_PCT` (the window's edge
 * rows; the line prints whole percent).
 */
import { nameOf, type IRoundCtx, successesOf, tsOf } from "./ctx";

export const CHECKS = ["overhealPrinted"] as const;

const SLACK_PCT = 2;
const CD = /^\s*(\d+):(\d\d)\s+\[YOU\] \[CD\]\s+(.+?)(?: →| \(| \[|$)/;
const HEALING = /\[HEALING\]\s+(.*)\| Overheal: (\d+)%/;

export function run(ctx: IRoundCtx): void {
  let cd: { t: number; name: string } | undefined;
  const isPlayer = new Set(ctx.players.map((p) => p.id));
  for (const line of ctx.lines) {
    const c = CD.exec(line);
    if (c) {
      cd = { t: +c[1]! * 60 + +c[2]!, name: c[3]! };
      continue;
    }
    const h = HEALING.exec(line);
    if (!h || !cd) continue;
    const ends = [...h[1]!.matchAll(/–([\d.]+)s:/g)].map((m) => +m[1]!);
    const spanS = ends[ends.length - 1];
    if (spanS === undefined) continue;
    const lo = ctx.start + cd.t * 1000;
    const press = successesOf(ctx.owner).find(
      (e) =>
        tsOf(e) >= lo &&
        tsOf(e) < lo + 1000 &&
        nameOf(e.spellId, e.spellName) === cd!.name,
    );
    const fromMs = press ? tsOf(press) : lo;
    const toMs = fromMs + spanS * 1000;
    let amount = 0;
    let effective = 0;
    for (const r of (ctx.owner.healOut ?? []) as any[]) {
      if (tsOf(r) < fromMs || tsOf(r) > toMs) continue;
      if (!isPlayer.has(r.destUnitId)) continue;
      amount += r.amount;
      effective += r.effectiveAmount;
    }
    ctx.bump("overhealPrinted");
    if (amount <= 0) continue;
    const truth = ((amount - effective) / amount) * 100;
    const printed = +h[2]!;
    if (Math.abs(printed - truth) <= SLACK_PCT) continue;
    ctx.violate(
      "overhealPrinted",
      printed > truth ? "high" : "low",
      fromMs,
      `${cd.name}#${fromMs}`,
      `${cd.name}: printed ${printed}%, players only ${truth.toFixed(1)}%`,
      line,
    );
  }
}
