/**
 * scan5/t233.ts — pipeline T233 (batch review 80-PIPE-170d-B156 note 2), an
 * inventory: every double-wall overlap the product detects
 * (`detectOverlappedDefensives`, read by `healerMetrics` only) with the
 * seconds it says the two walls were up together. Run on two trees and
 * compared row by row, it says how many detections a change of the overlap
 * reading drops and how many it shortens. Each side of a round once; nothing
 * is counted as a violation.
 */
import { detectOverlappedDefensives } from "@gladlog/analysis/src/utils/cooldowns";
import type { ICombatUnit } from "@gladlog/parser-compat";

import type { IRoundCtx } from "./ctx";

const C = "doubleWallOverlapInventory";
export const CHECKS = [C] as const;
const KIND = "overlap";
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([`${C}|${KIND}`]);

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  const players = ctx.players as ICombatUnit[];
  const sides = new Map<number, ICombatUnit[]>();
  for (const p of players)
    sides.set(p.reaction, [...(sides.get(p.reaction) ?? []), p]);
  for (const side of sides.values())
    for (const o of detectOverlappedDefensives(side, {
      startTime: ctx.start,
    } as never)) {
      ctx.bump(C);
      ctx.violate(
        C,
        KIND,
        ctx.start + o.timeSeconds * 1000,
        `${o.targetUnitId}#${o.firstSpellId}#${o.firstCasterName}#${o.secondSpellId}#${o.secondCasterName}#${Math.round(o.secondCastTimeSeconds * 1000)}`,
        `sim=${o.simultaneousSeconds.toFixed(3)} ${o.firstSpellName} + ${o.secondSpellName}`,
      );
    }
}
