/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t138.ts — ticket T138 (wave-4 P04): 12.0 class-set bonuses that
 * shorten a cooldown, still worn in 12.1.
 *
 *  - `setBonusPressBeforeBack`: for each (spec, spell, set, pieces) of
 *    `WATCH` — a set bonus DB2 says shortens the spell — every player of the
 *    spec, on the entry the lines read (`unitCooldownEntry`): a press after
 *    the first, not a free one, that the model has impossible with the
 *    presses before it (`cdAvailableAt`, then `cdMaybeAvailableAt`). Kind
 *    `<spell> | worn` when the player wears the bonus's pieces
 *    (`setPiecesWorn`, the producer's own gear reading), `<spell> | unworn`
 *    otherwise — the control group. Checked = the presses judged.
 *  - inventory kinds (out of the total): `<spell> | presses worn` /
 *    `<spell> | presses unworn`, one per judged press, the denominators of
 *    the split.
 */
import { setPiecesWorn } from "@gladlog/analysis/src/data/classSetBonuses";
import {
  cdAvailableAt,
  cdMaybeAvailableAt,
  cdSecondsUntilReady,
  type IMajorCooldownInfo,
  unitCooldownEntry,
} from "@gladlog/analysis/src/utils/cooldowns";

import { type IRoundCtx, nameOf } from "./ctx";

export const CHECKS = ["setBonusPressBeforeBack"] as const;

const WATCH = [
  // Preservation 12.0 2pc 1264823: Verdant Embrace −2 s
  { spec: "1468", spellId: "360995", itemSetId: "1981", pieces: 2 },
  // Outlaw 12.0 4pc 1264859: Blade Rush −3 s
  { spec: "260", spellId: "271877", itemSetId: "1987", pieces: 4 },
  // Fury 12.0 4pc 1264878: Rampage → Odyn's Fury −1.25 s
  { spec: "72", spellId: "385059", itemSetId: "1990", pieces: 4 },
] as const;

export const OUT_OF_TOTAL: ReadonlySet<string> = new Set(
  WATCH.flatMap((w) =>
    ["worn", "unworn"].map(
      (g) => `setBonusPressBeforeBack|${nameOf(w.spellId)} | presses ${g}`,
    ),
  ),
);

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
  for (const u of ctx.players as any[])
    for (const w of WATCH) {
      if (String(u.spec) !== w.spec) continue;
      const cd = unitCooldownEntry(u, ctx.legacy, w.spellId);
      if (!cd) continue;
      const group =
        setPiecesWorn(u, w.itemSetId) >= w.pieces ? "worn" : "unworn";
      const name = nameOf(w.spellId);
      for (const [i, c] of cd.casts.entries()) {
        if (i === 0 || c.freeRecast) continue;
        ctx.bump("setBonusPressBeforeBack");
        const t = c.timeSeconds;
        const at = ctx.start + t * 1000;
        const factId = `${ctx.roundKey}|${u.id}|${w.spellId}|${Math.floor(t)}`;
        ctx.violate(
          "setBonusPressBeforeBack",
          `${name} | presses ${group}`,
          at,
          `${factId}|n`,
          `${name} press at ${t.toFixed(2)}s`,
        );
        const prior = before(cd, t);
        if (cdAvailableAt(prior, t) || cdMaybeAvailableAt(prior, t)) continue;
        const last = prior.casts[prior.casts.length - 1]!.timeSeconds;
        ctx.violate(
          "setBonusPressBeforeBack",
          `${name} | ${group}`,
          at,
          factId,
          `${name} at ${t.toFixed(2)}s: ${(t - last).toFixed(1)}s after the press before, model ${cd.cooldownSeconds}s x${cd.charges ?? 1}, ${cdSecondsUntilReady(prior, t).toFixed(1)}s short`,
        );
      }
    }
}
