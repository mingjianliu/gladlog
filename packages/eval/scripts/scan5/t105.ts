/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents) */
/**
 * scan5/t105.ts — ticket T105 (fact13 D23): a KILL ATTEMPTS line's
 * `softer target then: X — TIER` names an enemy that could be killed at the
 * attempt's start. Truth is X's own aura rows.
 *
 *  - `softerTargetImmune`: X carried a FULL immunity (`FULL_IMMUNITY_IDS` —
 *    a table lookup: Divine Shield, Ice Block, Aspect of the Turtle) from its
 *    APPLIED row to the REMOVED that closes it across the whole first printed
 *    second of the bracket (e2047b8b-r0 1:21: Divine Shield up 1:15.6–1:23.6,
 *    the line named its paladin `PRIME`). Covering the whole second keeps the
 *    scan on the rendering grid: the producer reads the exact start instant.
 *    Counted: every line naming a softer target.
 */
import { FULL_IMMUNITY_IDS } from "@gladlog/analysis/src/utils/enemyDefensives";

import { APPLIED, ev, type IRoundCtx, REMOVED, secOf, tsOf } from "./ctx";

export const CHECKS = ["softerTargetImmune"] as const;

const LINE =
  /^ {2}\[(\d+:\d{2})–(\d+:\d{2})\] on (\S+) — .*softer target then: (\S+) — ([A-Z]+)/;

export function run(ctx: IRoundCtx): void {
  for (const l of ctx.lines) {
    const m = LINE.exec(l);
    if (!m) continue;
    const x = ctx.byName.get(m[4]!);
    if (!x) continue;
    ctx.bump("softerTargetImmune");
    const lo = ctx.start + secOf(m[1]!) * 1000;
    const hi = lo + 1000;
    const rows = ((x.auraEvents ?? []) as any[])
      .filter(
        (a) =>
          a.destUnitId === x.id && FULL_IMMUNITY_IDS.has(String(a.spellId)),
      )
      .sort((a, b) => tsOf(a) - tsOf(b));
    const covering = rows.find((a) => {
      if (ev(a) !== APPLIED || tsOf(a) > lo) return false;
      const end = rows.find(
        (r) =>
          ev(r) === REMOVED &&
          String(r.spellId) === String(a.spellId) &&
          tsOf(r) >= tsOf(a),
      );
      return (end ? tsOf(end) : Infinity) >= hi;
    });
    if (!covering) continue;
    const end = rows.find(
      (r) =>
        ev(r) === REMOVED &&
        String(r.spellId) === String(covering.spellId) &&
        tsOf(r) >= tsOf(covering),
    );
    ctx.violate(
      "softerTargetImmune",
      String(covering.spellName ?? covering.spellId),
      lo,
      `${m[3]}:${m[1]}`,
      `${m[4]} (${m[5]}) carried ${covering.spellName ?? covering.spellId} from ${((tsOf(covering) - ctx.start) / 1000).toFixed(1)}s to ${end ? ((tsOf(end) - ctx.start) / 1000).toFixed(1) + "s" : "the round's end"}`,
      l,
    );
  }
}
