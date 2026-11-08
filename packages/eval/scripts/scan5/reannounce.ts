/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents) */
/**
 * scan5/reannounce.ts — GH #136.3 (triage enemy-def F-E12): a second
 * `SPELL_AURA_APPLIED` of an aura that is still up (same spell, same source,
 * no REMOVED / BROKEN between) with at most one press of it by that source
 * around the two rows is the game re-announcing ONE press. Every reader of
 * `buildAuraIntervals` should see one interval there, not two pieces that
 * meet at the second row (f4eb8c87 2:47: one Divine Shield as `0.9s` +
 * `7.1s`).
 *
 * Log truth: the raw aura rows on each player and the source's presses
 * (`pressSecondsOfAura`, the join's own press reading, within
 * `SAVE_CAST_AURA_PAIR_S` of either row). Product reading: the builder's
 * intervals for that unit. Counted once per round (the first owner's walk).
 */
import { buildAuraIntervals } from "@gladlog/analysis/src/utils/auraIntervals";
import { DEF_OR_IMMUNE_IDS } from "@gladlog/analysis/src/utils/burstLedger";
import {
  pressSecondsOfAura,
  SAVE_CAST_AURA_PAIR_S,
} from "@gladlog/analysis/src/utils/enemyDefensives";
import { isResyncBatchAt } from "@gladlog/analysis/src/utils/resyncBatch";

import { APPLIED, ev, type IRoundCtx, nameOf, REMOVED, tsOf } from "./ctx";

export const CHECKS = ["reannounceSplit"] as const;

const BROKEN = new Set([
  REMOVED,
  "SPELL_AURA_BROKEN",
  "SPELL_AURA_BROKEN_SPELL",
]);

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  const start = ctx.start;
  for (const u of ctx.players) {
    const rows = ((u.auraEvents ?? []) as any[]).filter(
      (a) => a.destUnitId === u.id && a.spellId && a.srcUnitId,
    );
    const open = new Map<string, number>(); // spell:src -> APPLIED ms
    const found: Array<{
      spellId: string;
      src: string;
      prevMs: number;
      ms: number;
    }> = [];
    for (const a of rows) {
      const key = `${a.spellId}:${a.srcUnitId}`;
      if (ev(a) === APPLIED) {
        const prev = open.get(key);
        if (prev !== undefined)
          found.push({
            spellId: a.spellId,
            src: a.srcUnitId,
            prevMs: prev,
            ms: tsOf(a),
          });
        open.set(key, tsOf(a));
      } else if (BROKEN.has(ev(a))) open.delete(key);
    }
    if (found.length === 0) continue;
    let ivs: any[] | undefined;
    for (const f of found) {
      const src = ctx.units.find((x: any) => x.id === f.src);
      if (!src) continue;
      const presses = pressSecondsOfAura(src.spellCastEvents, f.spellId, start)
        .map((s) => start + s * 1000)
        .filter(
          (ms) =>
            ms >= f.prevMs - SAVE_CAST_AURA_PAIR_S * 1000 &&
            ms <= f.ms + SAVE_CAST_AURA_PAIR_S * 1000,
        );
      if (presses.length > 1) continue;
      ctx.bump("reannounceSplit");
      ivs ??= buildAuraIntervals(u, ctx.legacy);
      const at = (f.ms - start) / 1000;
      const split = ivs.some(
        (b: any) =>
          b.spellId === f.spellId &&
          Math.abs(b.fromS - at) < 0.0015 &&
          ivs!.some(
            (a: any) =>
              a !== b &&
              a.spellId === f.spellId &&
              a.srcUnitName === b.srcUnitName &&
              Math.abs(a.toS - b.fromS) < 1e-6,
          ),
      );
      if (!split) continue;
      ctx.violate(
        "reannounceSplit",
        `${DEF_OR_IMMUNE_IDS.has(f.spellId) ? "defensive" : "other"}-${isResyncBatchAt(u, f.ms) ? "resyncBatch" : "single"}`,
        f.ms,
        `${u.name}#${f.spellId}#${f.ms}`,
        `${u.name}: ${nameOf(f.spellId)} by ${src.name} re-applied at +${f.ms - start}ms (first at +${f.prevMs - start}ms, ${presses.length} press) read as two intervals`,
      );
    }
  }
}
