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
import {
  dropAuraRebroadcasts,
  supersededAuraBreaks,
} from "@gladlog/analysis/src/utils/auraRebroadcast";
import { ccLandingStateAtMs } from "@gladlog/analysis/src/utils/ccBreakAnalysis";
import { ccFullDurationForApplication } from "@gladlog/analysis/src/utils/ccDuration";
import { TARGET_BOUND_MOBILITY_IDS } from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import {
  ALLY_DISPEL_MATCH_TOLERANCE_S,
  rootRanOutAtDrTier,
} from "@gladlog/analysis/src/utils/dispelAnalysis";
import {
  ccRecastBetween,
  ccRecastSplitsResend,
  matchPendingCcKey,
  reAppliedIsSameApplication,
} from "@gladlog/analysis/src/utils/drAnalysis";
import { LogEvent } from "@gladlog/parser-compat";

import {
  APPLIED,
  ev,
  type IRoundCtx,
  nameOf,
  REMOVED,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = [
  "rootFreedReadUncleansed",
  "rootBrokenAtFreedomCast",
] as const;

const BROKEN = LogEvent.SPELL_AURA_BROKEN as string;
const BROKEN_SPELL = LogEvent.SPELL_AURA_BROKEN_SPELL as string;

const ROW =
  /^\s*- id=\S+ type=missed-cleanse t=\S+ units=\S+ facts=\{t=([\d.]+), target=([^,]+), cc=([^,]+), duration=([\d.]+)(.*)\}\s*$/;
const TOL_MS = ALLY_DISPEL_MATCH_TOLERANCE_S * 1000;

/** Batch review 80-PIPE-91-B80b #1, a count: a root's bare BROKEN row (no
 * REMOVED of its own follows) in the instant of a freedom cast on its
 * holder by a player of the holder's team. The producer credits a freedom
 * cast only at a logged REMOVED, so each one is a window whose reading
 * differs between the two. Counted: every bare BROKEN row of a root on a
 * player, once per round (the first owner's pass). */
function brokenAtFreedomCast(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  const C = "rootBrokenAtFreedomCast";
  for (const u of ctx.players) {
    const auras = (u.auraEvents ?? []) as any[];
    const notTheEnd = supersededAuraBreaks(auras);
    const team = ctx.players.filter((p) => p.info?.teamId === u.info?.teamId);
    for (const r of auras) {
      const e = ev(r);
      if (e !== BROKEN && e !== BROKEN_SPELL) continue;
      if (!ROOT_SPELL_IDS.has(String(r.spellId)) || notTheEnd.has(r)) continue;
      if (tsOf(r) < ctx.start || tsOf(r) > ctx.roundEndAt) continue;
      ctx.bump(C);
      const hit = team
        .flatMap((p) => successesOf(p))
        .find(
          (c: any) =>
            TARGET_BOUND_MOBILITY_IDS.has(String(c.spellId)) &&
            c.destUnitId === u.id &&
            Math.abs(tsOf(c) - tsOf(r)) <= TOL_MS,
        );
      if (!hit) continue;
      ctx.violate(
        C,
        nameOf(String(hit.spellId)),
        tsOf(r),
        `${u.id}#${r.spellId}#${tsOf(r)}`,
        `${nameOf(String(r.spellId), r.spellName ?? "")} on ${u.id} ends on a bare BROKEN row as ${nameOf(String(hit.spellId))} was cast on it`,
      );
    }
  }
}

export function run(ctx: IRoundCtx): void {
  brokenAtFreedomCast(ctx);
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
    // the removal that closes THIS application, paired as the product
    // pairs (`matchPendingCcKey`, consuming): a REMOVED closes its source's
    // open application, else the earliest open one; a re-APPLIED from the
    // same source while it is open leaves the product an inferred end — no
    // removal to judge (codex 85-tk-L-T118-1d / -1e)
    let removal: any;
    {
      const id = String(apply.spellId);
      const lengthOf = (row: any) =>
        ccFullDurationForApplication(
          id,
          ctx.units.find((u) => u.id === row.srcUnitId),
          ccLandingStateAtMs(target, id, tsOf(row)),
        ) ?? null;
      // a BROKEN row its aura's own REMOVED follows is not the end
      const notTheEnd = supersededAuraBreaks(auras);
      const pending = new Map<string, { applyMs: number; row: any }>();
      for (const r of rows) {
        if (String(r.spellId) !== id) continue;
        const key = `${id}:${r.srcUnitId}`;
        if (ev(r) === APPLIED) {
          const open = pending.get(key);
          if (open) {
            // a re-send inside the open application's length with no recast
            // is that application (`reAppliedIsSameApplication` — batch
            // review 80-PIPE-91-B80b #2); else the open one's end is
            // inferred: no removal to judge
            const src = ctx.players.find((u) => u.id === r.srcUnitId);
            if (
              reAppliedIsSameApplication(
                open.applyMs,
                tsOf(r),
                lengthOf(open.row),
                src !== undefined &&
                  ccRecastBetween([src], id, target.id, open.applyMs, tsOf(r)),
              )
            )
              continue;
            if (open.row === apply) break;
          }
          pending.set(key, { applyMs: tsOf(r), row: r });
          continue;
        }
        const e = ev(r);
        if (e !== REMOVED && e !== BROKEN && e !== BROKEN_SPELL) continue;
        if (notTheEnd.has(r)) continue;
        const k = matchPendingCcKey(pending, id, key);
        if (k === undefined) continue;
        const closed = pending.get(k)!.row;
        pending.delete(k);
        if (closed === apply) {
          // only a logged REMOVED is a removal a freedom cast is credited
          // at (the producer's `removedRow`)
          if (e === REMOVED) removal = r;
          break;
        }
      }
    }
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
