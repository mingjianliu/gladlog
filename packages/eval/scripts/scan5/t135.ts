/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t135.ts — ticket T135 (wave-4 P02): a ledger press the cooldown model
 * has impossible. The two line-level checks (`kitSoonestAboveRecast`,
 * `resCdBeforeNextPress`) see such a press only where a line happens to quote
 * the number; this one asks the model itself, for every player of the round.
 *
 *  - `ledgerPressBeforeBack`: every ledger entry (`extractMajorCooldowns`) of
 *    every player, every press after the entry's first that is not a free
 *    one (`freeRecast`): with the presses before it, the model has no charge
 *    at the press — `cdAvailableAt`, then `cdMaybeAvailableAt` (the pair
 *    `cooldownRecastScan` and scan5/t133 read). Kind `<spell> | <spec>`; the
 *    detail carries the gap to the press before and the seconds the model
 *    still had on it (`cdSecondsUntilReady`). Checked = the presses judged.
 *    A proc-only entry (`isProcOnly`: Avenging Wrath under Radiant Glory)
 *    holds procs, not presses, and is not judged.
 *    Once per round (`firstOwnerOfRound`): the ledger is the unit's, not the
 *    owner's view.
 */
import {
  cdAvailableAt,
  cdMaybeAvailableAt,
  cdSecondsUntilReady,
  extractMajorCooldowns,
  type IMajorCooldownInfo,
} from "@gladlog/analysis/src/utils/cooldowns";

import { type IRoundCtx } from "./ctx";

export const CHECKS = ["ledgerPressBeforeBack"] as const;

/** the entry with only the presses before `t` */
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
    let entries: IMajorCooldownInfo[];
    try {
      entries = extractMajorCooldowns(u, ctx.legacy);
    } catch {
      continue;
    }
    for (const cd of entries) {
      // a proc-only entry's rows are its procs, no presses of a button
      if (cd.isProcOnly) continue;
      for (const [i, c] of cd.casts.entries()) {
        if (i === 0 || c.freeRecast) continue;
        ctx.bump("ledgerPressBeforeBack");
        const t = c.timeSeconds;
        const prior = before(cd, t);
        if (cdAvailableAt(prior, t) || cdMaybeAvailableAt(prior, t)) continue;
        const last = [...prior.casts, ...(prior.sharedCasts ?? [])]
          .map((x) => x.timeSeconds)
          .sort((a, b) => a - b)
          .pop()!;
        ctx.violate(
          "ledgerPressBeforeBack",
          `${cd.spellName} | ${u.spec}`,
          ctx.start + t * 1000,
          `${ctx.roundKey}|${u.id}|${cd.spellId}|${Math.floor(t)}`,
          `${u.spec} ${cd.spellName} ${cd.spellId} at ${t.toFixed(2)}s: ${(t - last).toFixed(1)}s after the press before, model ${cd.cooldownSeconds}s x${cd.charges ?? 1}${cd.earliestCooldownSeconds !== undefined ? ` (earliest ${cd.earliestCooldownSeconds}s)` : ""}, ${cdSecondsUntilReady(prior, t).toFixed(1)}s short`,
        );
      }
    }
  }
}
