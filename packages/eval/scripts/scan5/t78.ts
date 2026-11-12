/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t78.ts — ticket T78, a MEASUREMENT (no line is called wrong): the
 * desktop card `missed-purge-kill-window` (`derive/mistakes.ts`) drops a
 * missed-purge window on `missedPurgeNotActionable(w).noReach` alone, while
 * the prompt line and the dispel panel stop saying "not actionable" of a
 * window a purger reached with the reaction bar still left of the buff
 * (`reachedInTime`, fact7 D66 — recorded as left on purpose in
 * docs/predicate-index.md, "no accusation widens"). GH #173 item 33.
 *
 *  - `purgeCardReach` (every kind out of the total; each round once, read
 *    from the recorder's side): the product's own missed-purge windows
 *    (`reconstructDispelSummary`) inside a kill window
 *    (`annotateMissedPurgesWithKillWindows`), by the card's door —
 *    `card` (shown today), `no reach, reached in time` (dropped today; the
 *    cards a reader of `noReach && !reachedInTime` would add),
 *    `no reach, never reached`, `locked out`, `on cooldown throughout`
 *    (first reason that applies: locked out, then cooldown, then reach).
 */
import {
  annotateMissedPurgesWithKillWindows,
  missedPurgeNotActionable,
  reconstructDispelSummary,
} from "@gladlog/analysis/src/utils/dispelAnalysis";
import { computeOffensiveWindows } from "@gladlog/analysis/src/utils/offensiveWindows";

import { fmtS, type IRoundCtx } from "./ctx";

export const CHECKS = ["purgeCardReach"] as const;

const DOORS = [
  "card",
  "locked out",
  "on cooldown throughout",
  "no reach, reached in time",
  "no reach, never reached",
] as const;
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set(
  DOORS.map((d) => `purgeCardReach|${d}`),
);

export function run(ctx: IRoundCtx): void {
  if (!ctx.owner || !ctx.firstOwnerOfRound) return;
  const players = ctx.players as any[];
  const friends = players.filter((u) => u.reaction === ctx.owner.reaction);
  const enemies = players.filter((u) => u.reaction !== ctx.owner.reaction);
  let ds: ReturnType<typeof reconstructDispelSummary>;
  try {
    const fIds = new Set(friends.map((u) => u.id));
    const eIds = new Set(enemies.map((u) => u.id));
    const units = Object.values(ctx.legacy.units) as any[];
    // `dispelSummaryOf` (desktop derive/dispelSummary.ts): both sides' pets
    ds = reconstructDispelSummary(
      friends,
      enemies,
      ctx.legacy,
      units.filter((u) => u.ownerId && fIds.has(u.ownerId)),
      units.filter((u) => u.ownerId && eIds.has(u.ownerId)),
    );
    annotateMissedPurgesWithKillWindows(
      ds.missedPurgeWindows,
      computeOffensiveWindows(enemies, friends, ctx.legacy),
    );
  } catch {
    return;
  }
  for (const w of ds.missedPurgeWindows) {
    if (!w.duringKillWindow) continue;
    const why = missedPurgeNotActionable(w);
    const door: (typeof DOORS)[number] = why.lockedOut
      ? "locked out"
      : why.onCooldownThroughout
        ? "on cooldown throughout"
        : why.noReach
          ? why.reachedInTime
            ? "no reach, reached in time"
            : "no reach, never reached"
          : "card";
    ctx.bump("purgeCardReach");
    ctx.violate(
      "purgeCardReach",
      door,
      ctx.start + w.timeSeconds * 1000,
      `${w.enemyName}:${w.spellId}:${w.timeSeconds.toFixed(3)}`,
      `${w.spellName} on an enemy at ${fmtS(w.timeSeconds)} for ${w.durationSeconds.toFixed(1)}s`,
      "",
    );
  }
}
