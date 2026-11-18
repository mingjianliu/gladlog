/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t137.ts — ticket T137 (wave-4 P06, GH #218 item 1.6): Hover 358267
 * pressed while the model has no charge of it back.
 *
 *  - `hoverPressBeforeBack`: every Evoker, on the entry the lines read
 *    (`unitCooldownEntry`): a press after the first, not a free one, that
 *    the model has impossible with the presses before it (`cdAvailableAt`,
 *    then `cdMaybeAvailableAt`). Kind = the holder's spec. Checked = the
 *    presses judged. Each round once.
 */
import {
  cdAvailableAt,
  cdMaybeAvailableAt,
  cdSecondsUntilReady,
  type IMajorCooldownInfo,
  unitCooldownEntry,
} from "@gladlog/analysis/src/utils/cooldowns";

import { type IRoundCtx } from "./ctx";

export const CHECKS = ["hoverPressBeforeBack"] as const;

const HOVER = "358267";
const EVOKER_SPECS = new Set(["1467", "1468", "1473"]);

function before(cd: IMajorCooldownInfo, t: number): IMajorCooldownInfo {
  const keep = (c: { timeSeconds: number }) => c.timeSeconds < t;
  return {
    ...cd,
    casts: cd.casts.filter(keep),
    ...(cd.sharedCasts ? { sharedCasts: cd.sharedCasts.filter(keep) } : {}),
  };
}

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  for (const u of ctx.players as any[]) {
    if (!EVOKER_SPECS.has(String(u.spec))) continue;
    const cd = unitCooldownEntry(u, ctx.legacy, HOVER);
    if (!cd) continue;
    for (const [i, c] of cd.casts.entries()) {
      if (i === 0 || c.freeRecast) continue;
      ctx.bump("hoverPressBeforeBack");
      const t = c.timeSeconds;
      const prior = before(cd, t);
      if (cdAvailableAt(prior, t) || cdMaybeAvailableAt(prior, t)) continue;
      const last = prior.casts[prior.casts.length - 1]!.timeSeconds;
      ctx.violate(
        "hoverPressBeforeBack",
        String(u.spec),
        ctx.start + t * 1000,
        `${ctx.roundKey}|${u.id}|${Math.floor(t)}`,
        `Hover at ${t.toFixed(2)}s: ${(t - last).toFixed(1)}s after the press before, model ${cd.cooldownSeconds}s x${cd.charges ?? 1}, ${cdSecondsUntilReady(prior, t).toFixed(1)}s short`,
      );
    }
  }
}
