/* eslint-disable @typescript-eslint/no-explicit-any -- the legacy parse objects are untyped */
/**
 * scan5/t183.ts — ticket T183 (fact14 D23): a burst window's pressured
 * trough (`[BURST ANSWERED] … bottomed at N%`, slow-defensive-response
 * `pressuredHpPct`) is read to the window's outcome horizon, which a lapse
 * in the damage can close while the opener's own buff runs on; the unit
 * then drops lower under the same buff and the line states the earlier,
 * higher reading (ae1d0895 2:27: `bottomed at 55%`, 49 % ten seconds later
 * with the Avenging Wrath still up).
 *
 *  - `troughStopsBeforeBuffEnd`: a judged window (feasible, triaged, a
 *    pressured friendly with a trough) whose pressured unit reads LOWER on
 *    the grid in a second after the outcome horizon and no later than the
 *    last second one of the window's own buffs was running (the producer's
 *    `buffRunEndSec`), the unit alive, the round not over. Kind = whether a
 *    later window of the same round opens before that second, and whether
 *    the window was answered. Counted: every judged window with a trough.
 */
import { burstWindowDecisionPoints } from "@gladlog/analysis/src/analysis/burstWindowDecisionPoints";
import {
  gridHpPct,
  isDeadAtRenderSecond,
  isHealerSpec,
} from "@gladlog/analysis/src/utils/cooldowns";

import type { IRoundCtx } from "./ctx";

export const CHECKS = ["troughStopsBeforeBuffEnd"] as const;

export function run(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner || !isHealerSpec(owner.spec)) return;
  let points: ReturnType<typeof burstWindowDecisionPoints>;
  try {
    points = burstWindowDecisionPoints(ctx.legacy, {
      friendlyReaction: owner.reaction,
    });
  } catch {
    return;
  }
  const C = "troughStopsBeforeBuffEnd";
  for (const p of points) {
    const pr = p.pressured;
    if (!p.feasible || !p.triaged || pr === null || pr.minHpPct === null)
      continue;
    ctx.bump(C);
    const unit = ctx.units.find((u: any) => u.id === pr.unitId);
    if (!unit) continue;
    let low: number | null = null;
    let lowSec = 0;
    for (let s = p.outcomeEndSec + 1; s <= p.buffRunEndSec; s++) {
      if (ctx.start + s * 1000 > ctx.roundEndAt) break;
      if (isDeadAtRenderSecond(unit, ctx.start, s)) break;
      const hp = gridHpPct(unit, ctx.start + s * 1000);
      if (hp !== null && (low === null || hp < low)) {
        low = hp;
        lowSec = s;
      }
    }
    if (low === null || low >= pr.minHpPct) continue;
    const later = points.some((q) => q.tSec > p.tSec && q.tSec <= lowSec);
    ctx.violate(
      C,
      `${p.responded ? "answered" : "not answered"} | ${later ? "a later window opens before the lower reading" : "no later window"}`,
      ctx.start + p.tSec * 1000,
      `${ctx.roundKey}|${owner.reaction}|${p.tSec}`,
      `window at ${p.tSec}s (${p.leadCd.spellName}), horizon to ${p.outcomeEndSec}s, buff runs to ${p.buffRunEndSec}s: trough ${pr.minHpPct}% at ${pr.minHpSec}s, grid ${low}% at ${lowSec}s (${pr.minHpPct - low} lower)`,
    );
  }
}
