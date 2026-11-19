/* eslint-disable @typescript-eslint/no-explicit-any -- the legacy parse objects are untyped */
/**
 * scan5/t183.ts — ticket T183 (fact14 D23; user ruling R73): a burst
 * window's pressured trough (`[BURST ANSWERED] … bottomed at N%`,
 * slow-defensive-response `pressuredHpPct`) stopped at the window's outcome
 * horizon, which a lapse in the damage can close while the opener's buff
 * runs on; the unit then dropped lower under the same buff and the line
 * kept the earlier number (ae1d0895 2:27: `bottomed at 55%`, 49 % ten
 * seconds later with the Avenging Wrath still up). R73: the trough reads on
 * to the buff's end, at most 10 s past the horizon, never into the next
 * window. The span is the producer's own (`burstTroughReadEnd`, asked here
 * with the window's own fields — never replayed).
 *
 * THIS SCAN RE-RUNS THE ENGINE: it reads the capture's archives, not its
 * text, so its numbers are those of the CHECKOUT it runs from, whatever
 * capture it is pointed at. A "before" number needs the base checkout (or
 * the engine's pass switched off); run from the head it reads 0 on any
 * capture.
 *
 * Population: every owner's team, every window with a pressured friendly
 * and a trough that is `feasible` — the windows a `[BURST ANSWERED]` line
 * (its other doors: answered, creditable, low <= 60 %) or a
 * slow-defensive-response row (its other doors: not answered, triaged,
 * healer owner) can print. The first version counted healer owners'
 * triaged windows only — the candidate's population — and so missed most
 * of the credit line's (25 windows there, 66 printed lines on the 605).
 *
 *  - `troughStopsBeforeBuffEnd`: such a window whose pressured unit
 *    reads LOWER than the printed trough (`troughHpPct`) on the grid in a
 *    second of that span after the horizon. Counted: every judged window
 *    with a trough.
 *  - `troughReadPastCut` (an inventory, out of the total): the judged
 *    windows whose span runs past the horizon at all. Kind = answered or
 *    not, what stops the reading, and whether the low the producer prints
 *    lies past the horizon (`troughReadToSec` set — the lines / rows that
 *    carry the `(read to m:ss…)` suffix / `pressuredReadToT`).
 */
import {
  burstTroughReadEnd,
  burstWindowDecisionPoints,
} from "@gladlog/analysis/src/analysis/burstWindowDecisionPoints";
import {
  gridHpPct,
  isDeadAtRenderSecond,
} from "@gladlog/analysis/src/utils/cooldowns";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";

import type { IRoundCtx } from "./ctx";

export const CHECKS = [
  "troughStopsBeforeBuffEnd",
  "troughReadPastCut",
] as const;

const STOPS = ["buff end", "cap", "next window", "death", "round end"];
const LOWS = ["low past the horizon", "low inside"];
export const OUT_OF_TOTAL = ["answered", "not answered"].flatMap((a) =>
  STOPS.flatMap((s) => LOWS.map((l) => `troughReadPastCut|${a} | ${s} | ${l}`)),
);

export function run(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  let points: ReturnType<typeof burstWindowDecisionPoints>;
  try {
    points = burstWindowDecisionPoints(ctx.legacy, {
      friendlyReaction: owner.reaction,
    });
  } catch {
    return;
  }
  // the engine's own round end (`roundEndMs`), not the scan context's
  // playable end, which stops at the first friendly death (codex
  // 85-tk-CD-T183-1b #1)
  const roundEndAt = roundEndMs(ctx.legacy);
  const roundEndSec = Number.isFinite(roundEndAt)
    ? Math.floor((roundEndAt - ctx.start) / 1000)
    : null;
  for (const p of points) {
    const pr = p.pressured;
    if (!p.feasible || pr === null || pr.minHpPct === null) continue;
    ctx.bump("troughStopsBeforeBuffEnd");
    ctx.bump("troughReadPastCut");
    const unit = ctx.units.find((u: any) => u.id === pr.unitId);
    if (!unit) continue;
    const deathMs = ((unit.deathRecords ?? []) as any[])
      .map((d) => d.timestamp as number)
      .filter((t) => t >= p.tMs)
      .sort((a, b) => a - b)[0];
    const read = burstTroughReadEnd({
      outcomeEndSec: p.outcomeEndSec,
      buffRunEndSec: p.buffRunEndSec,
      nextWindowTSec: points.find((q) => q.tSec > p.tSec)?.tSec ?? null,
      deathSec:
        deathMs === undefined ? null : Math.floor((deathMs - ctx.start) / 1000),
      roundEndSec,
    });
    if (!read) continue;
    const at = ctx.start + p.tSec * 1000;
    const fact = `${ctx.roundKey}|${owner.reaction}|${p.tSec}`;
    const printed = pr.troughHpPct ?? pr.minHpPct;
    ctx.violate(
      "troughReadPastCut",
      `${p.responded ? "answered" : "not answered"} | ${read.stop} | ${pr.troughReadToSec !== undefined ? LOWS[0] : LOWS[1]}`,
      at,
      `${fact}|span`,
      `window at ${p.tSec}s (${p.leadCd.spellName}), horizon ${p.outcomeEndSec}s, read to ${read.toSec}s (${read.stop}; ${p.buffRunEndSpellName} runs to ${p.buffRunEndSec}s): trough ${printed}% at ${pr.troughHpSec ?? pr.minHpSec}s`,
    );
    let low: number | null = null;
    let lowSec = 0;
    for (let s = p.outcomeEndSec + 1; s <= read.toSec; s++) {
      // the death second's tick reads the corpse; the trough keeps that
      // second's live samples (user ruling 2026-10-20)
      if (isDeadAtRenderSecond(unit, ctx.start, s)) break;
      const hp = gridHpPct(unit, ctx.start + s * 1000);
      if (hp !== null && (low === null || hp < low)) {
        low = hp;
        lowSec = s;
      }
    }
    if (low === null || low >= printed) continue;
    ctx.violate(
      "troughStopsBeforeBuffEnd",
      `${p.responded ? "answered" : "not answered"} | ${read.stop}`,
      at,
      fact,
      `window at ${p.tSec}s (${p.leadCd.spellName}), horizon ${p.outcomeEndSec}s, read to ${read.toSec}s (${read.stop}): trough ${printed}% at ${pr.troughHpSec ?? pr.minHpSec}s, grid ${low}% at ${lowSec}s (${printed - low} lower)`,
    );
  }
}
