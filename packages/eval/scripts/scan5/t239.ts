/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, cast rows) */
/**
 * scan5/t239.ts — pipeline T239, count first: the report's cast lane
 * (desktop `deriveCasts` → `GcdSwimlane`) prints `→ whom` from the cast
 * row's destination for every press. A personal defensive's
 * SPELL_CAST_SUCCESS row logs the caster's current target there (Survival of
 * the Fittest → the enemy Discipline Priest, 69915cc5 r1) — the unit was
 * never the press's target.
 *
 *  - `castLaneSelfOnlyDestination`: counted, each round once — every
 *    player's SPELL_CAST_SUCCESS row that names a unit other than its
 *    caster. Recorded (an inventory, out of the total) when the lane's own predicate says the press
 *    renders on its caster (`rendersOnCaster`, the prompt's: a defensive of
 *    the class roster whose official targeting reaches no ally, the
 *    self-only big defensives, the caster-rendered heal cooldowns) and is
 *    not pressed on an enemy (`ENEMY_TARGET_DEFENSIVE_IDS`: Touch of Karma)
 *    and — for a self wall a talent can put on an ally
 *    (`ALLY_REACH_GRANTED_BY_TALENT`: Obsidian Scales) — names a unit of
 *    the other side: the legs of desktop `castRowDestinationIsNoTarget`,
 *    with the side from the log's `reaction`; kinds
 *    by who the named unit is (`an enemy player`, `a friendly player`,
 *    `another unit`). The lane blanks exactly these rows, so the check
 *    counts what the raw destination would print.
 *    605 capture: 1,119 of 504,835 rows (Survival of the Fittest 934,
 *    Obsidian Scales 185); the 285 12.1.5 files: 1,013 of 399,550.
 */
import {
  ALLY_REACH_GRANTED_BY_TALENT,
  ENEMY_TARGET_DEFENSIVE_IDS,
  rendersOnCaster,
} from "@gladlog/analysis/src/utils/cooldowns";
import { LogEvent } from "@gladlog/parser-compat";

import { type IRoundCtx, nameOf } from "./ctx";

const C = "castLaneSelfOnlyDestination";
export const CHECKS = [C] as const;
const KINDS = ["an enemy player", "a friendly player", "another unit"] as const;
/** an inventory, not a pass condition: the rows stay in the log, and the
 * lane no longer prints their destination (unit-tested on `deriveCasts`) */
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set(
  KINDS.map((k) => `${C}|${k}`),
);

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  const players = ctx.players as any[];
  const byId = new Map<string, any>(
    (ctx.units as any[]).map((u) => [String(u.id), u]),
  );
  for (const p of players)
    for (const c of (p.spellCastEvents ?? []) as any[]) {
      if (c.logLine?.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      const dest = String(c.destUnitId ?? "");
      if (!c.destUnitName || !dest || /^0+$/.test(dest)) continue;
      if (dest === String(p.id)) continue;
      ctx.bump(C);
      const id = String(c.spellId ?? "");
      if (!rendersOnCaster(id) || ENEMY_TARGET_DEFENSIVE_IDS.has(id)) continue;
      const other = byId.get(dest);
      const otherSide =
        other?.reaction !== undefined && other.reaction !== p.reaction;
      if (ALLY_REACH_GRANTED_BY_TALENT[id] !== undefined && !otherSide)
        continue;
      const kind = !other?.info
        ? "another unit"
        : otherSide
          ? "an enemy player"
          : "a friendly player";
      const t = c.logLine.timestamp as number;
      ctx.violate(
        C,
        kind,
        t,
        `${p.id}#${id}#${t}`,
        `${nameOf(id, c.spellName)} ${id} at ${((t - ctx.start) / 1000).toFixed(1)} s → ${kind}`,
      );
    }
}
