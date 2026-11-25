/* eslint-disable @typescript-eslint/no-explicit-any -- the legacy parse objects are untyped */
/**
 * scan5/t222.ts — ticket T222: the burst engine builds a window's answers
 * from cast rows alone, so a self-targeted answer whose press logs no cast
 * row never answers anything. Feign Death is one (its press is never a
 * SPELL_CAST_SUCCESS; the Survival Tactics aura / the `unconscious=1` row is
 * the evidence), a Renewing Blaze without a cast row another. The cooldown
 * ledger already reads those presses (`auraOnlyActivationSeconds`, the
 * source of `[TEAM] [CD] Feign Death`).
 *
 * THIS SCAN RE-RUNS THE ENGINE: its numbers are those of the checkout it
 * runs from, whatever capture it is pointed at.
 *
 *  - `castlessPressNotRead`: an engine window (every owner — the credit
 *    line prints for all of them) with a pressured friendly, and a castless
 *    press of an answer id by a friendly inside the window's 8 s, that
 *    `responseCasts` does not hold. Kind = whose press (the pressured unit's
 *    own / another friendly's — a self wall answers only its caster) | what
 *    the window is today (unanswered and judged by the candidate: a
 *    slow-defensive-response row can go; unanswered and creditable: a
 *    `[BURST ANSWERED]` line can appear; answered: the line may name
 *    another answer). Counted: every window with a pressured friendly.
 *  - `castlessPressCredited` (inventory): a creditable window (the credit
 *    line's own doors, before its 2-per-round cap) whose credited answer
 *    (`creditedAnswer`) is a castless press. None while the engine does not
 *    read them; with it, the `[BURST ANSWERED]` lines that would name Feign
 *    Death / Renewing Blaze. Kind = the spell | the only press / beside
 *    other presses.
 *  - `answeredOnlyByAnothersWall` (inventory, for ruling R68 — every wall,
 *    not only the castless ones): a window the candidate would judge
 *    (healer owner; feasible, triaged, long enough, no kite / attacker
 *    moved) that is `responded` and whose every press is a wall pressed by
 *    a unit other than the pressured one. Kind = the wall(s). These are the
 *    slow-defensive-response rows that would exist if another unit's own
 *    wall did not answer.
 *  - `castlessPressLogging` (inventory, once per round): for each id, the
 *    presses with a cast row and those the ledger reads from the aura
 *    alone — the forward check of "its press logs no cast row".
 */
import {
  BURST_EXTRA_ANSWER_IDS,
  burstResponseSpanMs,
  burstWindowDecisionPoints,
} from "@gladlog/analysis/src/analysis/burstWindowDecisionPoints";
import { burstWindowLongEnoughToJudge } from "@gladlog/analysis/src/analysis/candidates/burstWindowResponse";
import { creditedAnswer } from "@gladlog/analysis/src/context/burstAnswered";
import { AURA_ONLY_ACTIVATION_IDS } from "@gladlog/analysis/src/data/auraActivation";
import spellIdLists from "@gladlog/analysis/src/data/spellIdLists";
import {
  auraOnlyActivationSeconds,
  isHealerSpec,
} from "@gladlog/analysis/src/utils/cooldowns";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";

import { type IRoundCtx, nameOf, successesOf, tsOf } from "./ctx";

export const CHECKS = [
  "castlessPressNotRead",
  "castlessPressLogging",
  "castlessPressCredited",
  "answeredOnlyByAnothersWall",
] as const;

const WALLS = new Set<string>(spellIdLists.bigDefensiveSpellIds.map(String));
/** the aura-only table's ids that are a self-targeted answer */
const IDS = Object.keys(AURA_ONLY_ACTIVATION_IDS).filter(
  (id) => WALLS.has(id) || BURST_EXTRA_ANSWER_IDS.has(id),
);

export const OUT_OF_TOTAL: ReadonlySet<string> = new Set(
  IDS.flatMap((id) =>
    ["cast row", "aura only"].map(
      (k) => `castlessPressLogging|${nameOf(id)} | ${k}`,
    ),
  ),
);

/** creditable low, `BURST_ANSWERED_MAX_HP_PCT` (not exported at the base) */
const CREDIT_MAX_HP_PCT = 60;

export function run(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  const endMs = roundEndMs(ctx.legacy);
  const players = ctx.units.filter((u: any) => u.info);
  if (ctx.firstOwnerOfRound)
    for (const u of players)
      for (const id of IDS) {
        const casts = successesOf(u).filter(
          (c: any) =>
            String(c.spellId) === id &&
            tsOf(c) >= ctx.start &&
            tsOf(c) <= endMs,
        ).length;
        const aura = auraOnlyActivationSeconds(u, id, ctx.start, endMs).filter(
          (s) => s >= 0,
        ).length;
        const C = "castlessPressLogging";
        for (let i = 0; i < casts; i++)
          ctx.violate(
            C,
            `${nameOf(id)} | cast row`,
            ctx.start,
            `${ctx.roundKey}|${u.id}|${id}|c${i}`,
            u.name,
          );
        for (let i = 0; i < aura; i++)
          ctx.violate(
            C,
            `${nameOf(id)} | aura only`,
            ctx.start,
            `${ctx.roundKey}|${u.id}|${id}|a${i}`,
            u.name,
          );
      }

  let points: ReturnType<typeof burstWindowDecisionPoints>;
  try {
    points = burstWindowDecisionPoints(ctx.legacy, {
      friendlyReaction: owner.reaction,
    });
  } catch {
    return;
  }
  const friendlies = players.filter((u: any) => u.reaction === owner.reaction);
  const presses: { u: any; id: string; s: number }[] = [];
  for (const u of friendlies)
    for (const id of IDS)
      for (const s of auraOnlyActivationSeconds(u, id, ctx.start, endMs))
        presses.push({ u, id, s });
  for (const p of points) {
    const pr = p.pressured;
    if (!pr || !p.feasible || !p.responded) continue;
    if (pr.minHpPct === null || pr.minHpPct > CREDIT_MAX_HP_PCT) continue;
    const first = creditedAnswer(p);
    if (!first || !IDS.includes(first.spellId)) continue;
    if (
      successesOf(
        ctx.units.find((u: any) => u.id === first.casterId) ?? {},
      ).some((c: any) => String(c.spellId) === first.spellId)
    )
      continue;
    const others = p.responseCasts.filter((r) => r !== first);
    ctx.violate(
      "castlessPressCredited",
      `${nameOf(first.spellId)} | ${others.length ? "beside other presses" : "the only press"}`,
      ctx.start + p.tSec * 1000,
      `${ctx.roundKey}|${owner.reaction}|${p.tSec}`,
      `window at ${p.tSec}s (${p.leadCd?.spellName ?? "?"}): ${first.casterName} ${first.spellName} ${first.latencySec}s${others.length ? `; next press ${others[0]!.spellName} ${others[0]!.latencySec}s` : ""}; low ${pr.minHpPct}%`,
    );
  }
  if (isHealerSpec(owner.spec))
    for (const p of points) {
      const pr = p.pressured;
      if (
        !pr ||
        !p.responded ||
        !p.feasible ||
        !p.triaged ||
        !burstWindowLongEnoughToJudge(p) ||
        p.responses.kite ||
        p.responses.attackerMoved ||
        p.responseCasts.length === 0 ||
        !p.responseCasts.every(
          (r) => r.category === "wall" && r.casterId !== pr.unitId,
        )
      )
        continue;
      ctx.violate(
        "answeredOnlyByAnothersWall",
        [...new Set(p.responseCasts.map((r) => r.spellName))]
          .sort()
          .join(" + "),
        ctx.start + p.tSec * 1000,
        `${ctx.roundKey}|${owner.reaction}|${p.tSec}`,
        `window at ${p.tSec}s (${p.leadCd?.spellName ?? "?"}): ${p.responseCasts.map((r) => `${r.casterName} ${r.spellName} ${r.latencySec}s`).join(", ")}; pressured ${pr.name} low ${pr.minHpPct ?? "?"}%${p.anyFriendlyDeath ? ", a friendly died" : ""}`,
      );
    }
  const C = "castlessPressNotRead";
  const healer = isHealerSpec(owner.spec);
  for (const p of points) {
    if (p.pressured === null) continue;
    ctx.bump(C);
    for (const x of presses) {
      // the engine's own span (`burstResponseSpanMs`: its start from the
      // opener's ms, R113), in round seconds
      const span = burstResponseSpanMs(p.tMs, p.leadMs);
      if (
        x.s < (span.w0 - (p.tMs - p.tSec * 1000)) / 1000 ||
        x.s > (span.w1 - (p.tMs - p.tSec * 1000)) / 1000
      )
        continue;
      if (
        p.responseCasts.some((r) => r.spellId === x.id && r.casterId === x.u.id)
      )
        continue;
      const own = x.u.id === p.pressured.unitId;
      const low = p.pressured.minHpPct;
      const state = p.responded
        ? p.feasible && low !== null && low <= CREDIT_MAX_HP_PCT
          ? "answered, credit line possible"
          : "answered, no credit line"
        : healer && p.feasible && p.triaged && burstWindowLongEnoughToJudge(p)
          ? "unanswered, judged by the candidate"
          : p.feasible && low !== null && low <= CREDIT_MAX_HP_PCT
            ? "unanswered, creditable low"
            : "unanswered, neither";
      ctx.violate(
        C,
        `${nameOf(x.id)} | ${own ? "the pressured unit's own" : "another friendly's"} | ${state}`,
        ctx.start + p.tSec * 1000,
        `${ctx.roundKey}|${owner.reaction}|${p.tSec}|${x.u.id}|${x.id}`,
        `window at ${p.tSec}s (${p.leadCd?.spellName ?? "?"}): ${x.u.name} pressed ${nameOf(x.id)} at ${x.s.toFixed(1)}s; engine answers: ${p.responseCasts.map((r) => `${r.spellName} ${r.latencySec.toFixed(1)}s`).join(", ") || "none"}; pressured ${p.pressured.name} low ${low ?? "?"}%; feasible=${p.feasible} triaged=${p.triaged}`,
      );
    }
  }
}
