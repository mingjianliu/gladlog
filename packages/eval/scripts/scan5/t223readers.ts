/* eslint-disable @typescript-eslint/no-explicit-any -- scan over raw parse output */
/**
 * scan5/t223readers.ts — pipeline T223, count first, the other readers: four
 * more places sum a unit's raw `damageIn` rows where the shared incoming-
 * damage reading (`incomingPressureEvents`, utils/incomingPressure.ts)
 * leaves a teammate's redistribution out (`REDISTRIBUTION_DAMAGE_IDS`). Each
 * check re-evaluates the reader's own decision on the shared reading's
 * LANDED rows (each of the four sums landed damage only) and counts where
 * the decision differs. Removing rows only lowers a sum, so every difference
 * is a decision the product makes today and would not make.
 *
 *  - `underFireRedistribution` — `unitUnderFireAt` (threatAssessment.ts):
 *    per friendly player and whole second, the ±`THREAT_DAMAGE_WINDOW_MS`
 *    sum against `getPressureThreshold`. Kinds: `unit-second flips` (out of
 *    the total: the unit predicate, read alone only by the `cheaper
 *    available:` note at a group save's press) and `team-second flips`
 *    (`threatActiveAt` itself: no enemy offensive is up and no friendly is
 *    under fire on the shared reading).
 *  - `healingGapRedistribution` — `detectHealingGaps` (healer owners): the
 *    gap's pressure check and its most-damaged teammate. Kinds: `gap not
 *    pressured`, `most damaged unit differs`, `amount differs` (out of the
 *    total). The gap threshold is private to healingGaps.ts; this file
 *    restates it (10 % of the largest logged max HP) and skips a teammate
 *    with no max HP logged.
 *  - `burstSegmentRedistribution` — `boundBurstWindow`'s per-second damage
 *    floor (burstWindowDecisionPoints.ts `damagePctPerSecond`). Kinds:
 *    `qualified segment differs` (a segment of the product's own
 *    `boundedBurstSegments` that is no piece of the shared reading's),
 *    `unqualified segment differs` (out of the total: a piece the raw rows
 *    bound that is no segment of the product's — dropped by the builder's
 *    qualification, or, once the product reads the shared rows, never made).
 *  - `crisisDmgRedistribution` — a crisis point's `dmg2s` and its
 *    `dangerous` gate (crisisDecisionPoints.ts). The window's exact end is
 *    the HP sample's own millisecond, which the point does not carry, so
 *    this is a BOUND: every redistribution row of the unit inside
 *    `(tMs − DMG_WINDOW_MS − 1000, tMs + 999]` is taken off. Kinds: `holds a
 *    redistribution row` (out of the total), `dangerous may flip`.
 */
import {
  boundBurstWindow,
  boundedBurstSegments,
  markRoundEndingDeathSecond,
} from "@gladlog/analysis/src/analysis/burstWindowDecisionPoints";
import {
  CRISIS_MIN_DMG2S,
  crisisDecisionPoints,
  DMG_WINDOW_MS,
} from "@gladlog/analysis/src/analysis/crisisDecisionPoints";
import {
  enemyBurstFilterOf,
  getPressureThreshold,
  hasOffensiveSpellActive,
  isHealerSpec,
} from "@gladlog/analysis/src/utils/cooldowns";
import { reconstructEnemyCDTimeline } from "@gladlog/analysis/src/utils/enemyCDs";
import { detectHealingGaps } from "@gladlog/analysis/src/utils/healingGaps";
import {
  incomingPressureEvents,
  isRedistributionRow,
} from "@gladlog/analysis/src/utils/incomingPressure";
import { buildRosterSides } from "@gladlog/analysis/src/utils/rosterSide";
import {
  playableEndMs,
  roundDamageEndMs,
} from "@gladlog/analysis/src/utils/roundEnd";
import {
  THREAT_DAMAGE_WINDOW_MS,
  unitUnderFireAt,
} from "@gladlog/analysis/src/utils/threatAssessment";

import { fmtS, type IRoundCtx } from "./ctx";

export const CHECKS = [
  "underFireRedistribution",
  "healingGapRedistribution",
  "burstSegmentRedistribution",
  "crisisDmgRedistribution",
] as const;
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "underFireRedistribution|unit-second flips",
  "healingGapRedistribution|amount differs",
  "burstSegmentRedistribution|unqualified segment differs",
  "crisisDmgRedistribution|holds a redistribution row",
  // T223 leaves the crisis `dmg2s` as it is: the crisis reference tables
  // were generated with the moved health inside it, and the two change
  // together (pipeline T227, GH #115). Counted, not a violation here.
  "crisisDmgRedistribution|dangerous may flip",
]);

type Series = { t: number[]; pre: number[] };
function seriesOf(rows: Array<{ t: number; a: number }>): Series {
  const sorted = [...rows].sort((x, y) => x.t - y.t);
  const t: number[] = [];
  const pre: number[] = [0];
  for (const r of sorted) {
    t.push(r.t);
    pre.push(pre[pre.length - 1]! + r.a);
  }
  return { t, pre };
}
/** first index with t[i] >= x */
function lower(t: number[], x: number): number {
  let lo = 0,
    hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
/** sum over fromMs <= t <= toMs */
function sumIn(s: Series, fromMs: number, toMs: number): number {
  return s.pre[lower(s.t, toMs + 1)]! - s.pre[lower(s.t, fromMs)]!;
}
function maxHpOf(u: any): number {
  let m = 0;
  for (const a of (u?.advancedActions ?? []) as any[])
    if ((a.advancedActorMaxHp ?? 0) > m) m = a.advancedActorMaxHp;
  return m;
}

export function run(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  const friends = (ctx.players as any[]).filter(
    (p) => p.reaction === owner.reaction,
  );
  const enemies = (ctx.players as any[]).filter(
    (p) => p.reaction !== owner.reaction,
  );
  const units = ctx.units as any[];
  const sides = buildRosterSides(units);
  const combat = { ...ctx.legacy, startTime: ctx.start, endTime: ctx.end };
  // the round's end the burst readers stop at (`roundDamageEndMs`, T237)
  const dmgEnd = roundDamageEndMs({
    ...(ctx.legacy as any),
    endTime: ctx.end,
  });
  // the under-fire loop walks every second of the slice, as its producer
  // (`unitUnderFireAt`) reads them; only the burst maps stop at `dmgEnd`
  const sliceEndS = (ctx.end - ctx.start) / 1000;
  if (!(sliceEndS > 0)) return;

  const raw = new Map<string, Series>();
  const shared = new Map<string, Series>();
  const moved = new Map<string, Series>();
  for (const u of friends) {
    const rows = ((u.damageIn ?? []) as any[]).map((d) => ({
      t: d.logLine.timestamp as number,
      a: Math.abs(d.effectiveAmount ?? 0),
      r: isRedistributionRow(
        u,
        d.spellId,
        d.srcUnitId,
        d.srcUnitFlags,
        d.destUnitFlags,
        sides,
      ),
    }));
    raw.set(u.id, seriesOf(rows));
    moved.set(u.id, seriesOf(rows.filter((r) => r.r)));
    shared.set(
      u.id,
      seriesOf(
        incomingPressureEvents(u, sides)
          .filter((e) => !e.isAbsorb)
          .map((e) => ({ t: e.timestamp, a: e.amount })),
      ),
    );
  }
  const anyMoved = friends.some((u) => moved.get(u.id)!.t.length > 0);

  // ── unitUnderFireAt / threatActiveAt
  {
    const round = { startTime: ctx.start, endTime: ctx.end };
    const thr = new Map<string, number>(
      friends.map((u) => [u.id, getPressureThreshold(u)]),
    );
    for (let s = 0; s <= Math.floor(sliceEndS); s++) {
      const tMs = ctx.start + s * 1000;
      let anyRaw = false;
      let anyProduct = false;
      let anyShared = false;
      for (const u of friends) {
        const from = tMs - THREAT_DAMAGE_WINDOW_MS;
        const to = tMs + THREAT_DAMAGE_WINDOW_MS;
        const a = sumIn(raw.get(u.id)!, from, to) >= thr.get(u.id)!;
        if (!a) continue;
        anyRaw = true;
        // the product's own answer for this unit-second, not this file's
        // restatement of it (the raw sum only finds the seconds worth asking
        // about): the check has to move when the product does
        if (!unitUnderFireAt(u as never, tMs, undefined, sides)) continue;
        anyProduct = true;
        if (!anyMoved) {
          anyShared = true;
          continue;
        }
        const b = sumIn(shared.get(u.id)!, from, to) >= thr.get(u.id)!;
        if (b) anyShared = true;
        else
          ctx.violate(
            "underFireRedistribution",
            "unit-second flips",
            tMs,
            `${u.name}#${s}`,
            `${u.name} under fire at ${fmtS(s)} on ${(sumIn(raw.get(u.id)!, from, to) / 1000).toFixed(0)}k (threshold ${(thr.get(u.id)! / 1000).toFixed(0)}k), ${(sumIn(shared.get(u.id)!, from, to) / 1000).toFixed(0)}k on the shared reading`,
          );
      }
      if (!anyRaw) continue;
      ctx.bump("underFireRedistribution");
      if (anyShared || !anyProduct) continue;
      const offensive = enemies.some((e) =>
        hasOffensiveSpellActive(
          e as never,
          tMs,
          null,
          enemyBurstFilterOf(e as never),
          round,
        ),
      );
      if (!offensive)
        ctx.violate(
          "underFireRedistribution",
          "team-second flips",
          tMs,
          `team#${s}`,
          `threat active at ${fmtS(s)} on damage alone; no friendly under fire on the shared reading`,
        );
    }
  }

  // ── detectHealingGaps (healer owners, the candidate's own call)
  if (isHealerSpec(owner.spec)) {
    let gaps: any[] = [];
    try {
      gaps = detectHealingGaps(
        owner as never,
        friends as never,
        enemies as never,
        combat as never,
        { playableEndMs: playableEndMs(combat as never, units as never) },
      );
    } catch {
      gaps = [];
    }
    const mates = friends.filter((u) => u.id !== owner.id);
    for (const g of gaps) {
      ctx.bump("healingGapRedistribution");
      const from = ctx.start + g.fromSeconds * 1000;
      const to = ctx.start + g.toSeconds * 1000;
      let pressured = false;
      let unknown = false;
      let top = "";
      let topAmount = 0;
      for (const m of mates) {
        const dmg = sumIn(shared.get(m.id)!, from, to);
        const max = maxHpOf(m);
        if (!(max > 0)) unknown = true;
        else if (dmg >= max * 0.1) pressured = true;
        if (dmg > topAmount) {
          topAmount = dmg;
          top = m.name;
        }
      }
      const id = `${owner.name}#${Math.round(g.fromSeconds * 1000)}`;
      const head = `gap ${fmtS(g.fromSeconds)}–${fmtS(g.toSeconds)}: most damaged ${g.mostDamagedName} ${(g.mostDamagedAmount / 1000).toFixed(0)}k`;
      if (!pressured && !unknown)
        ctx.violate(
          "healingGapRedistribution",
          "gap not pressured",
          from,
          id,
          `${head}; on the shared reading no teammate reaches its threshold (top ${top || "none"} ${(topAmount / 1000).toFixed(0)}k)`,
        );
      else if (top !== g.mostDamagedName)
        ctx.violate(
          "healingGapRedistribution",
          "most damaged unit differs",
          from,
          id,
          `${head}; on the shared reading ${top} ${(topAmount / 1000).toFixed(0)}k`,
        );
      else if (Math.round(topAmount) !== Math.round(g.mostDamagedAmount))
        ctx.violate(
          "healingGapRedistribution",
          "amount differs",
          from,
          id,
          `${head}; on the shared reading ${(topAmount / 1000).toFixed(0)}k`,
        );
    }
  }

  // ── boundBurstWindow's per-second floor
  {
    const perSecond = (src: Map<string, Series>): Map<number, number> => {
      const out = new Map<number, number>();
      for (const f of friends) {
        const max = maxHpOf(f);
        if (max <= 0) continue;
        const s = src.get(f.id)!;
        for (let i = 0; i < s.t.length; i++) {
          // no row after the round's end, raw or shared: the product's
          // per-second floor reads `isRoundLandedDamageRow` against
          // `roundDamageEndMs` (pipeline T234, T237; B175 stack check, 0 -> 210
          // qualified segments while this map still read the rows the
          // unit arrays keep after the deciding death)
          if (s.t[i]! > dmgEnd) continue;
          const sec = Math.floor((s.t[i]! - ctx.start) / 1000);
          out.set(sec, (out.get(sec) ?? 0) + (s.pre[i + 1]! - s.pre[i]!) / max);
        }
      }
      // …and the round-ending death's own second, as the product marks it
      markRoundEndingDeathSecond(out, friends, ctx.start, dmgEnd);
      return out;
    };
    const { facts, segments } = boundedBurstSegments(combat, {
      friendlyReaction: owner.reaction,
    });
    if (facts.size > 0 || segments.length > 0) {
      const timeline = reconstructEnemyCDTimeline(
        enemies as never,
        combat as never,
      );
      const rawMap = perSecond(raw);
      const sharedMap = perSecond(shared);
      const key = (s: { fromSeconds: number; toSeconds: number }) =>
        `${s.fromSeconds}–${s.toSeconds}`;
      // The product's own segments against the pieces the shared reading
      // bounds — asked of the product, not of this file's restatement of it
      // (the raw map only measures what the builder's qualification drops):
      // the check has to move when the product does.
      const sharedKeys = new Set<string>();
      const sharedPieces: string[] = [];
      const rawOnly: Array<{ fromSeconds: number; toSeconds: number }> = [];
      for (const w of timeline.alignedBurstWindows) {
        const b = boundBurstWindow(w, facts, sharedMap);
        for (const x of b) {
          sharedKeys.add(key(x));
          sharedPieces.push(
            `${x.fromSeconds.toFixed(1)}–${x.toSeconds.toFixed(1)}s`,
          );
        }
        if (anyMoved)
          for (const x of boundBurstWindow(w, facts, rawMap))
            if (!b.some((y) => key(y) === key(x))) rawOnly.push(x);
      }
      ctx.bump("burstSegmentRedistribution", segments.length);
      const productKeys = new Set(segments.map(key));
      for (const seg of segments) {
        if (sharedKeys.has(key(seg))) continue;
        ctx.violate(
          "burstSegmentRedistribution",
          "qualified segment differs",
          ctx.start + seg.fromSeconds * 1000,
          `${owner.reaction}#${Math.round(seg.fromSeconds * 1000)}`,
          `segment ${seg.fromSeconds.toFixed(1)}–${seg.toSeconds.toFixed(1)}s; on the shared reading ${sharedPieces.join(", ") || "none"}`,
        );
      }
      for (const seg of rawOnly) {
        if (productKeys.has(key(seg))) continue;
        ctx.violate(
          "burstSegmentRedistribution",
          "unqualified segment differs",
          ctx.start + seg.fromSeconds * 1000,
          `${owner.reaction}#raw#${Math.round(seg.fromSeconds * 1000)}`,
          `raw-row piece ${seg.fromSeconds.toFixed(1)}–${seg.toSeconds.toFixed(1)}s is no segment of the product's`,
        );
      }
    }
  }

  // ── crisis points' dmg2s (every friendly player; a bound, see the header)
  for (const u of friends) {
    let points: any[] = [];
    try {
      points = crisisDecisionPoints(u, combat);
    } catch {
      points = [];
    }
    const max = maxHpOf(u);
    for (const p of points) {
      ctx.bump("crisisDmgRedistribution");
      if (!(max > 0)) continue;
      const r = sumIn(
        moved.get(u.id)!,
        p.tMs - DMG_WINDOW_MS - 1000 + 1,
        p.tMs + 999,
      );
      if (!(r > 0)) continue;
      const id = `${u.name}#${p.tSec}`;
      const detail = `${u.name} crisis at ${fmtS(p.tSec)}: dmg2s ${(p.dmg2s * 100).toFixed(0)} %${p.dangerous ? " [dangerous]" : ""}; up to ${(r / 1000).toFixed(0)}k (${((r / max) * 100).toFixed(0)} % of max HP) of it is redistribution`;
      ctx.violate(
        "crisisDmgRedistribution",
        "holds a redistribution row",
        p.tMs,
        `${id}#holds`,
        detail,
      );
      if (
        p.dangerous &&
        Math.round((p.dmg2s - r / max) * 100) / 100 < CRISIS_MIN_DMG2S
      )
        ctx.violate(
          "crisisDmgRedistribution",
          "dangerous may flip",
          p.tMs,
          id,
          detail,
        );
    }
  }
}
