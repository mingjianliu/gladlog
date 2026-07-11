/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  distanceBetween,
  distanceToNearestObstacleEdge,
  getUnitPositionAtTime,
  hasLineOfSight,
  nearestLosBreakOption,
} from '../../src/utils/losAnalysis';
import { makeAdvancedAction, makeUnit } from './testHelpers';

describe('losAnalysis — position interpolation', () => {
  it('returns null when no advanced actions exist', () => {
    const unit = makeUnit('u1');
    expect(getUnitPositionAtTime(unit as any, 1000)).toBeNull();
  });

  it('returns null when timestamp is before first action', () => {
    const unit = makeUnit('u1', { advancedActions: [makeAdvancedAction(2000, 10, 10)] });
    expect(getUnitPositionAtTime(unit as any, 1000)).toBeNull();
  });

  it('returns last position when timestamp is after last action', () => {
    const unit = makeUnit('u1', { advancedActions: [makeAdvancedAction(1000, 10, 10)] });
    expect(getUnitPositionAtTime(unit as any, 2000)).toEqual({ x: 10, y: 10 });
  });

  it('interpolates position between two actions (B65)', () => {
    const unit = makeUnit('u1', {
      advancedActions: [makeAdvancedAction(1000, 0, 0), makeAdvancedAction(2000, 10, 20)],
    });
    // at t=1500, should be (5, 10)
    expect(getUnitPositionAtTime(unit as any, 1500)).toEqual({ x: 5, y: 10 });
  });

  // Position snapshots are event-driven: a unit that is idle (drinking, stealthed,
  // out of combat) produces no snapshots, and interpolating across a long gap
  // fabricates a straight-line position. maxGapMs lets callers reject those.
  describe('maxGapMs (gap-aware interpolation)', () => {
    it('returns null when the bracketing snapshots are further apart than maxGapMs', () => {
      const unit = makeUnit('u1', {
        advancedActions: [makeAdvancedAction(1000, 0, 0), makeAdvancedAction(31_000, 10, 20)],
      });
      expect(getUnitPositionAtTime(unit as any, 15_000, 10_000)).toBeNull();
    });

    it('still interpolates when the gap is within maxGapMs', () => {
      const unit = makeUnit('u1', {
        advancedActions: [makeAdvancedAction(1000, 0, 0), makeAdvancedAction(2000, 10, 20)],
      });
      expect(getUnitPositionAtTime(unit as any, 1500, 10_000)).toEqual({ x: 5, y: 10 });
    });

    it('returns null after the last snapshot once maxGapMs has elapsed', () => {
      const unit = makeUnit('u1', { advancedActions: [makeAdvancedAction(1000, 10, 10)] });
      expect(getUnitPositionAtTime(unit as any, 20_000, 10_000)).toBeNull();
      // within the gap the last-known position is still usable
      expect(getUnitPositionAtTime(unit as any, 5_000, 10_000)).toEqual({ x: 10, y: 10 });
    });

    it('preserves legacy behavior when maxGapMs is omitted', () => {
      const unit = makeUnit('u1', {
        advancedActions: [makeAdvancedAction(1000, 0, 0), makeAdvancedAction(61_000, 10, 20)],
      });
      expect(getUnitPositionAtTime(unit as any, 31_000)).toEqual({ x: 5, y: 10 });
    });
  });
});

describe('losAnalysis — geometry logic', () => {
  const NAGRAND_1505 = '1505';

  it('returns null for unknown zones', () => {
    expect(hasLineOfSight('999', { x: 0, y: 0 }, { x: 10, y: 0 })).toBeNull();
  });

  it('returns true when no obstacles block the line', () => {
    // Nagrand north pillar is at (-2043, 6621). Line from (-2000, 6600) to (-2000, 6700) is safe.
    expect(hasLineOfSight(NAGRAND_1505, { x: -2000, y: 6600 }, { x: -2000, y: 6700 })).toBe(true);
  });

  it('returns false when blocked by a circular pillar (B66)', () => {
    // Nagrand north pillar: cx=-2043.6, cy=6621.5, r=2.5
    const p1 = { x: -2050, y: 6621.5 };
    const p2 = { x: -2035, y: 6621.5 };
    expect(hasLineOfSight(NAGRAND_1505, p1, p2)).toBe(false);
  });

  it('near-range exemption: two units within 8yd are never LoS-blocked (position-sweep fix)', () => {
    // Straddling the Nagrand north pillar center but only 6yd apart — no arena
    // pillar fully separates two units that close; approximate geometry that
    // claims otherwise is wrong (100-game sweep: 142 landed CCs marked blocked,
    // clustered on minimap-derived maps, many at <6yd).
    const p1 = { x: -2046, y: 6621.5 };
    const p2 = { x: -2040, y: 6621.5 };
    expect(hasLineOfSight(NAGRAND_1505, p1, p2)).toBe(true);
  });

  it('returns false when blocked by a polygon obstacle (B67)', () => {
    // Lordaeron (1672) central tomb: [1276-1295, 1659-1672]
    const p1 = { x: 1285, y: 1650 };
    const p2 = { x: 1285, y: 1680 };
    expect(hasLineOfSight('572', p1, p2)).toBe(false);
  });

  it('detects when one point is inside a polygon', () => {
    // Central tomb in Lordaeron
    const inside = { x: 1285, y: 1665 };
    const outside = { x: 1285, y: 1650 };
    expect(hasLineOfSight('572', inside, outside)).toBe(false);
  });
});

describe('losAnalysis — distance helper', () => {
  it('computes Euclidean distance (B68)', () => {
    expect(distanceBetween({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe('losAnalysis — distanceToNearestObstacleEdge', () => {
  it('returns distance to a circle edge (Nagrand north pillar r=4 @-2044.5,6623.5)', () => {
    const d = distanceToNearestObstacleEdge('1505', { x: -2044.5, y: 6613.5 });
    expect(d).toBeCloseTo(6, 1); // 10 from center, minus r=4
  });

  it('returns 0 when inside an obstacle', () => {
    expect(distanceToNearestObstacleEdge('1505', { x: -2044.5, y: 6623.5 })).toBe(0);
  });

  it('returns distance to the nearest polygon edge (Lordaeron tomb x[1276..1295] y[1659..1672])', () => {
    const d = distanceToNearestObstacleEdge('572', { x: 1285, y: 1650 });
    expect(d).toBeCloseTo(9, 1); // 9 units north of the tomb's y=1659 edge
  });

  it('returns null for unmapped zones', () => {
    expect(distanceToNearestObstacleEdge('999999', { x: 0, y: 0 })).toBeNull();
  });
});

describe('losAnalysis — segmentIntersectsPolygon corner cases', () => {
  it('covers segment completely inside polygon (line 108)', () => {
    // Lordaeron tomb: x[1276..1295] y[1659..1672]
    // Width is 19yd. Place points at x=1278 and x=1292 (distance 14yd > 8yd near-range exemption)
    const p1 = { x: 1278, y: 1665 };
    const p2 = { x: 1292, y: 1665 };
    expect(hasLineOfSight('572', p1, p2)).toBe(false);
  });
});

describe('losAnalysis — distanceToNearestObstacleEdge inside polygon', () => {
  it('returns 0 when a point is inside a polygon obstacle (line 225)', () => {
    const d = distanceToNearestObstacleEdge('572', { x: 1285, y: 1665 });
    expect(d).toBe(0);
  });
});

describe('nearestLosBreakOption', () => {
  const NAGRAND_1505 = '1505';
  const LORDAERON_572 = '572';

  it('returns nearest reposition spot against a circle obstacle', () => {
    const healerPos = { x: -2050, y: 6621.5 };
    const enemies = [{ name: 'M1', pos: { x: -2035, y: 6621.5 } }];
    // Nagrand north pillar center is at (-2043.6, 6621.5), r=2.5
    const opt = nearestLosBreakOption(NAGRAND_1505, healerPos, enemies as any);
    expect(opt).not.toBeNull();
    expect(opt?.blocksEnemyName).toBe('M1');
    expect(opt?.repositionYards).toBeCloseTo(3.26, 1);
  });

  it('returns nearest reposition spot against a polygon obstacle (covers lines 281-285)', () => {
    const healerPos = { x: 1285.5, y: 1650 };
    const enemies = [{ name: 'M1', pos: { x: 1285.5, y: 1680 } }];
    const opt = nearestLosBreakOption(LORDAERON_572, healerPos, enemies as any);
    expect(opt).not.toBeNull();
    expect(opt?.blocksEnemyName).toBe('M1');
  });
});
