/**
 * scan5/t224.ts — ticket T224 (user ruling R81, 2026-11-19, changing R68):
 * a wall that protects only its owner, pressed by a teammate OTHER than the
 * pressured unit, is ignored for that burst window — neither an answer nor
 * a press that went elsewhere (as R75's self-only healing CD). The pressured
 * unit's own walls still answer.
 *
 * THIS SCAN RE-RUNS THE ENGINE: its numbers are the checkout's.
 *
 * "Another unit's own wall" here is the engine's own category: a `wall`
 * response (a `bigDefensiveSpellIds` press, or an extra answer pressed on
 * its caster / untargeted with no reach to others) whose caster is not the
 * pressured unit.
 *
 *  - `anothersOwnWallAnswers`: an engine window (every owner, a pressured
 *    friendly, no kite / attacker-moved answer) that is `responded` while
 *    every press in it that reached the pressured unit
 *    (`pressDidNotReachPressured` false) is another unit's own wall. Kind =
 *    what the window is (judged by the candidate: a slow-defensive-response
 *    row can appear; not judged) | the wall(s). Counted: every window with
 *    a pressured friendly.
 *  - `anothersOwnWallById` (inventory): every such wall press in a window,
 *    by spell (id) | what the code already knows of it (GH #28's
 *    `canHelpAnotherUnit`: can help another unit / own protection only) |
 *    whether the press has a cast row | the window's only kind of answer /
 *    beside another answer.
 *
 * User ruling R93 (2026-11-19) narrows R81 to pure self-protection: a wall
 * press that is also a healing cooldown for the team (Tree of Life, Ancient
 * of Lore, Ultimate Penitence, a pressed Spirit of Redemption) stays an
 * answer. `anothersOwnWallAnswers` counts under that reading: the walls it
 * holds are every `wall` response of another unit except R93's signed
 * table (`TEAM_HEAL_WALL_ANSWER_IDS`) and — user ruling R97 — a teammate's
 * Mass Invisibility whose aura landed on the pressured unit. 0 on the
 * fixing checkout.
 *  - `anothersPressCategory` (inventory): every non-control response whose
 *    caster is not the pressured unit, by spell | the engine's category —
 *    which presses the `wall` reading reaches and which it does not.
 */
import {
  burstWindowDecisionPoints,
  pressDidNotReachPressured,
  TEAM_HEAL_WALL_ANSWER_IDS,
} from "@gladlog/analysis/src/analysis/burstWindowDecisionPoints";
import { BURST_WINDOW_MIN_JUDGED_S } from "@gladlog/analysis/src/analysis/candidates/burstWindowResponse";
import {
  canHelpAnotherUnit,
  isHealerSpec,
} from "@gladlog/analysis/src/utils/cooldowns";

import { type IRoundCtx, successesOf, tsOf } from "./ctx";

export const CHECKS = [
  "anothersOwnWallAnswers",
  "anothersOwnWallById",
  "anothersPressCategory",
] as const;

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
  const healer = isHealerSpec(owner.spec);
  for (const p of points) {
    const pr = p.pressured;
    if (pr === null) continue;
    ctx.bump("anothersOwnWallAnswers");
    // every press by a unit other than the pressured one, by the category
    // the engine gave it (an inventory: which ids the `wall` reading
    // reaches and which it does not)
    for (const r of p.responseCasts) {
      if (r.casterId === undefined || r.casterId === pr.unitId) continue;
      if (r.category === "control") continue;
      ctx.bump("anothersPressCategory");
      ctx.violate(
        "anothersPressCategory",
        `${r.spellName} | ${r.category}${r.category === "external" ? (r.destId === pr.unitId ? " on the pressured unit" : " on another unit") : ""}`,
        ctx.start + p.tSec * 1000,
        `${ctx.roundKey}|${owner.reaction}|${p.tSec}|${r.casterId}|${r.spellId}|${r.tSec}`,
        `window at ${p.tSec}s: ${r.casterName} ${r.spellName} ${r.latencySec}s dest ${r.destId ?? "-"}; pressured ${pr.name}`,
      );
    }
    const allWalls = p.responseCasts.filter(
      (r) =>
        r.category === "wall" &&
        r.casterId !== undefined &&
        r.casterId !== pr.unitId,
    );
    if (allWalls.length === 0) continue;
    // the walls R81 ignores: not R93's signed team-heal walls
    // (`TEAM_HEAL_WALL_ANSWER_IDS`), and not a Mass Invisibility whose aura
    // landed on the pressured unit (ruling R97, read from the response's
    // own per-recipient holders)
    const walls = allWalls.filter(
      (r) =>
        !TEAM_HEAL_WALL_ANSWER_IDS.has(r.spellId) &&
        !(
          r.spellId === "414664" &&
          r.effectOnUnitIds?.includes(pr.unitId) === true
        ),
    );
    const others = p.responseCasts.filter(
      (r) => !walls.includes(r) && !pressDidNotReachPressured(pr, r),
    );
    const moved = p.responses.kite || p.responses.attackerMoved;
    const only = others.length === 0 && !moved;
    const fact = `${ctx.roundKey}|${owner.reaction}|${p.tSec}`;
    for (const w of allWalls) {
      ctx.bump("anothersOwnWallById");
      const caster = ctx.units.find((u: any) => u.id === w.casterId);
      const castRow =
        caster !== undefined &&
        successesOf(caster).some(
          (c: any) =>
            String(c.spellId) === w.spellId &&
            Math.floor((tsOf(c) - ctx.start) / 1000) === w.tSec,
        );
      ctx.violate(
        "anothersOwnWallById",
        `${w.spellName} (${w.spellId}) | ${canHelpAnotherUnit(w.spellId) ? "can help another unit" : "own protection only"} | ${castRow ? "cast row" : "no cast row"} | ${only ? "the window's only kind of answer" : "beside another answer"}`,
        ctx.start + p.tSec * 1000,
        `${fact}|${w.casterId}|${w.spellId}|${w.tSec}`,
        `window at ${p.tSec}s: ${w.casterName} ${w.spellName} ${w.latencySec}s; pressured ${pr.name}`,
      );
    }
    if (walls.length === 0 || !only || !p.responded) continue;
    const judged =
      healer &&
      p.feasible &&
      p.triaged &&
      p.durationSec >= BURST_WINDOW_MIN_JUDGED_S;
    ctx.violate(
      "anothersOwnWallAnswers",
      `${judged ? "judged by the candidate" : "not judged"} | ${[...new Set(walls.map((r) => r.spellName))].sort().join(" + ")}`,
      ctx.start + p.tSec * 1000,
      fact,
      `window at ${p.tSec}s (${p.leadCd.spellName}): ${walls.map((r) => `${r.casterName} ${r.spellName} ${r.latencySec}s`).join(", ")}; pressured ${pr.name} low ${pr.minHpPct ?? "?"}%${pr.died ? ", died" : ""}${p.anyFriendlyDeath && !pr.died ? ", a friendly died" : ""}`,
    );
  }
}
