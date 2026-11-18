/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t139.ts — ticket T139 (wave-4 U02, GH #218 item 1.11): the seconds
 * of a cooldown's return are floored to the render grid by three readers
 * with three float guards — the kit line's low end (+1e-8), `[RES]`'s
 * seconds until ready (`cdRemainingWholeSeconds`, +1e-6) and the off-list
 * `[PRESS]` line's `back m:ss` (the raw float). A value a hair under a whole
 * second is where they part. Each round once; a "violation" is an OCCASION,
 * counted so one guard can be chosen with a number.
 *
 *  - `backSecondFloatBand`: every off-list press the producer lists
 *    (`extractOffListPresses`) with a return (`readyAgainAtSeconds`), by how
 *    far the raw return sits under the next whole second: kind `under 1e-8`
 *    (float noise by the kit guard's measure: the line prints a second
 *    low), `1e-8..1e-6` (a guard of 1e-6 would move it, one of 1e-8 not).
 *    Checked = those presses.
 *  - `resSecondFloatBand`: every ledger entry of every player
 *    (`extractMajorCooldowns`, and the utility entries `[RES]` adds for
 *    an owner, `ownerResUtilityCds`, read for every player), from its first spend — a shared
 *    one included — at every whole second of the round — a
 *    superset of the `[RES]` rows, which sit on whole seconds — the three
 *    quantities `remainingText` floors (`cdSecondsUntilReady`,
 *    `cdRealisedSecondsUntilReady`, the `earliestCooldownSeconds` reading),
 *    each positive value by the same two bands: `under 1e-8` (both guards
 *    lift it), `1e-8..1e-6` (only the 1e-6 guard lifts it: narrowing to
 *    1e-8 prints it a second lower). Checked = the positive values.
 */
import { ownerResUtilityCds } from "@gladlog/analysis/src/context/resUtilityCds";
import {
  cdRealisedSecondsUntilReady,
  cdSecondsUntilReady,
  extractMajorCooldowns,
} from "@gladlog/analysis/src/utils/cooldowns";
import { extractOffListPresses } from "@gladlog/analysis/src/utils/offListPress";

import { type IRoundCtx, nameOf } from "./ctx";

export const CHECKS = ["backSecondFloatBand", "resSecondFloatBand"] as const;

/** the kit low end's guard (`SECONDS_FLOAT_NOISE`) */
const NARROW = 1e-8;
/** `cdRemainingWholeSeconds`'s guard */
const WIDE = 1e-6;

function band(x: number): string | null {
  const under = Math.ceil(x) - x;
  if (!(under > 0)) return null;
  if (under <= NARROW) return "under 1e-8";
  if (under <= WIDE) return "1e-8..1e-6";
  return null;
}

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  for (const p of extractOffListPresses(
    ctx.players as any,
    ctx.legacy,
    ctx.roundEndAt,
  )) {
    if (p.readyAgainAtSeconds === null) continue;
    ctx.bump("backSecondFloatBand");
    const b = band(p.readyAgainAtSeconds);
    if (!b) continue;
    ctx.violate(
      "backSecondFloatBand",
      b,
      ctx.start + p.timeSeconds * 1000,
      `${ctx.roundKey}|${p.unit.id}|${p.spellId}|${Math.floor(p.timeSeconds)}`,
      `${nameOf(p.spellId)} pressed ${p.timeSeconds.toFixed(3)}s, back ${p.readyAgainAtSeconds}`,
    );
  }
  const endS = Math.floor((ctx.roundEndAt - ctx.start) / 1000);
  for (const u of ctx.players as any[]) {
    let entries: ReturnType<typeof extractMajorCooldowns> = [];
    try {
      entries = extractMajorCooldowns(u, ctx.legacy);
    } catch {
      continue;
    }
    // an owner's `[RES]` rows carry its utility cooldowns too (codex
    // 85-tk-CD-T139-1 #2) — every player's here: the round is read once,
    // whichever owner's context comes first (1b #1)
    entries = [...entries, ...ownerResUtilityCds(u, ctx.start)];
    for (const cd of entries) {
      const spends = [...cd.casts, ...(cd.sharedCasts ?? [])].map(
        (c) => c.timeSeconds,
      );
      if (spends.length === 0) continue;
      const first = Math.floor(Math.min(...spends));
      for (let t = first; t <= endS; t++) {
        const values: Array<[string, number]> = [
          ["latest", cdSecondsUntilReady(cd, t)],
          ["realised", cdRealisedSecondsUntilReady(cd, t)],
        ];
        if (cd.earliestCooldownSeconds !== undefined)
          values.push([
            "earliest",
            cdSecondsUntilReady(cd, t, cd.earliestCooldownSeconds),
          ]);
        for (const [which, v] of values) {
          if (!(v > 0) || !Number.isFinite(v)) continue;
          ctx.bump("resSecondFloatBand");
          const b = band(v);
          if (!b) continue;
          ctx.violate(
            "resSecondFloatBand",
            b,
            ctx.start + t * 1000,
            `${ctx.roundKey}|${u.id}|${cd.spellId}|${t}|${which}`,
            `${cd.spellName} at ${t}s: ${which} ${v}`,
          );
        }
      }
    }
  }
}
