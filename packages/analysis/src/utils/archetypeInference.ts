import { IArenaMatch, ICombatUnit, IShuffleRound } from '@gladlog/parser-compat';

import { analyzePlayerCCAndTrinket } from './ccTrinketAnalysis';
import { isHealerSpec, specToString } from './cooldowns';
import { analyzeOutgoingCCChains } from './drAnalysis';
import { reconstructEnemyCDTimeline } from './enemyCDs';
import { analyzeHealerExposureAtBurst } from './healerExposureAnalysis';
import { computeMatchArchetype } from './matchArchetype';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IMatchDynamicFeatures {
  durationSeconds: number;
  burstWindowCount: number;
  peakBurstScore: number;
  burstWindowQuality: { low: number; moderate: number; high: number; critical: number };
  ccEventsPerMinute: number;
  tunnelScore: number; // friendlyDamageShare[0].share
  criticalOrExposedBurstWindows: number | null;
  enemyMeleeCount: number;
  enemyRangedCount: number;
  setupStyle: 'one_shot_burst' | 'cc_then_burst' | 'flat_dampening' | 'unknown';
  ownTeamCCPerMin: number;
  enemyTeamCCPerMin: number;
  ownTeamSpecs: string[];
  enemyTeamSpecs: string[];
}

export interface IArchetypeModel {
  normParams: { mean: number[]; std: number[] };
  featureNames: string[];
  centroids: number[][];
}

type ParsedCombat = IArenaMatch | IShuffleRound;

// ── Feature vector + classification ───────────────────────────────────────────

export function toFeatureVector(d: IMatchDynamicFeatures): number[] {
  return [
    d.burstWindowCount,
    d.ccEventsPerMinute,
    d.tunnelScore,
    Math.log1p(d.peakBurstScore),
    d.criticalOrExposedBurstWindows ?? 0,
    Math.log1p(d.durationSeconds),
    d.ownTeamCCPerMin,
  ];
}

export function normalize(v: number[], params: IArchetypeModel['normParams']): number[] {
  return v.map((x, i) => {
    const std = params.std[i] || 1;
    return (x - params.mean[i]) / std;
  });
}

export function euclidean(a: number[], b: number[]): number {
  return Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0));
}

export function classifyCluster(
  matchDynamic: IMatchDynamicFeatures,
  model: IArchetypeModel,
): { clusterKey: string; clusterIdx: number; distance: number } {
  const vec = normalize(toFeatureVector(matchDynamic), model.normParams);
  let bestIdx = 0;
  let bestDist = Infinity;
  model.centroids.forEach((centroid, idx) => {
    const dist = euclidean(vec, centroid);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = idx;
    }
  });
  return { clusterKey: `cluster_${bestIdx}`, clusterIdx: bestIdx, distance: bestDist };
}

// ── Match dynamic feature extraction ─────────────────────────────────────────

export function extractMatchDynamics(
  combat: ParsedCombat,
  friends: ICombatUnit[],
  enemies: ICombatUnit[],
): IMatchDynamicFeatures | null {
  const durationSeconds = (combat.endTime - combat.startTime) / 1000;
  if (durationSeconds < 10) return null;

  const healerUnit = friends.find((u) => isHealerSpec(u.spec)) ?? null;
  const ccTrinketSummaries = friends.map((p) => analyzePlayerCCAndTrinket(p, enemies, combat));
  const enemyCDTimeline = reconstructEnemyCDTimeline(enemies, combat, healerUnit ?? undefined, friends);

  const healerCCSummary = healerUnit ? ccTrinketSummaries.find((s) => s.playerName === healerUnit.name) : undefined;
  const healerExposures =
    healerUnit && healerCCSummary
      ? analyzeHealerExposureAtBurst(
          enemyCDTimeline.alignedBurstWindows,
          enemies,
          healerUnit,
          healerCCSummary,
          ccTrinketSummaries,
          combat.startInfo.zoneId,
          combat.startTime,
        )
      : [];

  const archetype = computeMatchArchetype(
    friends,
    enemies,
    combat,
    ccTrinketSummaries,
    enemyCDTimeline.alignedBurstWindows,
    healerExposures,
  );

  // Must match extractArchetypeFeatures.ts and archetypeInjection.ts — both clustering
  // and classification depend on ownTeamCCPerMin being computed identically.
  const ownTeamOutgoing = analyzeOutgoingCCChains(friends, enemies, combat);
  const enemyTeamOutgoing = analyzeOutgoingCCChains(enemies, friends, combat);
  const ownTeamCCEvents = ownTeamOutgoing.reduce((s, c) => s + c.applications.length, 0);
  const enemyTeamCCEvents = enemyTeamOutgoing.reduce((s, c) => s + c.applications.length, 0);

  const burstWindowQuality = { low: 0, moderate: 0, high: 0, critical: 0 };
  for (const w of enemyCDTimeline.alignedBurstWindows) {
    const label = w.dangerLabel.toLowerCase();
    if (label in burstWindowQuality) {
      burstWindowQuality[label as keyof typeof burstWindowQuality]++;
    }
  }

  return {
    durationSeconds: archetype.durationSeconds,
    burstWindowCount: archetype.burstWindowCount,
    peakBurstScore: archetype.peakBurstScore,
    burstWindowQuality,
    ccEventsPerMinute: archetype.ccEventsPerMinute,
    tunnelScore: archetype.friendlyDamageShare[0]?.share ?? 0,
    criticalOrExposedBurstWindows: archetype.criticalOrExposedBurstWindows,
    enemyMeleeCount: archetype.enemyMeleeCount,
    enemyRangedCount: archetype.enemyRangedCount,
    setupStyle: 'unknown', // setupStyle calculation is complex and depends on first death context
    ownTeamCCPerMin: durationSeconds > 0 ? (ownTeamCCEvents / durationSeconds) * 60 : 0,
    enemyTeamCCPerMin: durationSeconds > 0 ? (enemyTeamCCEvents / durationSeconds) * 60 : 0,
    ownTeamSpecs: friends.map((p) => specToString(p.spec)),
    enemyTeamSpecs: enemies.map((p) => specToString(p.spec)),
  };
}
