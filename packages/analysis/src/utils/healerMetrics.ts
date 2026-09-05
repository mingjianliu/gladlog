import {
  CombatUnitType,
  IArenaMatch,
  IShuffleRound,
  LogEvent,
} from "@gladlog/parser-compat";

import { SPELL_CATEGORIES } from "../data/spellCategories";
import { ccSpellIds } from "../data/spellTags";
import { analyzePlayerCCAndTrinket } from "./ccTrinketAnalysis";
import {
  annotateDefensiveTimings,
  detectOverlappedDefensives,
  extractMajorCooldowns,
  IMajorCooldownInfo,
  MAJOR_DEFENSIVE_IDS,
} from "./cooldowns";
import {
  buildCastMatchIndex,
  classifyDispel,
  isDeliberateDispel,
} from "./dispelKind";
import { reconstructEnemyCDTimeline } from "./enemyCDs";
import { detectHealingGaps } from "./healingGaps";
import { medianFinite } from "./stats";

// The median goes through the shared predicate -- do not sort locally here;
// see the NaN sort-pollution note in stats.ts.
const median = medianFinite;

export function computeCDResponseLatency(
  annotatedCooldowns: IMajorCooldownInfo[],
  burstWindows: Array<{ fromSeconds: number; toSeconds: number }>,
  matchStartMs: number,
): { latencyMsMedian: number | null; answered: number; windows: number } {
  const answeredLatencies: Array<number | null> = burstWindows.map((w) => {
    const windowStartMs = w.fromSeconds * 1000 + matchStartMs;
    const windowEndMs = w.toSeconds * 1000 + matchStartMs;
    let best: number | null = null;
    for (const cd of annotatedCooldowns) {
      for (const cast of cd.casts) {
        if (cast.timingLabel !== "Optimal" && cast.timingLabel !== "Reactive")
          continue;
        const castMs = cast.timeSeconds * 1000 + matchStartMs;
        if (castMs >= windowStartMs && castMs <= windowEndMs + 8000) {
          const latency = castMs - windowStartMs;
          if (latency >= 0 && (best === null || latency < best)) best = latency;
        }
      }
    }
    return best;
  });
  const hit = answeredLatencies.filter((x): x is number => x !== null);
  return {
    latencyMsMedian: hit.length ? median(hit) : null,
    answered: hit.length,
    windows: burstWindows.length,
  };
}

export interface IHealerMetrics {
  offensiveIndex: number;
  ccDensity: number;
  reactionLatency: number | null;
  burstResponseCoverage: { answered: number; windows: number };
  defensiveOverlapRatio: number;
  effectiveCastRatio: number;
  ccAvoidanceRate: number;
  /** Total seconds / count of healing gaps (#10 T3; detectHealingGaps is the
   * single source, sharing the same detector as keyMoments' heal-gap
   * moments). */
  healingGapSeconds: number;
  healingGapCount: number;
  ccAvoidedCount: number;
  ccLandedCount: number;
  /** Playstyle dimensions (GH #64, BACKLOG #36 (f), 2026-09-05): the
   * per-match "how you play" attributes the healer corpus study found to
   * carry a rating gradient — tool-key rates rise with rating while healing
   * keys do not; cast density / overheal are stable personal attributes
   * (ICC 0.73–0.85). All per-minute of round duration or bounded ratios, so
   * they enter the cohort cells like `ccDensity` (the precedent). */
  /** SPELL_DISPEL events sourced by this healer (own `actionOut`), per minute */
  dispelsPerMin: number;
  /** SPELL_CAST_SUCCESS of interrupt-category spells, per minute */
  kicksPerMin: number;
  /** every SPELL_CAST_SUCCESS, per minute — cast density */
  castsPerMin: number;
  /** 1 − effective / raw healing over healOut (0–1); null when no healing */
  overhealPct: number | null;
}

export function computeHealerMetrics(
  combat: IArenaMatch | IShuffleRound,
  playerName: string,
): IHealerMetrics {
  const allUnits = Object.values(combat.units) as any[];
  const healerUnit = allUnits.find(
    (u) => u.name === playerName && u.type === CombatUnitType.Player,
  );
  if (!healerUnit)
    throw new Error(`Healer unit ${playerName} not found in combat.`);

  const totalDamageOut = healerUnit.damageOut.reduce(
    (sum: number, a: any) => sum + Math.abs(a.effectiveAmount),
    0,
  );
  // Heal contribution uses the compat-computed effectiveAmount (amount minus
  // overheal, and already zeroed for pet-targeted heals). The old fork decoded
  // this from raw parameters[30]/[32]; gladlog's parser decodes heals
  // positionally and Blizzard periodically adds advanced-log fields, so
  // hardcoded absolute indices silently point at the wrong columns on a format
  // shift — the exact scenario this once-per-patch offline tool runs in.
  // amount - overheal === effectiveAmount, so the fallback is equivalent today
  // and robust to drift. absorbsOut carries absorbedAmount, not effectiveAmount.
  const totalHealOut =
    healerUnit.healOut.reduce(
      (sum: number, a: any) => sum + Math.abs(a.effectiveAmount),
      0,
    ) +
    healerUnit.absorbsOut.reduce(
      (sum: number, a: any) => sum + Math.abs(a.absorbedAmount),
      0,
    );
  const offensiveIndex = totalHealOut > 0 ? totalDamageOut / totalHealOut : 0;

  const ccCasts = healerUnit.spellCastEvents.filter(
    (e: any) =>
      e.logLine.event === "SPELL_CAST_SUCCESS" &&
      ccSpellIds.has(String(e.spellId)),
  );
  const durationSeconds = (combat.endTime - combat.startTime) / 1000;
  const ccDensity =
    durationSeconds > 0 ? (ccCasts.length / durationSeconds) * 60 : 0;
  const perMin = (n: number): number =>
    durationSeconds > 0 ? (n / durationSeconds) * 60 : 0;
  const allSuccessCasts = healerUnit.spellCastEvents.filter(
    (e: any) => e.logLine.event === "SPELL_CAST_SUCCESS",
  );
  const kickCasts = allSuccessCasts.filter((e: any) => {
    const cat = SPELL_CATEGORIES[String(e.spellId)];
    return cat?.type === "interrupts";
  });
  // Deliberate dispels only — the same `classifyDispel` predicate the
  // dispel dashboard and the prompt's MINOR DISPELS fold read (a Cleanse the
  // Weak proc is not a key press; Holy Paladin p90 read 13.5/min raw).
  const castIndex = buildCastMatchIndex([healerUnit]);
  const dispelEvents = (healerUnit.actionOut ?? []).filter(
    (a: any) =>
      a.logLine?.event === "SPELL_DISPEL" &&
      a.extraSpellId !== undefined &&
      isDeliberateDispel(
        classifyDispel(castIndex, {
          srcUnitId: a.srcUnitId || healerUnit.id,
          spellId: a.spellId,
          spellName: a.spellName,
          timestamp: a.timestamp,
        }),
      ),
  );
  const rawHealOut = healerUnit.healOut.reduce(
    (sum: number, a: any) => sum + Math.abs(a.amount ?? a.effectiveAmount ?? 0),
    0,
  );
  const effectiveHealOnly = healerUnit.healOut.reduce(
    (sum: number, a: any) => sum + Math.abs(a.effectiveAmount ?? 0),
    0,
  );
  const dispelsPerMin = perMin(dispelEvents.length);
  const kicksPerMin = perMin(kickCasts.length);
  const castsPerMin = perMin(allSuccessCasts.length);
  const overhealPct =
    rawHealOut > 0 ? Math.max(0, 1 - effectiveHealOnly / rawHealOut) : null;

  const friends = allUnits.filter(
    (u) =>
      u.type === CombatUnitType.Player && u.reaction === healerUnit.reaction,
  );
  const enemies = allUnits.filter(
    (u) =>
      u.type === CombatUnitType.Player && u.reaction !== healerUnit.reaction,
  );
  const enemyCDTimeline = reconstructEnemyCDTimeline(
    enemies,
    combat as any,
    healerUnit,
    friends,
  );
  const cooldowns = extractMajorCooldowns(healerUnit, combat as any);
  const annotated = annotateDefensiveTimings(
    cooldowns,
    healerUnit,
    combat as any,
    enemyCDTimeline as any,
  );
  const lat = computeCDResponseLatency(
    annotated,
    (enemyCDTimeline as any).alignedBurstWindows,
    combat.startTime,
  );
  const reactionLatency =
    lat.latencyMsMedian !== null ? lat.latencyMsMedian / 1000 : null;
  const burstResponseCoverage = {
    answered: lat.answered,
    windows: lat.windows,
  };

  const overlaps = detectOverlappedDefensives(friends, combat as any);
  const myOverlapCount = overlaps.filter(
    (o: any) =>
      o.firstCasterName === playerName || o.secondCasterName === playerName,
  ).length;
  const myTotalDefensives = healerUnit.spellCastEvents.filter(
    (e: any) =>
      e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
      MAJOR_DEFENSIVE_IDS.has(String(e.spellId)),
  ).length;
  const defensiveOverlapRatio = myOverlapCount / (myTotalDefensives + 1);

  const enemyPlayerIds = new Set(enemies.map((u: any) => u.id));
  const enemyPets = Object.values(combat.units ?? {}).filter(
    (u: any) => u.ownerId && enemyPlayerIds.has(u.ownerId),
  ) as any[];
  const ccTrinketSummary = analyzePlayerCCAndTrinket(
    healerUnit,
    enemies,
    combat as any,
    enemyPets,
  );
  const successCasts = healerUnit.spellCastEvents.filter(
    (e: any) => e.logLine.event === "SPELL_CAST_SUCCESS",
  ).length;
  const interuptsOnMe = ccTrinketSummary.interruptInstances.length;
  const effectiveCastRatio = successCasts / (successCasts + interuptsOnMe + 1);

  const avoidedCount = ccTrinketSummary.ccAvoidedInstances.length;
  const successfulCCCount = ccTrinketSummary.ccInstances.length;
  const ccAvoidanceRate = avoidedCount / (avoidedCount + successfulCCCount + 1);

  // Healing gaps (#10 T3): the same detector (detectHealingGaps) as
  // keyMoments' heal-gap moments -- do not invent a second "gap" judgment
  // here.
  const healingGaps = detectHealingGaps(
    healerUnit,
    friends,
    enemies,
    combat as any,
  );
  const healingGapSeconds = healingGaps.reduce(
    (sum, g) => sum + g.durationSeconds,
    0,
  );
  const healingGapCount = healingGaps.length;

  return {
    offensiveIndex,
    ccDensity,
    dispelsPerMin,
    kicksPerMin,
    castsPerMin,
    overhealPct,
    reactionLatency,
    burstResponseCoverage,
    defensiveOverlapRatio,
    effectiveCastRatio,
    ccAvoidanceRate,
    healingGapSeconds,
    healingGapCount,
    ccAvoidedCount: avoidedCount,
    ccLandedCount: successfulCCCount,
  };
}
