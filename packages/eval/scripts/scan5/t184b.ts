/* eslint-disable @typescript-eslint/no-explicit-any -- the legacy parse objects are untyped */
/**
 * scan5/t184b.ts — ticket T184, sizing ruling R88's options: one record per
 * engine window (every owner, a pressured friendly) with its summon-made
 * control answers — a control a friendly's totem or guardian landed, the
 * summon row on record — and what the window reads under each option.
 * Imports only what the merge-base exports, so the same file runs against
 * the base engine and the patched one; the two runs are joined offline.
 *
 * THIS SCAN RE-RUNS THE ENGINE: its numbers are the checkout's.
 *
 *  - `summonControlWindowDump` (inventory): detail = JSON
 *    `{r, j, c, cr, s[], b2, b3}` — responded, judged by the candidate,
 *    creditable low, the credited answer, each summon-made control
 *    (spell, printed latency, landing ms after the window second, summon
 *    ms before the landing, summon before the span), and responded /
 *    credited with (b2) the pre-span summons further than the ground fuse
 *    from their landing removed, (b3) the pre-span summons re-timed at
 *    their landing.
 */
import {
  burstResponseSpanMs,
  burstWindowDecisionPoints,
} from "@gladlog/analysis/src/analysis/burstWindowDecisionPoints";
import { burstWindowLongEnoughToJudge } from "@gladlog/analysis/src/analysis/candidates/burstWindowResponse";
import {
  BURST_ANSWERED_MAX_HP_PCT,
  creditedAnswer,
} from "@gladlog/analysis/src/context/burstAnswered";
import { isHealerSpec } from "@gladlog/analysis/src/utils/cooldowns";
import { summonedAtMs } from "@gladlog/analysis/src/utils/summonLife";

import { APPLIED, ev, type IRoundCtx, tsOf } from "./ctx";

export const CHECKS = ["summonControlWindowDump"] as const;
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "summonControlWindowDump|w",
]);

/** `GROUND_CONTROL_FUSE_MS` (not exported at the merge-base) */
const FUSE_MS = 3000;

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
    ctx.bump("summonControlWindowDump");
    // the engine's own span start (the opener's ms, ruling R113)
    const w0 = burstResponseSpanMs(p.tMs, p.leadMs).w0;
    const summons = new Map<
      any,
      { dist: number; pre: boolean; land: number }
    >();
    for (const r of p.responseCasts) {
      const landing = r.controlOn?.auras[0];
      if (r.category !== "control" || !landing) continue;
      const caster = ctx.units.find(
        (u: any) => u.info && u.name === r.casterName,
      );
      const holder = ctx.units.find((u: any) => u.id === r.controlOn!.unitId);
      const row = ((holder?.auraEvents ?? []) as any[]).find(
        (a) =>
          ev(a) === APPLIED &&
          String(a.spellId) === landing.spellId &&
          tsOf(a) === landing.atMs,
      );
      const srcId: string | undefined = row?.srcUnitId;
      if (!caster || !srcId || srcId === caster.id || srcId.startsWith("Pet-"))
        continue;
      const src = ctx.units.find((u: any) => u.id === srcId);
      if (!src || src.info || src.ownerId !== caster.id) continue;
      const at = summonedAtMs(src);
      if (at === null) continue;
      summons.set(r, {
        dist: landing.atMs - at,
        pre: at < w0,
        land: landing.atMs - p.tMs,
      });
    }
    const moved = p.responses.kite || p.responses.attackerMoved;
    const cred = (casts: any[]) => {
      const c = creditedAnswer({ ...p, responseCasts: casts } as any);
      return c ? `${c.casterName}|${c.spellName}|${c.latencySec}` : null;
    };
    const far = (r: any) => {
      const s = summons.get(r);
      return !!s && s.pre && s.dist > FUSE_MS;
    };
    const b2casts = p.responseCasts.filter((r) => !far(r));
    // b3: a pre-span summon is re-timed at its landing (latency from the
    // window second — the lead's sub-second is not on the point)
    const b3casts = p.responseCasts
      .map((r) => {
        const s = summons.get(r);
        return s && s.pre
          ? { ...r, latencySec: Math.round(s.land / 100) / 10 }
          : r;
      })
      .sort((a, b) => a.latencySec - b.latencySec);
    const low = pr.minHpPct;
    ctx.violate(
      "summonControlWindowDump",
      "w",
      p.tMs,
      `${ctx.roundKey}|${owner.reaction}|${p.tSec}`,
      JSON.stringify({
        r: p.responded,
        r0: p.responseCasts.length > 0 || moved,
        j: healer && p.feasible && p.triaged && burstWindowLongEnoughToJudge(p),
        c: p.feasible && low !== null && low <= BURST_ANSWERED_MAX_HP_PCT,
        cr: cred(p.responseCasts),
        n: p.responseCasts.length,
        s: [...summons.entries()].map(([r, s]) => ({
          sp: r.spellName,
          by: r.casterName,
          lat: r.latencySec,
          land: s.land,
          dist: s.dist,
          pre: s.pre,
        })),
        b2: { r: b2casts.length > 0 || moved, cr: cred(b2casts) },
        b3: { cr: cred(b3casts) },
      }),
    );
  }
}
