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
 *    pressured friendly, long enough to judge — `burstWindowLongEnoughToJudge`,
 *    user ruling R103) with
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
 *    refusal. A window the credit line names a teammate's team-heal wall
 *    for (`teamHealWallCredit`, ruling R110) is not one of them.
 *  - `ignoredHealCdById` (inventory, every owner): every healing-CD
 *    response by a unit other than the pressured one whose official verdict
 *    is self-only (`HEALING_VERDICTS.official.healsOthers === false`) — the
 *    ids ruling R75 ignores. Kind = the spell's id (the name is in the
 *    detail). Out of the total: an ignored press is the ruled behaviour,
 *    not a failure (assembly review 80-PIPE-169b-B155).
 *  - `selfOnlyRowsHealCd` (inventory, every owner): a healing-CD response
 *    by another unit that the press's own rows show on its caster alone
 *    (`selfOnlyEffect`) while the official verdict does not say self-only.
 *    The credit line refuses it (T123); the candidate must count it
 *    (assembly review 80-PIPE-169-B155). Kind = the spell's id | what the
 *    candidate does with it. Out of the total, every kind.
 */
import {
  BURST_EXTRA_ANSWER_IDS,
  BURST_HEAL_CD_IDS,
  burstWindowDecisionPoints,
  pressDidNotReachPressured,
  pressWentElsewhere,
} from "@gladlog/analysis/src/analysis/burstWindowDecisionPoints";
import { burstWindowLongEnoughToJudge } from "@gladlog/analysis/src/analysis/candidates/burstWindowResponse";
import {
  answersPressured,
  teamHealWallCredit,
} from "@gladlog/analysis/src/context/burstAnswered";
import { HEALING_VERDICTS } from "@gladlog/analysis/src/data/healingVerdicts";
import { isHealerSpec } from "@gladlog/analysis/src/utils/cooldowns";

import { type IRoundCtx, nameOf } from "./ctx";

export const CHECKS = [
  "respondedOnElsewherePress",
  "respondedOnRefusedPress",
  "ignoredHealCdById",
  "selfOnlyRowsHealCd",
] as const;

const REFUSALS = [
  "another unit's own wall",
  "control off before the opener",
  "over before the trough",
  "pressed after the unit died",
  "other",
];
/** what the candidate does with a press whose rows are on its caster alone */
const SELF_ONLY_ROWS_STATES = [
  "ignored by the candidate too",
  "counts for the candidate, beside a creditable answer",
  "counts for the candidate, no creditable answer in the window",
];
/** the ids a healing-CD response can carry; any other reads "other" */
const HEAL_CD_KIND_IDS: ReadonlySet<string> = new Set([
  ...Object.keys(HEALING_VERDICTS),
  ...BURST_HEAL_CD_IDS,
  ...BURST_EXTRA_ANSWER_IDS,
]);
const kindId = (spellId: string): string =>
  HEAL_CD_KIND_IDS.has(spellId) ? spellId : "other";
// the two inventories are counts of ruled behaviour: every kind they can
// emit is listed, so neither ever reaches a check's total
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  ...REFUSALS.map((r) => `respondedOnRefusedPress|${r}`),
  ...[...HEAL_CD_KIND_IDS, "other"].flatMap((id) => [
    `ignoredHealCdById|${id}`,
    ...SELF_ONLY_ROWS_STATES.map((st) => `selfOnlyRowsHealCd|${id} | ${st}`),
  ]),
]);

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
  if (!owner) return;
  const healer = isHealerSpec(owner.spec);
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
    if (pr !== null)
      for (const r of p.responseCasts) {
        if (
          r.category !== "healCd" ||
          r.casterId === undefined ||
          r.casterId === pr.unitId
        )
          continue;
        const official =
          HEALING_VERDICTS[r.spellId]?.official.healsOthers === false;
        if (!official && r.selfOnlyEffect !== true) continue;
        const fact = `${ctx.roundKey}|${owner.reaction}|${p.tSec}|${r.casterId}|${r.spellId}|${r.tSec}`;
        const at = ctx.start + p.tSec * 1000;
        const name = nameOf(r.spellId, (r as any).spellName);
        if (official) {
          ctx.bump("ignoredHealCdById");
          ctx.violate(
            "ignoredHealCdById",
            kindId(r.spellId),
            at,
            fact,
            `window at ${p.tSec}s: ${r.casterName} ${name} ${r.latencySec}s; ignored=${pressDidNotReachPressured(pr, r)}`,
          );
          continue;
        }
        // the press's own rows show it on its caster alone, the official
        // verdict does not say self-only: the credit line refuses it, the
        // candidate counts it
        const others = p.responseCasts.filter(
          (x) => x !== r && answersPressured(pr, x),
        );
        ctx.bump("selfOnlyRowsHealCd");
        ctx.violate(
          "selfOnlyRowsHealCd",
          `${kindId(r.spellId)} | ${SELF_ONLY_ROWS_STATES[pressDidNotReachPressured(pr, r) ? 0 : others.length > 0 || p.responses.kite || p.responses.attackerMoved ? 1 : 2]}`,
          at,
          fact,
          `window at ${p.tSec}s: ${r.casterName} ${name} ${r.latencySec}s; responded=${p.responded}`,
        );
      }
    if (
      !healer ||
      !p.feasible ||
      !p.triaged ||
      pr === null ||
      !burstWindowLongEnoughToJudge(p) ||
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
    // …unless the credit line names a teammate's team-heal wall for it
    // (`teamHealWallCredit`, ruling R110): that window is answered by a
    // press the line credits
    if (
      p.responseCasts.every((r) => !answersPressured(pr, r)) &&
      teamHealWallCredit(p) === undefined
    ) {
      const r = p.responseCasts.find((x) => !pressDidNotReachPressured(pr, x))!;
      ctx.violate("respondedOnRefusedPress", refusal(pr, r), at, fact, detail);
    }
  }
}
