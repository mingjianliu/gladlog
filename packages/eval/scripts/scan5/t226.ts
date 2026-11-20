/**
 * scan5/t226.ts — ticket T226 (user ruling R92, 2026-11-19): another
 * teammate's self-only healing CD is ignored for a burst on the pressured
 * unit (R75) — and the reader of "self-only" (`pressDidNotReachPressured`)
 * asks the hand-signed `HEALING_VERDICTS` table, which holds only the
 * Defensive-tagged healing cooldowns, so a self-only heal outside it
 * (Frenzied Regeneration, an extra answer) is not ignored.
 *
 * THIS SCAN RE-RUNS THE ENGINE: its numbers are the checkout's.
 *
 *  - `anothersSelfOnlyHealCd` (inventory, every owner): a healing-CD
 *    response whose caster is not the pressured unit and whose official
 *    DB2 profile heals its caster and nobody else (`officialSelfOnlyHeal`).
 *    Kind = the spell | in the signed table as self-only / not in the
 *    table | what the press's own rows show (on its caster alone / on
 *    others / no reading) | whether the engine ignores it today.
 *  - `anothersSelfOnlyHealCdAnswers`: the windows (a pressured friendly,
 *    no kite / attacker-moved answer) that are `responded` while every
 *    press that reached the pressured unit is such a response NOT ignored
 *    today. Kind = judged by the candidate / not judged | the spell(s).
 *    Counted: every window with a pressured friendly.
 */
import {
  burstWindowDecisionPoints,
  officialSelfOnlyHeal,
  pressDidNotReachPressured,
} from "@gladlog/analysis/src/analysis/burstWindowDecisionPoints";
import { burstWindowLongEnoughToJudge } from "@gladlog/analysis/src/analysis/candidates/burstWindowResponse";
import { HEALING_VERDICTS } from "@gladlog/analysis/src/data/healingVerdicts";
import { isHealerSpec } from "@gladlog/analysis/src/utils/cooldowns";

import { type IRoundCtx } from "./ctx";

export const CHECKS = [
  "anothersSelfOnlyHealCd",
  "anothersSelfOnlyHealCdAnswers",
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
    ctx.bump("anothersSelfOnlyHealCdAnswers");
    const mine = p.responseCasts.filter(
      (r) =>
        r.category === "healCd" &&
        r.casterId !== undefined &&
        r.casterId !== pr.unitId &&
        officialSelfOnlyHeal(r.spellId),
    );
    for (const r of mine) {
      ctx.bump("anothersSelfOnlyHealCd");
      const signed = HEALING_VERDICTS[r.spellId]?.official.healsOthers;
      ctx.violate(
        "anothersSelfOnlyHealCd",
        `${r.spellName} | ${signed === false ? "signed table: self-only" : signed === true ? "signed table: heals others" : "not in the signed table"} | rows: ${r.selfOnlyEffect === true ? "on its caster alone" : r.effectOnUnitIds !== undefined ? "on others" : "no reading"} | ${pressDidNotReachPressured(pr, r) ? "ignored today" : "answers today"}`,
        ctx.start + p.tSec * 1000,
        `${ctx.roundKey}|${owner.reaction}|${p.tSec}|${r.casterId}|${r.spellId}|${r.tSec}`,
        `window at ${p.tSec}s: ${r.casterName} ${r.spellName} ${r.latencySec}s; pressured ${pr.name}`,
      );
    }
    const live = mine.filter((r) => !pressDidNotReachPressured(pr, r));
    if (live.length === 0 || !p.responded) continue;
    if (p.responses.kite || p.responses.attackerMoved) continue;
    const others = p.responseCasts.filter(
      (r) => !live.includes(r) && !pressDidNotReachPressured(pr, r),
    );
    if (others.length > 0) continue;
    const judged =
      healer && p.feasible && p.triaged && burstWindowLongEnoughToJudge(p);
    ctx.violate(
      "anothersSelfOnlyHealCdAnswers",
      `${judged ? "judged by the candidate" : "not judged"} | ${[...new Set(live.map((r) => r.spellName))].sort().join(" + ")}`,
      ctx.start + p.tSec * 1000,
      `${ctx.roundKey}|${owner.reaction}|${p.tSec}`,
      `window at ${p.tSec}s (${p.leadCd.spellName}): ${live.map((r) => `${r.casterName} ${r.spellName} ${r.latencySec}s`).join(", ")}; pressured ${pr.name} low ${pr.minHpPct ?? "?"}%`,
    );
  }
}
