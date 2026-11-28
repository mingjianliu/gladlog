/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse units */
/**
 * scan5/t16.ts — the low end of a kit's `[a–Ns]` (fact12 D17, T16).
 *
 *  - `kitSoonestAboveRecast`: a `<player_loadout>` kit entry `X [a–Ns…]`
 *    (the legend: "has been seen back after a s at the soonest") whose unit
 *    pressed X twice in the round less than a s apart, by more than
 *    `KIT_SLACK_S` — the soonest return the kit states is later than one
 *    the log shows (64e9a3f3 r0: Frozen Orb `[31–60s]`, presses 26.0 s
 *    apart under White Out's per-hit and per-shattered-stack give-backs).
 *    A charge entry (`N Charges`) is not read: two presses of a charge
 *    spell are no cooldown apart. Kind = the spell. Counted: every kit range
 *    entry whose unit pressed X again after a press that started its
 *    cooldown.
 * Which rows are presses, and which of them started a cooldown, is the
 * producer's own selection (`pressesOf`, the kit entry's ledger casts): the
 * check audits the kit's `a`, not the press identification, and a second
 * identification here drifted from the ledger's three times (free-recast
 * windows, Time Spiral's free casts and its echo rows). The `[RES]` rows'
 * range low end is fact8's `resCdBeforeNextPress`.
 */
import { kitNameWithoutNoWallTag } from "@gladlog/analysis/src/utils/auraMasteryBranch";
import {
  kitSpellNameOf,
  ownShortestRecast,
  unitCooldownLedger,
} from "@gladlog/analysis/src/utils/cooldowns";

import { type IRoundCtx } from "./ctx";

export const CHECKS = ["kitSoonestAboveRecast"] as const;

/** the kit's a is whole seconds; a recast this much under it is no rounding */
const KIT_SLACK_S = 1;
const UNIT_OPEN = /^\s*<unit id="(\d+)"/;
const KIT_LINE = /^\s*<cooldowns>(.*)<\/cooldowns>/;
// the upper bound can carry a fraction (`Master's Call [22–22.5s]`): an
// integer-only pattern skipped 76 | 23 entries with a measurable recast
// (codex 85-tk-L8-T316-1d #1)
const KIT_RANGE = /(?:^|, )([^,[\]]+?) \[(\d+)–(\d+(?:\.\d+)?)s([^\]]*)\]/g;

/**
 * The shortest recast of the kit entry `name`, as the producer reads it:
 * `ownShortestRecast` (the predicate the kit's low end is clamped by, T316;
 * the `[RES]` rows do not read it) over the casts of the ledger entry that kit entry is
 * rendered from (`unitCooldownLedger`, the entry whose `spellName` the kit
 * prints), never re-derived here and never `unitCooldownEntry`'s fallback
 * for an id the ledger does not carry (the Stasis release 370564 built a
 * cooldown entry of its own, its releases read as presses: 61 false Stasis
 * rows on 605). Which presses start a cooldown and which prove the button
 * back is that predicate's: free presses, holds that never went out and
 * presses no cast row dates are told apart there (codex reviews
 * 85-tk-E-T16-1 / -1b / -2 / -2b, batch review 80-PIPE-20-B20). The round's
 * end of play is the cut. Epoch ms.
 */
function shortestRecastOf(
  ctx: IRoundCtx,
  u: any,
  name: string,
): { gapMs: number; at: number } | undefined {
  let best: { gapMs: number; at: number } | undefined;
  const untilSeconds = (ctx.roundEndAt - ctx.legacy.startTime) / 1000;
  for (const cd of unitCooldownLedger(u, ctx.legacy)) {
    // by the name the kit prints for this holder (`kitSpellNameOf`: an Ice
    // Cold holder's Ice Block row), codex 85-tk-G-T61-2 #2
    if (kitSpellNameOf(cd, u) !== name) continue;
    // a charge entry is skipped by the caller's `Charges` test; here every
    // entry is read as the kit printed it, a range
    const r = ownShortestRecast({ casts: cd.casts }, untilSeconds);
    if (!r) continue;
    // back on the log's millisecond: 39.032 − 10.032 s is 28.999999999999996
    // (codex 85-tk-L8-T316-1 #6)
    const gapMs = Math.round(r.gapSeconds * 1000);
    if (!best || gapMs < best.gapMs)
      best = { gapMs, at: ctx.legacy.startTime + r.fromSeconds * 1000 };
  }
  return best;
}

export function run(ctx: IRoundCtx): void {
  let pid: string | undefined;
  for (const line of ctx.lines) {
    const open = UNIT_OPEN.exec(line);
    if (open) {
      pid = open[1];
      continue;
    }
    const kit = KIT_LINE.exec(line);
    if (!kit || pid === undefined) continue;
    const unit = ctx.unitOfPid(pid);
    if (!unit) continue;
    for (const e of kit[1]!.matchAll(KIT_RANGE)) {
      if (/Charges/.test(e[4]!)) continue;
      // the kit name without the product's no-wall tag (ruling R74; codex
      // 85-tk-WIN-T213-3 #6: the tagged entry matched no ledger name and the
      // check went silent)
      const name = kitNameWithoutNoWallTag(e[1]!.trim());
      const soonest = Number(e[2]);
      const recast = shortestRecastOf(ctx, unit, name);
      if (!recast) continue;
      ctx.bump("kitSoonestAboveRecast");
      const min = recast.gapMs;
      const at = recast.at;
      if (min / 1000 >= soonest - KIT_SLACK_S) continue;
      ctx.violate(
        "kitSoonestAboveRecast",
        name,
        at,
        `${unit.name}#${name}`,
        `${unit.name} ${name} [${soonest}–${e[3]}s]: pressed ${(min / 1000).toFixed(1)} s apart`,
        e[0]!.slice(0, 200),
      );
    }
  }
}
