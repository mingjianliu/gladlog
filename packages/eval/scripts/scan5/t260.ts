/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, players) */
/**
 * scan5/t260.ts — pipeline T260, count first: `[RES] enemy:` shows an enemy
 * offensive press with no effect span of its own for
 * `RES_ENEMY_INSTANT_WINDOW_S` (an instant cooldown: nothing to count down).
 * A press whose effect lives on an aura DB2 chains to it and the log shows
 * on its other casts (`triggeredEffectAurasOfCast`: Champion's Spear 376079
 * → 376080) and that logged none this time did not land — the 8 s states a window the log never showed
 * (27f20fb3: the spear's chain MISSED a Demonic Gateway, no 376080 on any
 * player, `Champion's Spear(4s left)` after its warrior died).
 *
 *  - `resEnemyInstantWindow`: counted, each side of each round once — every
 *    press the producer's own selection (`resEnemyEffectWindow`) gives the
 *    instant window. Kinds: `triggered effect aura, none logged` (the
 *    total; 605 base 60: Champion's Spear 51, Odyn's Fury 6, Reaper's Mark
 *    3), and out of the total `effect aura by name only, none logged` (1,
 *    Dark Transformation) and `instant, no effect aura` (105: Meteor 94,
 *    Soul Fire 10, Shadow Blades 1).
 */
import { resEnemyEffectWindow } from "@gladlog/analysis/src/context/resourceSnapshot";
import {
  effectAurasOfCast,
  triggeredEffectAurasOfCast,
} from "@gladlog/analysis/src/data/castEffectAuras";
import { reconstructEnemyCDTimeline } from "@gladlog/analysis/src/utils/enemyCDs";

import { type IRoundCtx, nameOf } from "./ctx";

const C = "resEnemyInstantWindow";
export const CHECKS = [C] as const;
const K = {
  noAura: "triggered effect aura, none logged",
  byName: "effect aura by name only, none logged",
  instant: "instant, no effect aura",
} as const;
/** the inventory: a cast with no effect aura DB2 chains to it */
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  `${C}|${K.byName}`,
  `${C}|${K.instant}`,
]);

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  const combat = { ...ctx.legacy, startTime: ctx.start, endTime: ctx.end };
  for (const side of new Set(
    (ctx.players as any[]).map((p) => p.reaction as number),
  )) {
    const enemies = (ctx.players as any[]).filter((p) => p.reaction !== side);
    const friends = (ctx.players as any[]).filter((p) => p.reaction === side);
    if (enemies.length === 0 || friends.length === 0) continue;
    let timeline;
    try {
      timeline = reconstructEnemyCDTimeline(
        enemies as never,
        combat as never,
        friends[0] as never,
        friends as never,
      );
    } catch {
      continue;
    }
    for (const player of timeline.players) {
      // the row's own list: the cooldowns, and the fact rows with a span
      const running = [
        ...player.offensiveCDs,
        ...(player.offensiveFacts ?? []).filter(
          (f) => f.buffEndSeconds > f.castTimeSeconds,
        ),
      ];
      for (const cd of running) {
        const w = resEnemyEffectWindow(cd);
        if (!w?.instant) continue;
        ctx.bump(C);
        const name = nameOf(cd.spellId, cd.spellName);
        const auras = effectAurasOfCast(cd.spellId);
        ctx.violate(
          C,
          triggeredEffectAurasOfCast(cd.spellId).length > 0
            ? K.noAura
            : auras.length > 0
              ? K.byName
              : K.instant,
          ctx.start + cd.castTimeSeconds * 1000,
          `${player.playerName}#${cd.spellId}#${cd.castTimeSeconds}`,
          `${name} ${cd.spellId} at ${cd.castTimeSeconds.toFixed(1)} s, effect auras on other casts: ${auras.join(", ") || "none"}`,
        );
      }
    }
  }
}
