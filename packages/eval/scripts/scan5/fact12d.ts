 
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
 *  - ghostEndTroughDropped (codex B9 #2): a `[DMG SPIKE]` line or a burst
 *    `Target:` line whose LAST second is a ghost second and whose first is
 *    not (`isGhostEndWindow`), where the window held a trough worth
 *    printing against the live start (`ghostEndTroughInWindow`, the
 *    renderer's own selection), and the line prints no such `low`. A Spirit of Redemption form follows a lethal drop: withholding
 *    the ghost endpoint must not take the trough before it with it.
 */
import { rotPressureDamageInWindow } from "@gladlog/analysis/src/context/matchTimelineSections";
import {
  extractSpiritOfRedemptionIntervals,
  isGhostAtRenderSecond,
} from "@gladlog/analysis/src/utils/combatStates";
import {
  ghostEndTroughInWindow,
  gridEndpointHpPct,
  isGhostEndWindow,
} from "@gladlog/analysis/src/utils/cooldowns";

import { type IRoundCtx, secOf } from "./ctx";

export const CHECKS = [
  "ghostReadAsHp",
  "rotPressureNoDamage",
  "ghostEndTroughDropped",
] as const;

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

  /** codex B9 #2: a window ending on a ghost second keeps its trough */
  const troughDropped = (
    name: string,
    from: number,
    to: number,
    line: string,
    kind: string,
  ): void => {
    const u = ctx.byName.get(name);
    if (!u || !isGhostEndWindow(u, ctx.start, from, to)) return;
    ctx.bump("ghostEndTroughDropped");
    const a = gridEndpointHpPct(u, ctx.start, from)!;
    // the renderer's own selection (`ghostEndTroughInWindow`)
    const low = ghostEndTroughInWindow(
      u,
      ctx.start,
      from,
      to,
      ctx.roundEndAt,
      a,
    );
    if (!low) return;
    if (new RegExp(`low ${low.pct}% (?:@|at )`).test(line)) return;
    ctx.violate(
      "ghostEndTroughDropped",
      kind,
      ctx.start + low.atSec * 1000,
      `${name}:${from}-${to}:trough`,
      `${name}: ${from}–${to}s ends on a ghost second, starts at ${a}%, low ${low.pct}% at ${low.atSec}s unprinted`,
      line.trim(),
    );
  };
  {
    let bFrom = -1;
    let bTo = -1;
    for (const l of lines) {
      const head = /^\s+Burst #\d+ — (\d+:\d{2})–(\d+:\d{2})/.exec(l);
      if (head) {
        bFrom = secOf(head[1]!);
        bTo = secOf(head[2]!);
        continue;
      }
      const tl = /^\s+Target: (\S+)/.exec(l);
      if (tl && bFrom >= 0) {
        troughDropped(tl[1]!, bFrom, bTo, l, "burst target");
        continue;
      }
      const sp = /^(\d+:\d{2})–(\d+:\d{2})\s+\[DMG SPIKE\]\s+(\d+)\(/.exec(l);
      const spName = sp ? pidName.get(sp[3]!) : undefined;
      if (sp && spName)
        troughDropped(spName, secOf(sp[1]!), secOf(sp[2]!), l, "dmg spike");
    }
  }

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
      // the producer's own sum (codex B9 #3: a zero-amount row is no damage)
      const { totalDmg } = u
        ? rotPressureDamageInWindow(u, fromMs, toMs)
        : { totalDmg: 0 };
      if (totalDmg <= 0)
        ctx.violate(
          "rotPressureNoDamage",
          ghostOf(name).has(t) ? "ghost" : "alive",
          toMs,
          `${name}:${t}:rotdmg`,
          `${name}: no damage in ${t - 4}–${t}s`,
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
