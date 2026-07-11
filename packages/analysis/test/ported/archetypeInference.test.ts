/* eslint-disable @typescript-eslint/no-explicit-any */
import { CombatUnitReaction, CombatUnitSpec, LogEvent } from '@gladlog/parser-compat';

import {
  classifyCluster,
  euclidean,
  extractMatchDynamics,
  IMatchDynamicFeatures,
  normalize,
  toFeatureVector,
} from '../../src/utils/archetypeInference';
import { makeAuraEvent, makeUnit } from './testHelpers';

describe('archetypeInference — math helpers', () => {
  it('toFeatureVector converts match dynamics to fixed-length array', () => {
    const d = {
      durationSeconds: 120,
      burstWindowCount: 5,
      peakBurstScore: 100,
      burstWindowQuality: { low: 0, moderate: 0, high: 0, critical: 0 },
      ccEventsPerMinute: 2.5,
      tunnelScore: 0.8,
      criticalOrExposedBurstWindows: 2,
      enemyMeleeCount: 1,
      enemyRangedCount: 1,
      setupStyle: 'unknown' as const,
      ownTeamCCPerMin: 1.5,
      enemyTeamCCPerMin: 1.8,
      ownTeamSpecs: [],
      enemyTeamSpecs: [],
    };

    const vec = toFeatureVector(d);
    // [burstWindowCount, ccEventsPerMinute, tunnelScore, log1p(peakBurstScore), criticalOrExposedBurstWindows, log1p(durationSeconds), ownTeamCCPerMin]
    expect(vec).toHaveLength(7);
    expect(vec[0]).toBe(5);
    expect(vec[1]).toBe(2.5);
    expect(vec[2]).toBe(0.8);
    expect(vec[3]).toBeCloseTo(Math.log1p(100), 4);
    expect(vec[4]).toBe(2);
    expect(vec[5]).toBeCloseTo(Math.log1p(120), 4);
    expect(vec[6]).toBe(1.5);
  });

  it('normalize applies z-score scaling using mean/std params', () => {
    const v = [10, 20];
    const params = {
      mean: [0, 0],
      std: [100, 100],
    };
    const res = normalize(v, params);
    expect(res).toEqual([0.1, 0.2]);
  });

  it('normalize guards against zero std (std=0 → divisor 1)', () => {
    const v = [10];
    const params = { mean: [10], std: [0] };
    const res = normalize(v, params);
    expect(res).toEqual([0]);
  });

  it('euclidean computes L2 distance', () => {
    const a = [0, 0];
    const b = [3, 4];
    expect(euclidean(a, b)).toBe(5);
  });
});

describe('classifyCluster', () => {
  const mockModel = {
    normParams: {
      mean: [0, 0, 0, 0, 0, 0, 0],
      std: [1, 1, 1, 1, 1, 1, 1],
    },
    featureNames: [],
    centroids: [
      [1, 1, 0.1, 0.7, 1, 2.4, 1], // Cluster 0 ≈ lowActivity feature vector
      [9, 9, 0.9, 9.2, 9, 9.2, 9], // Cluster 1 ≈ highActivity feature vector
    ],
  };

  it('assigns dynamic features to the closest cluster centroid', () => {
    const lowActivity = {
      burstWindowCount: 1,
      ccEventsPerMinute: 1,
      tunnelScore: 0.1,
      peakBurstScore: 1, // log1p(1) = 0.69
      criticalOrExposedBurstWindows: 1,
      durationSeconds: 10, // log1p(10) = 2.4
      ownTeamCCPerMin: 1,
    } as unknown as IMatchDynamicFeatures;

    const res = classifyCluster(lowActivity, mockModel);
    expect(res.clusterIdx).toBe(0);
    expect(res.clusterKey).toBe('cluster_0');

    const highActivity = {
      burstWindowCount: 9,
      ccEventsPerMinute: 9,
      tunnelScore: 0.9,
      peakBurstScore: 10000, // log1p(large)
      criticalOrExposedBurstWindows: 9,
      durationSeconds: 10000, // log1p(large)
      ownTeamCCPerMin: 9,
    } as unknown as IMatchDynamicFeatures;

    const res2 = classifyCluster(highActivity, mockModel);
    expect(res2.clusterIdx).toBe(1);
    expect(res2.clusterKey).toBe('cluster_1');
  });
});

describe('extractMatchDynamics', () => {
  it('returns null for very short matches', () => {
    const combat = { startTime: 1000, endTime: 5000 } as any; // 4s
    expect(extractMatchDynamics(combat, [], [])).toBeNull();
  });

  it('extracts features from a valid match (B51)', () => {
    const MATCH_START = 1_000_000;
    const combat = {
      startTime: MATCH_START,
      endTime: MATCH_START + 60_000,
      startInfo: { zoneId: '1505' },
    } as any;
    const friend = makeUnit('f1', { spec: CombatUnitSpec.Priest_Discipline });
    const enemy = makeUnit('e1', { spec: CombatUnitSpec.Warrior_Arms, reaction: CombatUnitReaction.Hostile });

    const res = extractMatchDynamics(combat, [friend], [enemy]);

    expect(res).not.toBeNull();
    expect(res?.durationSeconds).toBe(60);
    expect(res?.ownTeamSpecs).toContain('Discipline Priest');
    expect(res?.enemyTeamSpecs).toContain('Arms Warrior');
  });

  it('handles matches with no CC events (B52)', () => {
    const combat = { startTime: 0, endTime: 60000, startInfo: { zoneId: '1672' } } as any;
    const res = extractMatchDynamics(
      combat,
      [makeUnit('f')],
      [makeUnit('e', { reaction: CombatUnitReaction.Hostile })],
    );
    expect(res?.ownTeamCCPerMin).toBe(0);
    expect(res?.enemyTeamCCPerMin).toBe(0);
  });

  it('calculates CC per minute correctly when events exist (B53)', () => {
    const ccOnFriend = makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '118', 10000, 'e1', 'f1');
    const ccOnEnemy = makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '853', 20000, 'f1', 'e1');
    // For the swap call in extractMatchDynamics to work, BOTH units must be "hostile"
    // when they are being checked as the target of CC.
    const f1 = makeUnit('f1', { reaction: CombatUnitReaction.Hostile, auraEvents: [ccOnFriend] });
    const e1 = makeUnit('e1', { reaction: CombatUnitReaction.Hostile, auraEvents: [ccOnEnemy] });

    const combat = {
      startTime: 0,
      endTime: 60000,
      startInfo: { zoneId: '1672' },
      auraEvents: [ccOnFriend, ccOnEnemy],
    } as any;
    const res = extractMatchDynamics(combat, [f1], [e1]);
    expect(res?.ownTeamCCPerMin).toBeGreaterThan(0);
    expect(res?.enemyTeamCCPerMin).toBeGreaterThan(0);
  });
});
