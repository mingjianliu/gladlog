/* eslint-disable @typescript-eslint/no-explicit-any -- scan over raw parse output */
/**
 * scan5/t234.ts — pipeline T234, count first: the bounded burst segments'
 * per-second damage (`damagePctPerSecond`, burstWindowDecisionPoints.ts)
 * reads every friendly `damageIn` row, the ones logged after the round's
 * end (`roundDamageEndMs` since pipeline T237, ruling R111 — `combat.endTime`
 * before it: a Solo Shuffle round ends at its deciding death and the unit
 * arrays keep the seconds after it) among them. T228 stopped the
 * aligned window's total, average and pick at the round's end; this reader
 * was left (review 85-tk-WIN-T228-1).
 *
 * The count asks the product twice, each side of each round once:
 * `boundedBurstSegments` on the round as parsed and on a copy whose units
 * carry no `damageIn` row after `endTime`. Kinds:
 *  - `segment ends after the round's end` and `segment differs without the
 *    rows after the round's end` (no segment of the copy has the same start
 *    and end, whole seconds as rendered) — the total; 0 once the reader
 *    stops at the round's end (`isRoundLandedDamageRow`);
 *  - out of the total: `segment` (every qualified segment), `segment only
 *    without those rows`, `roundEndMs() is not combat.endTime` (each round
 *    once: the product's other round end against this reader's bound).
 */
import {
  boundedBurstSegments,
  burstWindowDecisionPoints,
} from "@gladlog/analysis/src/analysis/burstWindowDecisionPoints";
import {
  BURST_WINDOW_MIN_JUDGED_S,
  burstWindowLongEnoughToJudge,
} from "@gladlog/analysis/src/analysis/candidates/burstWindowResponse";
import {
  roundDamageEndMs,
  roundEndMs,
} from "@gladlog/analysis/src/utils/roundEnd";

import { fmtS, type IRoundCtx } from "./ctx";

const C = "burstSegmentPastRoundEnd";
/** inventory: the unanswered-burst points whose judged length moves with
 * the round end the damage is read to (all out of the total) */
const P = "burstPointRoundEnd";
export const CHECKS = [C, P] as const;
const PK = {
  point: "eligible point",
  endTime: "eligible, not without rows after endTime",
  roundEnd: "eligible, not without rows after roundEndMs()",
  gained: "eligible only without rows after endTime",
  byDeath: "eligible by the pressured unit's death, window under 8 s",
  byDeathAtDeath: "…the same without rows after roundEndMs()",
  died: "point whose pressured unit died inside it",
} as const;
const K = {
  seg: "segment",
  late: "segment ends after the round's end",
  differs: "segment differs without the rows after the round's end",
  only: "segment only without those rows",
  endDiffers: "roundEndMs() is not combat.endTime",
} as const;
/** the pass condition: no segment ends after the round's end and none
 * moves when the rows after it are taken off; `segment` is the inventory */
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  `${C}|${K.seg}`,
  `${C}|${K.only}`,
  `${C}|${K.endDiffers}`,
  ...Object.values(PK).map((k) => `${P}|${k}`),
]);

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  const legacy = ctx.legacy as any;
  if (!(legacy.endTime > 0)) return;
  // the round's end the reader stops at: `roundDamageEndMs` since pipeline
  // T237 (ruling R111) — `combat.endTime` before it
  const endMs: number = roundDamageEndMs(legacy);
  const units = Object.values(legacy.units) as any[];
  const late = (u: any) =>
    ((u.damageIn ?? []) as any[]).some(
      (d) => (d.timestamp ?? d.logLine?.timestamp) > endMs,
    );
  const cut = {
    ...legacy,
    units: Object.fromEntries(
      units.map((u) => [
        u.id,
        late(u)
          ? {
              ...u,
              damageIn: (u.damageIn as any[]).filter(
                (d) => !((d.timestamp ?? d.logLine?.timestamp) > endMs),
              ),
            }
          : u,
      ]),
    ),
  };
  const anyLate = units.some(late);
  // the point inventory's two named cuts are the raw log end and
  // `roundEndMs()`, whatever the reader's own bound is
  pointInventory(ctx, legacy, units, legacy.endTime);
  // the product's two round ends (`roundEndMs`: the ending death / the
  // combat's end; `combat.endTime`: the log's) — an inventory
  if (roundEndMs(legacy) !== legacy.endTime)
    ctx.violate(
      C,
      K.endDiffers,
      legacy.endTime,
      "roundEnd",
      `roundEndMs ${((roundEndMs(legacy) - ctx.start) / 1000).toFixed(1)} s, endTime ${((legacy.endTime - ctx.start) / 1000).toFixed(1)} s`,
    );
  const key = (s: { fromSeconds: number; toSeconds: number }) =>
    `${Math.floor(s.fromSeconds)}-${Math.floor(s.toSeconds)}`;
  const endS = (endMs - ctx.start) / 1000;
  for (const side of new Set(
    (ctx.players as any[]).map((p) => p.reaction as number),
  )) {
    let real: any[] = [];
    let alt: any[] = [];
    try {
      real = boundedBurstSegments(legacy, { friendlyReaction: side }).segments;
      alt = anyLate
        ? boundedBurstSegments(cut, { friendlyReaction: side }).segments
        : real;
    } catch {
      continue;
    }
    const altKeys = new Set(alt.map(key));
    const realKeys = new Set(real.map(key));
    for (const s of real) {
      ctx.bump(C);
      const at = ctx.start + s.fromSeconds * 1000;
      const id = `${side}#${key(s)}`;
      const detail = `side ${side} ${fmtS(s.fromSeconds)}–${fmtS(s.toSeconds)} (${s.fromSeconds.toFixed(1)}–${s.toSeconds.toFixed(1)} s), round ends ${endS.toFixed(1)} s`;
      ctx.violate(C, K.seg, at, `${id}#seg`, detail);
      // on the rendering grid: a segment whose end falls in the round's own
      // last second does not print past it
      if (Math.floor(s.toSeconds) > Math.floor(endS))
        ctx.violate(C, K.late, at, `${id}#late`, detail);
      if (!altKeys.has(key(s)))
        ctx.violate(
          C,
          K.differs,
          at,
          `${id}#differs`,
          `${detail}; without: ${alt.map((a) => `${fmtS(a.fromSeconds)}–${fmtS(a.toSeconds)}`).join(", ") || "none"}`,
        );
    }
    for (const a of alt)
      if (!realKeys.has(key(a)))
        ctx.violate(
          C,
          K.only,
          ctx.start + a.fromSeconds * 1000,
          `${side}#${key(a)}#only`,
          `side ${side} ${fmtS(a.fromSeconds)}–${fmtS(a.toSeconds)}`,
        );
  }
}

/** slow-defensive-response's own eligibility, before the reference door and
 * the two slots (`burstWindowResponseEvents`) */
const eligible = (p: any): boolean =>
  p.feasible &&
  p.triaged &&
  !p.responded &&
  p.pressured !== null &&
  burstWindowLongEnoughToJudge(p);

function pointInventory(
  ctx: IRoundCtx,
  legacy: any,
  units: any[],
  endMs: number,
): void {
  const without = (boundMs: number) => ({
    ...legacy,
    units: Object.fromEntries(
      units.map((u) => [
        u.id,
        Array.isArray(u.damageIn)
          ? {
              ...u,
              damageIn: (u.damageIn as any[]).filter(
                (d) => !((d.timestamp ?? d.logLine?.timestamp) > boundMs),
              ),
            }
          : u,
      ]),
    ),
  });
  const pk = (p: any) => `${p.tSec}:${p.leadCd.spellId}`;
  for (const side of new Set(
    (ctx.players as any[]).map((p) => p.reaction as number),
  )) {
    let real: any[];
    let atEnd: any[];
    let atDeath: any[];
    try {
      const o = { friendlyReaction: side };
      real = burstWindowDecisionPoints(legacy, o);
      atEnd = burstWindowDecisionPoints(without(endMs), o);
      atDeath = burstWindowDecisionPoints(without(roundEndMs(legacy)), o);
    } catch {
      continue;
    }
    const say = (p: any, q: any | undefined) =>
      `side ${side} t=${p.tSec} ${p.leadCd.spellName} ${fmtS(p.tSec)}–${fmtS(p.endSec)} (${p.durationSec}s) pressured ${p.pressured?.name} min ${p.pressured?.minHpPct}% died=${p.pressured?.died ? "yes" : "no"} anyDeath=${p.anyFriendlyDeath ? "yes" : "no"}; then: ${q ? `${q.durationSec}s responded=${q.responded} feasible=${q.feasible} triaged=${q.triaged}` : "no point"}`;
    // user ruling R103: the points only the death rule makes eligible, as
    // the round is parsed and with the reader stopped at roundEndMs()
    for (const [kind, list] of [
      [PK.byDeath, real],
      [PK.byDeathAtDeath, atDeath],
    ] as const)
      for (const p of list)
        if (eligible(p) && p.durationSec < BURST_WINDOW_MIN_JUDGED_S)
          ctx.violate(
            P,
            kind,
            ctx.start + p.tSec * 1000,
            `${side}#${pk(p)}#${kind}`,
            `${say(p, p)}; death at ${p.pressured?.diedSec} (${p.pressured!.diedSec! - p.tSec}s in), window end ${p.endSec}`,
          );
    // every point that reads its pressured unit dead inside the window
    // (`[BURST ANSWERED] … still died` on an answered one): the set a
    // change of the damage's round end must not move (ruling R111)
    for (const p of real)
      if (p.pressured?.died)
        ctx.violate(
          P,
          PK.died,
          ctx.start + p.tSec * 1000,
          `${side}#${pk(p)}#died`,
          `${say(p, p)}; responded=${p.responded}`,
        );
    for (const p of real.filter(eligible)) {
      ctx.bump(P);
      const at = ctx.start + p.tSec * 1000;
      ctx.violate(P, PK.point, at, `${side}#${pk(p)}#p`, say(p, p));
      for (const [kind, alt] of [
        [PK.endTime, atEnd],
        [PK.roundEnd, atDeath],
      ] as const) {
        const q = alt.find((a) => pk(a) === pk(p));
        if (!q || !eligible(q))
          ctx.violate(P, kind, at, `${side}#${pk(p)}#${kind}`, say(p, q));
      }
    }
    const realEligible = new Set(real.filter(eligible).map(pk));
    for (const q of atEnd.filter(eligible))
      if (!realEligible.has(pk(q)))
        ctx.violate(
          P,
          PK.gained,
          ctx.start + q.tSec * 1000,
          `${side}#${pk(q)}#gained`,
          say(
            q,
            real.find((a) => pk(a) === pk(q)),
          ),
        );
  }
}
