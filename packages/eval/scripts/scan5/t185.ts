/* eslint-disable @typescript-eslint/no-explicit-any -- the legacy parse objects are untyped */
/**
 * scan5/t185.ts — ticket T185 (fact13 retest P6, 36e987ca 2:28): a burst
 * window's opener (and its `+X` extras) can be a cast-less proc copy of an
 * offensive cooldown — the timeline prints it `X (no press)` on `[ENEMY CD]`
 * and in `[OFFENSIVE WINDOW]` — and the burst engine re-reads the name from
 * the id, so `[BURST ANSWERED] enemy opened X` and the
 * slow-defensive-response row's `leadCd` present a proc as a press.
 *
 * THIS SCAN RE-RUNS THE ENGINE: its numbers are the checkout's.
 *
 *  - `burstCdIsNoPressCopy`: an engine window (every owner) with a pressured
 *    friendly whose lead, or one of whose extras, is at that second an
 *    entry the timeline's own builder names `(no press)`
 *    (`reconstructEnemyCDTimeline`'s window list, the one the engine and
 *    `[OFFENSIVE WINDOW]` read) while the engine's name for it carries no
 *    such mark. Kind = lead / extra | the spell | what the window is (a
 *    credit line can print; judged by the candidate; neither). Counted:
 *    every lead and extra of every such window.
 */
import { burstWindowDecisionPoints } from "@gladlog/analysis/src/analysis/burstWindowDecisionPoints";
import { BURST_WINDOW_MIN_JUDGED_S } from "@gladlog/analysis/src/analysis/candidates/burstWindowResponse";
import { isHealerSpec } from "@gladlog/analysis/src/utils/cooldowns";
import { reconstructEnemyCDTimeline } from "@gladlog/analysis/src/utils/enemyCDs";
import { NO_PRESS_SUFFIX } from "@gladlog/analysis/src/utils/offensiveAuraOccurrences";

import { type IRoundCtx } from "./ctx";

export const CHECKS = ["burstCdIsNoPressCopy"] as const;

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
  const C = "burstCdIsNoPressCopy";
  const healer = isHealerSpec(owner.spec);
  const enemies = ctx.players.filter((u: any) => u.reaction !== owner.reaction);
  const marked = reconstructEnemyCDTimeline(enemies, ctx.legacy)
    .alignedBurstWindows.flatMap((w) => w.activeCDs)
    .filter((c) => c.spellName.endsWith(NO_PRESS_SUFFIX));
  for (const p of points) {
    if (p.pressured === null) continue;
    const low = p.pressured.minHpPct;
    const state =
      p.responded && p.feasible && low !== null && low <= 60
        ? "a credit line can print"
        : !p.responded &&
            healer &&
            p.feasible &&
            p.triaged &&
            p.durationSec >= BURST_WINDOW_MIN_JUDGED_S
          ? "judged by the candidate"
          : "neither";
    const cds: [string, (typeof p)["leadCd"]][] = [
      ["lead", p.leadCd],
      ...p.extraCds.map((c): [string, (typeof p)["leadCd"]] => ["extra", c]),
    ];
    for (const [role, cd] of cds) {
      ctx.bump(C);
      if (cd.spellName.endsWith(NO_PRESS_SUFFIX)) continue;
      // the timeline's own name for this cast: the entry of the builder's
      // windows the engine read it from (an occurrence the builder folded
      // into a press made unseen is that press, not a copy)
      const occ = marked.find(
        (o) =>
          o.spellId === cd.spellId &&
          o.playerName === cd.casterName &&
          Math.floor(o.castSeconds) === cd.castSec,
      );
      if (!occ) continue;
      ctx.violate(
        C,
        `${role} | ${cd.spellName} | ${state}`,
        ctx.start + p.tSec * 1000,
        `${ctx.roundKey}|${owner.reaction}|${p.tSec}|${cd.spellId}|${cd.castSec}`,
        `window at ${p.tSec}s: ${role} ${cd.spellName} by ${cd.casterName} at ${cd.castSec}s is the timeline's "${occ.spellName}"; responded=${p.responded} low ${low ?? "?"}%`,
      );
    }
  }
}
