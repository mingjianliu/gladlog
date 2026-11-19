/* eslint-disable @typescript-eslint/no-explicit-any -- the legacy parse objects are untyped */
/**
 * scan5/t180.ts — ticket T180 (user rulings A7 / R65 / R68): a burst window
 * is `responded` — and slow-defensive-response withheld — on a press that
 * went elsewhere: an external aimed at another unit, a healing cooldown
 * that healed others and not the pressured unit, a control that did not
 * land (the producer's `pressWentElsewhere`, which the `[BURST ANSWERED]`
 * credit line asks too). Healer owners, the candidate's own scope.
 *
 *  - `respondedOnElsewherePress`: a judged window (feasible, triaged, a
 *    pressured friendly, at least `BURST_WINDOW_MIN_JUDGED_S` long) with
 *    one response or more, no kite and no attacker-moved, every response
 *    one `pressWentElsewhere` holds for — and the engine says `responded`.
 *    Kind = the first response's reading. Counted: every judged window
 *    with a response.
 *  - `respondedOnRefusedPress` (an inventory, out of the total): the same
 *    windows where every response is one the credit line
 *    (`answersPressured`) refuses and at least one is NOT a went-elsewhere
 *    reading — the classes the user left as they are (another unit's own
 *    wall, a control off before the opener, an effect over before the
 *    trough, a press after the unit's death). Kind = the first response's
 *    refusal.
 */
import {
  burstWindowDecisionPoints,
  pressDidNotReachPressured,
  pressWentElsewhere,
} from "@gladlog/analysis/src/analysis/burstWindowDecisionPoints";
import { BURST_WINDOW_MIN_JUDGED_S } from "@gladlog/analysis/src/analysis/candidates/burstWindowResponse";
import { answersPressured } from "@gladlog/analysis/src/context/burstAnswered";
import { isHealerSpec } from "@gladlog/analysis/src/utils/cooldowns";

import { type IRoundCtx, nameOf } from "./ctx";

export const CHECKS = [
  "respondedOnElsewherePress",
  "respondedOnRefusedPress",
] as const;

const REFUSALS = [
  "another unit's own wall",
  "control off before the opener",
  "over before the trough",
  "pressed after the unit died",
  "other",
];
export const OUT_OF_TOTAL = REFUSALS.map((r) => `respondedOnRefusedPress|${r}`);

function elsewhere(r: any): string {
  return r.category === "external"
    ? "external aimed at another unit"
    : r.category === "control"
      ? "control did not land"
      : "healing CD that healed others";
}

/** the window's class: its first press that went elsewhere, or — R75 —
 * "only ignored presses" when all it holds is another unit's self-only save
 * or an interrupt that interrupted nothing */
function kindOf(pr: any, casts: any[]): string {
  const e = casts.find((r) => pressWentElsewhere(pr, r));
  return e ? elsewhere(e) : "only ignored presses";
}

function refusal(pr: any, r: any): string {
  if (r.afterPressuredDeath) return "pressed after the unit died";
  if (r.category === "control") return "control off before the opener";

  if (r.category === "wall" && r.casterId !== pr.unitId)
    return "another unit's own wall";
  if (
    r.effectEndSec !== undefined &&
    pr.minHpSec !== null &&
    r.effectEndSec < pr.minHpSec
  )
    return "over before the trough";
  return "other";
}

export function run(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner || !isHealerSpec(owner.spec)) return;
  let points: ReturnType<typeof burstWindowDecisionPoints>;
  try {
    points = burstWindowDecisionPoints(ctx.legacy, {
      friendlyReaction: owner.reaction,
    });
  } catch {
    return;
  }
  for (const p of points) {
    const pr = p.pressured;
    if (
      !p.feasible ||
      !p.triaged ||
      pr === null ||
      p.durationSec < BURST_WINDOW_MIN_JUDGED_S ||
      p.responseCasts.length === 0
    )
      continue;
    ctx.bump("respondedOnElsewherePress");
    ctx.bump("respondedOnRefusedPress");
    if (p.responses.kite || p.responses.attackerMoved) continue;
    const at = ctx.start + p.tSec * 1000;
    const fact = `${ctx.roundKey}|${owner.reaction}|${p.tSec}`;
    const detail = `window at ${p.tSec}s (${nameOf(p.leadCd.spellId, (p.leadCd as any).spellName)}): ${p.responseCasts.map((r) => `${nameOf(r.spellId, (r as any).spellName)} [${pressWentElsewhere(pr, r) ? elsewhere(r) : answersPressured(pr, r) ? "reaches" : refusal(pr, r)}]`).join(", ")}; pressured low ${pr.minHpPct ?? "?"}%${p.anyFriendlyDeath ? ", a friendly died" : ""}; engine responded=${p.responded}`;
    if (p.responseCasts.every((r) => pressDidNotReachPressured(pr, r))) {
      if (p.responded)
        ctx.violate(
          "respondedOnElsewherePress",
          kindOf(pr, p.responseCasts),
          at,
          fact,
          detail,
        );
      continue;
    }
    if (p.responseCasts.every((r) => !answersPressured(pr, r))) {
      const r = p.responseCasts.find((x) => !pressDidNotReachPressured(pr, x))!;
      ctx.violate("respondedOnRefusedPress", refusal(pr, r), at, fact, detail);
    }
  }
}
