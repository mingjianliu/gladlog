/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, spellCastEvents) */
/**
 * scan5/t02.ts — pipeline T02 (fact12 D15 / D24 / D25): an enemy save's
 * `— its bolts hit X: Nk of the Mk …` clause, which the legend defines as
 * "a save that is a channel whose damage landed on our player" (Ultimate
 * Penitence), printed on a save that is no channel. Blazing Barrier's
 * reactive 235314 hits on a melee attacker read as channel bolts
 * (60bfdea9), and the barrier's Overpowered Barrier pulse 1220755 — a
 * talent's own id and name — was left out of the "bolts" total, 2k
 * printed for ~46k (bd7f386f 0:45, 1:01).
 *
 * Check `boltsClauseOnNoChannel`, kind `notAChannel`: an `[ENEMY DEF]` /
 * `[ENEMY CD]` line carrying the clause whose save — the caster's
 * SPELL_CAST_SUCCESS of the printed name nearest the line's second — is
 * no channel (`isChannelledPress`: DB2's channel attribute, or a
 * channelled cooldown whose press id is its shield, Ultimate Penitence
 * 421453). Counted: every clause line whose press row is found.
 */
import { isChannelledPress } from "@gladlog/analysis/src/context/timelineHelpers";

import { type IRoundCtx, nameOf, secOf, successesOf, tsOf } from "./ctx";

export const CHECKS = ["boltsClauseOnNoChannel"] as const;

const BOLTS_LINE =
  /^(\d+:\d\d)\s+\[ENEMY (?:DEF|CD)\]\s+(\d+)\([^)]*\) \([^)]*\): (.+?) \(.*— its bolts hit /;
/** the line's second is its aura's; the press row sits at or just before it */
const LEAD_MS = 2000;
const LAG_MS = 1000;

export function run(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    const m = BOLTS_LINE.exec(line);
    if (!m) continue;
    const caster = ctx.unitOfPid(m[2]);
    if (!caster) continue;
    const at = ctx.start + secOf(m[1]!) * 1000;
    const name = m[3]!.trim();
    const rows = successesOf(caster)
      .filter(
        (c: any) =>
          nameOf(c.spellId, c.spellName ?? "") === name &&
          tsOf(c) >= at - LEAD_MS &&
          tsOf(c) <= at + LAG_MS,
      )
      .sort(
        (a: any, b: any) => Math.abs(tsOf(a) - at) - Math.abs(tsOf(b) - at),
      );
    const press = rows[0];
    if (!press) continue;
    ctx.bump("boltsClauseOnNoChannel");
    const id = String(press.spellId);
    if (isChannelledPress(id)) continue;
    ctx.violate(
      "boltsClauseOnNoChannel",
      "notAChannel",
      tsOf(press),
      `${caster.name}:${id}:${tsOf(press)}`,
      `${name} ${id} is no channel`,
      line,
    );
  }
}
