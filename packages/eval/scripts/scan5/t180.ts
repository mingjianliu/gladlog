/* eslint-disable @typescript-eslint/no-explicit-any -- the legacy parse objects are untyped */
/**
 * scan5/t180.ts — ticket T180 (user ruling A7, PREVIEW ONLY): the
 * slow-defensive-response candidate is withheld when the window was
 * `responded`, and `responded` counts any wall / external / healing cooldown
 * / control in `responseCasts` — also a press the `[BURST ANSWERED]` credit
 * line refuses because its effect did not reach the pressured unit
 * (`answersPressured`: an external on another unit, another unit's own
 * wall, a self-only heal, an aura that went on others, a press after the
 * unit's death, an effect over before the trough, a control that did not
 * land). Nothing is changed in the product; this counts what the stricter
 * reading would do, on healer owners (the candidate's own scope).
 *
 *  - `respondedOnlyByMissedPress`: a judged window (feasible, triaged, a
 *    pressured friendly, at least `BURST_WINDOW_MIN_JUDGED_S` long) that is
 *    `responded` today and would not be if only presses `answersPressured`
 *    accepts counted (kite / attacker-moved kept as they are). Kind = why
 *    the window's first response is refused. Counted: every judged window
 *    that is `responded` today.
 *  - `candidateRowAdded`: a slow-defensive-response row the candidate
 *    builder emits under the stricter reading and not today (same builder,
 *    same reference lookup, same cap). Counted: rows emitted today.
 *  - `candidateRowRemoved`: a row emitted today that the stricter reading
 *    drops (the cap of two taken by a more dangerous window). Out of the
 *    total; same count.
 *  - `rowNotInMenu`: a row this module's call of the builder emits today
 *    that the captured menu does not carry — the module's own soundness
 *    check. Counted: rows emitted today.
 */
import { burstWindowDecisionPoints } from "@gladlog/analysis/src/analysis/burstWindowDecisionPoints";
import {
  BURST_WINDOW_MIN_JUDGED_S,
  burstWindowResponseEvents,
} from "@gladlog/analysis/src/analysis/candidates/burstWindowResponse";
import { answersPressured } from "@gladlog/analysis/src/context/burstAnswered";
import { lookupBurstWindowPrior } from "@gladlog/analysis/src/data/burstWindowPrior";
import { isHealerSpec } from "@gladlog/analysis/src/utils/cooldowns";

import { type IRoundCtx, nameOf } from "./ctx";

export const CHECKS = [
  "respondedOnlyByMissedPress",
  "candidateRowAdded",
  "candidateRowRemoved",
  "rowNotInMenu",
] as const;

export const OUT_OF_TOTAL = ["candidateRowRemoved|displaced by the cap"];

function refusal(pr: any, r: any): string {
  if (r.afterPressuredDeath) return "pressed after the unit died";
  if (r.category === "control")
    return r.landed === false
      ? "control did not land"
      : "control off before the opener";
  if (
    r.category === "external" &&
    r.destId !== undefined &&
    !/^0+$/.test(r.destId) &&
    r.destId !== pr.unitId
  )
    return "external aimed at another unit";
  // the credit line's wall rule looks at the caster alone: a wall-category
  // press AIMED AT the pressured unit by a teammate is refused too — split
  // out, it is the reading the user has to see
  if (r.category === "wall" && r.casterId !== pr.unitId)
    return r.destId === pr.unitId
      ? "wall-category press by a teammate AIMED AT the unit"
      : "another unit's own wall";
  if (r.effectOnUnitIds !== undefined && !r.effectOnUnitIds.includes(pr.unitId))
    return `${r.category}: aura on others, not on the unit`;
  if (r.category === "healCd" && r.casterId !== pr.unitId)
    return "self-only heal of another unit";
  if (
    r.effectEndSec !== undefined &&
    pr.minHpSec !== null &&
    r.effectEndSec < pr.minHpSec
  )
    return `${r.category}: over before the trough`;
  return `${r.category}: other`;
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
  const bracket: string = ctx.legacy?.startInfo?.bracket ?? "";
  const probes = {
    lookup: (id: string) => lookupBurstWindowPrior(bracket, id),
  };
  const strictOf = (p: (typeof points)[number]): boolean =>
    p.pressured === null
      ? p.responded
      : p.responses.kite ||
        p.responses.attackerMoved ||
        p.responseCasts.some((r) => answersPressured(p.pressured!, r));
  for (const p of points) {
    if (
      !p.feasible ||
      !p.triaged ||
      p.pressured === null ||
      p.durationSec < BURST_WINDOW_MIN_JUDGED_S ||
      !p.responded
    )
      continue;
    ctx.bump("respondedOnlyByMissedPress");
    if (strictOf(p)) continue;
    const first = p.responseCasts[0]!;
    ctx.violate(
      "respondedOnlyByMissedPress",
      refusal(p.pressured, first),
      ctx.start + p.tSec * 1000,
      `${ctx.roundKey}|${owner.reaction}|${p.tSec}`,
      `window at ${p.tSec}s (${nameOf(p.leadCd.spellId, (p.leadCd as any).spellName)}), ${p.responseCasts.length} response(s), first ${nameOf(first.spellId, (first as any).spellName)}; pressured low ${p.pressured.minHpPct ?? "?"}%${p.anyFriendlyDeath ? ", a friendly died" : ""}`,
    );
  }
  const today = burstWindowResponseEvents(points, owner, probes);
  const strict = burstWindowResponseEvents(
    points.map((p) => ({ ...p, responded: strictOf(p) })),
    owner,
    probes,
  );
  const ids = (es: typeof today) => new Set(es.map((e) => e.id));
  const a = ids(today);
  const b = ids(strict);
  ctx.bump("candidateRowAdded", today.length);
  ctx.bump("candidateRowRemoved", today.length);
  ctx.bump("rowNotInMenu", today.length);
  const tOf = (id: string) => Number(id.split(":").pop());
  const describe = (id: string): string => {
    const p = points.find((x) => x.tSec === tOf(id));
    if (!p || !p.pressured) return id;
    return `window at ${p.tSec}s (${nameOf(p.leadCd.spellId, (p.leadCd as any).spellName)}): responses ${p.responseCasts.map((r) => `${nameOf(r.spellId, (r as any).spellName)} [${answersPressured(p.pressured!, r) ? "reaches" : refusal(p.pressured, r)}]`).join(", ") || "none"}; pressured low ${p.pressured.minHpPct ?? "?"}%${p.anyFriendlyDeath ? ", a friendly died" : ""}`;
  };
  for (const id of b)
    if (!a.has(id))
      ctx.violate(
        "candidateRowAdded",
        "added",
        ctx.start + tOf(id) * 1000,
        `${ctx.roundKey}|${id}`,
        describe(id),
      );
  for (const id of a) {
    if (!b.has(id))
      ctx.violate(
        "candidateRowRemoved",
        "displaced by the cap",
        ctx.start + tOf(id) * 1000,
        `${ctx.roundKey}|${id}`,
        describe(id),
      );
    if (!ctx.menu.includes(`id=${id}`))
      ctx.violate(
        "rowNotInMenu",
        "missing",
        ctx.start + tOf(id) * 1000,
        `${ctx.roundKey}|${id}`,
        id,
      );
  }
}
