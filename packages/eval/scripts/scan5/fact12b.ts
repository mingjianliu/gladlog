/* eslint-disable @typescript-eslint/no-explicit-any -- scan over raw parse output */
/**
 * fact12b (pipeline 2026-11-07) class check.
 *
 *  - hpStaleMaxStepUp (T09, fact12 A15/B19): a max-HP step UP whose new
 *    current the log wrote before its new max — Fortifying Brew, Rallying
 *    Cry, Power Word: Fortitude going on add the grant to the current at
 *    once, and the rows up to the next max still carry the old one.
 *    cf63da4a r0 1:43.534: 665,067 / 1,057,720 = 63 % one row after
 *    453,513 / 1,057,720 = 42.9 %, the next row 1,269,274 max: the brew's
 *    +211,554 is in the current, not in the max — the reading is 52 %.
 *
 *    Truth from the unit's own HP rows: a row of max m0 within
 *    `LOOKBACK_MS` before the first row of max m1 > m0 whose current rose
 *    off the row before it by the grant (m1 − m0, within `GRANT_SLACK`),
 *    once the heals and hits logged between the two are taken out (in the
 *    log's line order — the product's `amountLoggedBetween`, codex P2 on
 *    attempt 1: 197491d6 r1 85.187, an 81,677 Chain Heal in the first row's
 *    own millisecond logged after it is the rise); it and
 *    every later m0 row before the step are on the m1 scale. Violation: the
 *    product's reading of such a row (`hpReadingMaxHp`, rounded, clamped at
 *    100) is not its current over m1. Counted: every such row whose two
 *    scales round apart. Once per round (the rows are owner-independent).
 */
import {
  amountLoggedBetween,
  hpReadingMaxHp,
  STALE_MAX_HP_GRANT_SLACK as GRANT_SLACK,
  STALE_MAX_HP_LOOKBACK_MS as LOOKBACK_MS,
} from "@gladlog/analysis/src/utils/advancedActions";

import { type IRoundCtx, tsOf } from "./ctx";

export const CHECKS = ["hpStaleMaxStepUp"] as const;

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  hpStaleMaxStepUp(ctx);
}

const pctOf = (cur: number, max: number) =>
  Math.min(100, Math.round((100 * cur) / max));

function hpStaleMaxStepUp(ctx: IRoundCtx): void {
  for (const u of ctx.players) {
    const rows = ((u.advancedActions ?? []) as any[])
      .filter((a) => a.advancedActorId === u.id && a.advancedActorMaxHp > 0)
      .sort((a, b) => tsOf(a) - tsOf(b));
    for (let j = 1; j < rows.length; j++) {
      const m0 = rows[j - 1].advancedActorMaxHp;
      const m1 = rows[j].advancedActorMaxHp;
      if (m1 <= m0) continue;
      const grant = m1 - m0;
      const stepMs = tsOf(rows[j]);
      // the latest m0 row in the window whose rise is the grant
      let i = -1;
      for (
        let k = j - 1;
        k > 0 &&
        rows[k].advancedActorMaxHp === m0 &&
        rows[k - 1].advancedActorMaxHp === m0 &&
        stepMs - tsOf(rows[k]) <= LOOKBACK_MS;
        k--
      ) {
        const rise =
          rows[k].advancedActorCurrentHp -
          rows[k - 1].advancedActorCurrentHp +
          amountLoggedBetween(u.damageIn, rows[k - 1], rows[k]) -
          amountLoggedBetween(u.healIn, rows[k - 1], rows[k]);
        if (Math.abs(rise - grant) <= GRANT_SLACK * grant) {
          i = k;
          break;
        }
      }
      if (i < 0) continue;
      for (let k = i; k < j; k++) {
        const r = rows[k];
        const cur = r.advancedActorCurrentHp;
        const truth = pctOf(cur, m1);
        if (pctOf(cur, m0) === truth) continue;
        ctx.bump("hpStaleMaxStepUp");
        const read = pctOf(cur, hpReadingMaxHp(u, r));
        if (read === truth) continue;
        const atS = (tsOf(r) - ctx.start) / 1000;
        ctx.violate(
          "hpStaleMaxStepUp",
          read === pctOf(cur, m0) ? "read on the old max" : "other reading",
          tsOf(r),
          `${u.name}:${tsOf(r)}`,
          `${u.name} ${atS.toFixed(3)}s: ${cur} / ${m0} = ${pctOf(cur, m0)}, max ${m1} from ${((stepMs - ctx.start) / 1000).toFixed(3)}s (+${grant}) → ${truth}; read ${read}`,
        );
      }
    }
  }
}
