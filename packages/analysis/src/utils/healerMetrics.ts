import {
  CombatUnitType,
  IArenaMatch,
  IShuffleRound,
  LogEvent,
} from "@gladlog/parser-compat";
import { ccSpellIds } from "../data/spellTags";
import { analyzePlayerCCAndTrinket } from "./ccTrinketAnalysis";
import {
  annotateDefensiveTimings,
  detectOverlappedDefensives,
  extractMajorCooldowns,
  IMajorCooldownInfo,
  MAJOR_DEFENSIVE_IDS,
} from "./cooldowns";
import { reconstructEnemyCDTimeline } from "./enemyCDs";

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) return sorted[half];
  return (sorted[half - 1] + sorted[half]) / 2.0;
}

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
  ccAvoidedCount: number;
  ccLandedCount: number;
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

  const ccTrinketSummary = analyzePlayerCCAndTrinket(
    healerUnit,
    enemies,
    combat as any,
  );
  const successCasts = healerUnit.spellCastEvents.filter(
    (e: any) => e.logLine.event === "SPELL_CAST_SUCCESS",
  ).length;
  const interuptsOnMe = ccTrinketSummary.interruptInstances.length;
  const effectiveCastRatio = successCasts / (successCasts + interuptsOnMe + 1);

  const avoidedCount = ccTrinketSummary.ccAvoidedInstances.length;
  const successfulCCCount = ccTrinketSummary.ccInstances.length;
  const ccAvoidanceRate = avoidedCount / (avoidedCount + successfulCCCount + 1);

  return {
    offensiveIndex,
    ccDensity,
    reactionLatency,
    burstResponseCoverage,
    defensiveOverlapRatio,
    effectiveCastRatio,
    ccAvoidanceRate,
    ccAvoidedCount: avoidedCount,
    ccLandedCount: successfulCCCount,
  };
}
