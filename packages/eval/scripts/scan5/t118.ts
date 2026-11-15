/* eslint-disable @typescript-eslint/no-explicit-any -- the check walks the untyped legacy parse objects */
/**
 * scan5/t118.ts — ticket T118 (fact12 retest M3, 60bfdea9 2:16): a
 * missed-cleanse row with no `latencyS` reads as a control no teammate
 * removed. A root freed by a Blessing of Freedom / Tiger's Lust cast on the
 * rooted unit (`TARGET_BOUND_MOBILITY_IDS`) is removed by that teammate even
 * when the cast logs no SPELL_DISPEL row.
 *
 *  - `rootFreedReadUncleansed`: a missed-cleanse menu row with no
 *    `latencyS` whose control is a root of that name on the target
 *    (`ROOT_SPELL_IDS`). Violation: the REMOVED closing the row's own
 *    APPLIED, inside the round and not its running out
 *    (`rootRanOutAtDrTier` on `ccFullDurationForApplication`), lands within
 *    `ALLY_DISPEL_MATCH_TOLERANCE_S` of a
 *    SPELL_CAST_SUCCESS of a freedom id on the target by a player of the
 *    target's team (the target included). Counted: every such root row.
 */
import { ROOT_SPELL_IDS } from "@gladlog/analysis/src/data/rootSpells";
import { TARGET_BOUND_MOBILITY_IDS } from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import { ccRecastSplitsResend } from "@gladlog/analysis/src/utils/drAnalysis";
import {
  ALLY_DISPEL_MATCH_TOLERANCE_S,
  rootRanOutAtDrTier,
} from "@gladlog/analysis/src/utils/dispelAnalysis";

import { dropAuraRebroadcasts } from "@gladlog/analysis/src/utils/auraRebroadcast";
import { ccLandingStateAtMs } from "@gladlog/analysis/src/utils/ccBreakAnalysis";
import { ccFullDurationForApplication } from "@gladlog/analysis/src/utils/ccDuration";

import {
  APPLIED,
  ev,
  type IRoundCtx,
  nameOf,
  REMOVED,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["rootFreedReadUncleansed"] as const;

const ROW =
  /^\s*- id=\S+ type=missed-cleanse t=\S+ units=\S+ facts=\{t=([\d.]+), target=([^,]+), cc=([^,]+), duration=([\d.]+)(.*)\}\s*$/;
const TOL_MS = ALLY_DISPEL_MATCH_TOLERANCE_S * 1000;

export function run(ctx: IRoundCtx): void {
  const C = "rootFreedReadUncleansed";
  for (const l of ctx.menu.split("\n")) {
    const m = ROW.exec(l);
    if (!m || /latencyS=/.test(m[5]!)) continue;
    const t = Number(m[1]);
    const target = ctx.byName.get(m[2]!) ?? ctx.unitOfPid(m[2]);
    const cc = m[3]!;
    if (!target) continue;
    // the row's own application (t is its APPLIED, floored to tenths) and
    // the removal that closed it, inside the round (codex 85-tk-L-T118-1
    // #2: a removal after the round's end is the round ending)
    // one re-broadcast is one application, as the product reads them
    // (`dropAuraRebroadcasts` + `ccRecastSplitsResend` — codex
    // 85-tk-L-T118-1c #2)
    const auras = target.auraEvents ?? [];
    const rows = (
      dropAuraRebroadcasts(
        auras,
        ccRecastSplitsResend(target.id, auras, (id) =>
          ctx.units.find((u) => u.id === id),
        ),
      ) as any[]
    )
      .filter(
        (a) =>
          ROOT_SPELL_IDS.has(String(a.spellId)) &&
          nameOf(String(a.spellId), a.spellName ?? "") === cc,
      )
      .sort((a, b) => tsOf(a) - tsOf(b));
    const apply = rows.find(
      (a) =>
        ev(a) === APPLIED &&
        Math.abs(tsOf(a) - (ctx.start + t * 1000)) <= 100 + TOL_MS,
    );
    if (!apply) continue;
    // the removal that closes THIS application: the first later row of
    // the spell; a re-APPLIED from the same source before any removal means
    // the product inferred this window's end — no removal to judge (codex
    // 85-tk-L-T118-1d; the product credits a freedom cast only at a logged
    // removal)
    const next = rows.find(
      (a) =>
        String(a.spellId) === String(apply.spellId) &&
        tsOf(a) > tsOf(apply) &&
        (ev(a) === REMOVED ||
          (ev(a) === APPLIED && a.srcUnitId === apply.srcUnitId)),
    );
    const removal = next && ev(next) === REMOVED ? next : undefined;
    const removals =
      removal && tsOf(removal) <= ctx.roundEndAt ? [removal] : [];
    // a root that ran out — its own length (caster and landing modifiers:
    // `ccFullDurationForApplication`), or the DR tier of it — was not freed
    // (codex 85-tk-L-T118-1 #1, -1b #2): the product's `rootRanOutAtDrTier`
    if (removals.length) {
      const id = String(apply.spellId);
      const lengthS = ccFullDurationForApplication(
        id,
        ctx.units.find((u) => u.id === apply.srcUnitId),
        ccLandingStateAtMs(target, id, tsOf(apply)),
      );
      if (
        lengthS === undefined ||
        rootRanOutAtDrTier(tsOf(removals[0]) - tsOf(apply), lengthS)
      )
        removals.length = 0;
    }
    ctx.bump(C);
    const team = target.info?.teamId;
    const freer = ctx.players.filter((p) => p.info?.teamId === team);
    for (const r of removals) {
      const hit = freer
        .flatMap((p) => successesOf(p))
        .find(
          (c: any) =>
            TARGET_BOUND_MOBILITY_IDS.has(String(c.spellId)) &&
            c.destUnitId === target.id &&
            Math.abs(tsOf(c) - tsOf(r)) <= TOL_MS,
        );
      if (!hit) continue;
      ctx.violate(
        C,
        nameOf(String(hit.spellId)),
        tsOf(r),
        `${target.id}#${r.spellId}#${tsOf(r)}`,
        `${cc} on the target removed as ${nameOf(String(hit.spellId))} was cast on it; the row reads it as never cleansed`,
        l.trim(),
      );
      break;
    }
  }
}
