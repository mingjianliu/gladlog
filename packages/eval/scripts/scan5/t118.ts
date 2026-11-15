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
 *    APPLIED, inside the round and short of the root's caster-resolved
 *    length at Full or half (DR), lands within
 *    `ALLY_DISPEL_MATCH_TOLERANCE_S` of a
 *    SPELL_CAST_SUCCESS of a freedom id on the target by a player of the
 *    target's team (the target included). Counted: every such root row.
 */
import { ROOT_SPELL_IDS } from "@gladlog/analysis/src/data/rootSpells";
import { TARGET_BOUND_MOBILITY_IDS } from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import { ALLY_DISPEL_MATCH_TOLERANCE_S } from "@gladlog/analysis/src/utils/dispelAnalysis";

import { ccFullDurationForCaster } from "@gladlog/analysis/src/utils/ccDuration";

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
/** a removal this close to the root's own length (or half of it, the DR
 * tier) is it running out */
const EXPIRY_SLACK_MS = 150;

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
    const rows = ((target.auraEvents ?? []) as any[])
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
    const removal = rows.find(
      (a) =>
        ev(a) === REMOVED &&
        String(a.spellId) === String(apply.spellId) &&
        tsOf(a) > tsOf(apply),
    );
    const removals =
      removal && tsOf(removal) <= ctx.roundEndAt ? [removal] : [];
    // a root that ran out (its caster-resolved length, Full or half at DR
    // level, within EXPIRY_SLACK_MS) was not freed (codex #1)
    if (removals.length) {
      const full = ccFullDurationForCaster(
        String(apply.spellId),
        ctx.units.find((u) => u.id === apply.srcUnitId),
      );
      const ran = tsOf(removals[0]) - tsOf(apply);
      if (
        full === undefined ||
        ran >= full * 1000 - EXPIRY_SLACK_MS ||
        Math.abs(ran - full * 500) <= EXPIRY_SLACK_MS
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
