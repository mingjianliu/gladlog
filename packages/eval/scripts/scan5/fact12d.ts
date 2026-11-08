/* eslint-disable @typescript-eslint/no-explicit-any -- scan over raw parse output */
/**
 * fact12d (pipeline 2026-11-07) class checks — T07, fact12 A12/B14/C13/C14.
 *
 *  - ghostReadAsHp: a printed HP number for a unit at a second its
 *    `[STATE]` tick reads `ghost` (Spirit of Redemption: the form has no HP
 *    reading — the log's HP fields keep the last value). 7edc099d r0: the
 *    Holy Priest's pressed form ran 2:32.18 → 2:41.19; `2:37 [ROT PRESSURE]
 *    6(HPriest) … at 36% HP` and Burst #6 `2:30–2:35 … 50% → 34%` (2:35 a
 *    ghost tick). The form's seconds are the `[STATE]` tick's own
 *    (`extractSpiritOfRedemptionIntervals` + `isGhostAtRenderSecond` over
 *    the round): a number printed beside a `ghost` tick contradicts it,
 *    whatever the tick reads. Kinds: `rot pressure` (a `[ROT
 *    PRESSURE]` line whose four counted seconds hold a ghost second),
 *    `burst endpoint` (a burst ledger `Target:` number at its first / last
 *    second), `spike endpoint` (a `[DMG SPIKE]` `A% -> B% HP` end).
 *  - rotPressureNoDamage: a `[ROT PRESSURE]` line whose window (the four
 *    seconds before its second) holds no damage row on the unit at all — the
 *    legend's "at least 50% of the damage they took in those 4 s was
 *    periodic" has nothing to be true of (the `totalDmg === 0` pass).
 */
import {
  extractSpiritOfRedemptionIntervals,
  isGhostAtRenderSecond,
} from "@gladlog/analysis/src/utils/combatStates";

import { type IRoundCtx, secOf, tsOf } from "./ctx";

export const CHECKS = ["ghostReadAsHp", "rotPressureNoDamage"] as const;

export function run(ctx: IRoundCtx): void {
  const lines = ctx.text.split("\n");
  const pidName = new Map<string, string>();
  for (const l of lines) {
    const u = /<unit id="(\d+)" name="([^"]+)"/.exec(l);
    if (u) pidName.set(u[1]!, u[2]!);
  }
  /** the render seconds a unit's `[STATE]` tick reads `ghost` — the tick's
   * own intervals (`extractSpiritOfRedemptionIntervals` over the round, read
   * by `isGhostAtRenderSecond`): one predicate for the tick and the scan */
  const ghostCache = new Map<string, { has: (s: number) => boolean }>();
  const ghostOf = (name: string): { has: (s: number) => boolean } => {
    const hit = ghostCache.get(name);
    if (hit) return hit;
    const u = ctx.byName.get(name);
    const ivs = u
      ? extractSpiritOfRedemptionIntervals(u, {
          startTime: ctx.start,
          endTime: ctx.end,
        })
      : [];
    const out = { has: (s: number) => isGhostAtRenderSecond(ivs, s) };
    ghostCache.set(name, out);
    return out;
  };

  let burstFrom = -1;
  let burstTo = -1;
  for (const l of lines) {
    const rot =
      /^(\d+:\d{2})\s+\[ROT PRESSURE\]\s+(\d+)\([^)]*\)\s.*at (\d+)% HP/.exec(
        l,
      );
    if (rot) {
      const t = secOf(rot[1]!);
      const name = pidName.get(rot[2]!);
      if (!name) continue;
      const ghost = ghostOf(name);
      ctx.bump("ghostReadAsHp");
      if ([0, 1, 2, 3].some((k) => ghost.has(t - k)))
        ctx.violate(
          "ghostReadAsHp",
          "rot pressure",
          ctx.start + t * 1000,
          `${name}:${t}:rot`,
          `${name}: ghost in ${t - 3}–${t}s, [ROT PRESSURE] at ${rot[3]}%`,
          l.trim(),
        );
      ctx.bump("rotPressureNoDamage");
      const u = ctx.byName.get(name);
      const fromMs = ctx.start + (t - 4) * 1000;
      const toMs = ctx.start + t * 1000;
      const hits = ((u?.damageIn ?? []) as any[]).filter(
        (d) => tsOf(d) >= fromMs && tsOf(d) <= toMs,
      ).length;
      if (hits === 0)
        ctx.violate(
          "rotPressureNoDamage",
          ghostOf(name).has(t) ? "ghost" : "alive",
          toMs,
          `${name}:${t}:rotdmg`,
          `${name}: no damage row in ${t - 4}–${t}s`,
          l.trim(),
        );
      continue;
    }
    const burst = /^\s+Burst #\d+ — (\d+:\d{2})–(\d+:\d{2})/.exec(l);
    if (burst) {
      burstFrom = secOf(burst[1]!);
      burstTo = secOf(burst[2]!);
      continue;
    }
    const target = /^\s+Target: (\S+) (\d+)% → (\d+)%/.exec(l);
    if (target && burstFrom >= 0) {
      const ghost = ghostOf(target[1]!);
      ctx.bump("ghostReadAsHp");
      for (const [sec, pct] of [
        [burstFrom, target[2]],
        [burstTo, target[3]],
      ] as const)
        if (ghost.has(sec))
          ctx.violate(
            "ghostReadAsHp",
            "burst endpoint",
            ctx.start + sec * 1000,
            `${target[1]}:${burstFrom}-${burstTo}:${sec}`,
            `${target[1]}: ghost at ${sec}s, burst ${burstFrom}–${burstTo} prints ${pct}%`,
            l.trim(),
          );
      continue;
    }
    const spike =
      /^(\d+:\d{2})–(\d+:\d{2})\s+\[DMG SPIKE\]\s+(\d+)\([^)]*\).*\((\d+)% -> (\d+)% HP/.exec(
        l,
      );
    if (spike) {
      const name = pidName.get(spike[3]!);
      if (!name) continue;
      const ghost = ghostOf(name);
      const a = secOf(spike[1]!);
      const b = secOf(spike[2]!);
      ctx.bump("ghostReadAsHp");
      for (const [sec, pct] of [
        [a, spike[4]],
        [b, spike[5]],
      ] as const)
        if (ghost.has(sec))
          ctx.violate(
            "ghostReadAsHp",
            "spike endpoint",
            ctx.start + sec * 1000,
            `${name}:${a}-${b}:${sec}`,
            `${name}: ghost at ${sec}s, [DMG SPIKE] ${a}–${b} prints ${pct}%`,
            l.trim(),
          );
    }
  }
}
