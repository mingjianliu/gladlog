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
 *    (`ROOT_SPELL_IDS`). Violation: the log's REMOVED of that root on the
 *    target, between the row's `t` and `t + duration` (+1 s for the printed
 *    tenths), lands within `ALLY_DISPEL_MATCH_TOLERANCE_S` of a
 *    SPELL_CAST_SUCCESS of a freedom id on the target by a player of the
 *    target's team (the target included). Counted: every such root row.
 */
import { ROOT_SPELL_IDS } from "@gladlog/analysis/src/data/rootSpells";
import { TARGET_BOUND_MOBILITY_IDS } from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import { ALLY_DISPEL_MATCH_TOLERANCE_S } from "@gladlog/analysis/src/utils/dispelAnalysis";

import { ev, type IRoundCtx, nameOf, REMOVED, successesOf, tsOf } from "./ctx";

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
    const dur = Number(m[4]);
    if (!target) continue;
    const from = ctx.start + t * 1000 - 1000;
    const to = ctx.start + (t + dur) * 1000 + 1000;
    const removals = ((target.auraEvents ?? []) as any[]).filter(
      (a) =>
        ev(a) === REMOVED &&
        ROOT_SPELL_IDS.has(String(a.spellId)) &&
        nameOf(String(a.spellId), a.spellName ?? "") === cc &&
        tsOf(a) >= from &&
        tsOf(a) <= to,
    );
    if (
      !((target.auraEvents ?? []) as any[]).some(
        (a) =>
          ROOT_SPELL_IDS.has(String(a.spellId)) &&
          nameOf(String(a.spellId), a.spellName ?? "") === cc,
      )
    )
      continue;
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
