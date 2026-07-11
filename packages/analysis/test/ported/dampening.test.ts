/* eslint-disable @typescript-eslint/no-explicit-any */
import { CombatUnitSpec, LogEvent } from '@gladlog/parser-compat';

import {
  computeDampening,
  computeDampeningTimeline,
  dampeningDangerMultiplier,
  formatDampeningForContext,
  getDampeningPercentage,
} from '../../src/utils/dampening';
import { makeAuraEvent, makeUnit } from './testHelpers';

const MATCH_START = 1_000_000;

describe('dampening — rule detection', () => {
  it('identifies Rated Solo Shuffle rules (B69)', () => {
    expect(getDampeningPercentage('Rated Solo Shuffle', [], 0)).toBe(10);
  });

  it('identifies 2v2 with healers (B70)', () => {
    const p1 = makeUnit('p1', { spec: CombatUnitSpec.Priest_Discipline, info: { teamId: '0' } });
    const p2 = makeUnit('p2', { spec: CombatUnitSpec.Warrior_Arms, info: { teamId: '0' } });
    const p3 = makeUnit('p3', { spec: CombatUnitSpec.Paladin_Holy, info: { teamId: '1' } });
    const p4 = makeUnit('p4', { spec: CombatUnitSpec.Mage_Frost, info: { teamId: '1' } });

    expect(getDampeningPercentage('2v2', [p1, p2, p3, p4] as any, 0)).toBe(30);
  });

  it('identifies 2v2 double DPS (B71)', () => {
    const p1 = makeUnit('p1', { spec: CombatUnitSpec.Warrior_Arms, info: { teamId: '0' } });
    const p2 = makeUnit('p2', { spec: CombatUnitSpec.Mage_Frost, info: { teamId: '1' } });
    expect(getDampeningPercentage('2v2', [p1, p2] as any, 0)).toBe(10);
  });

  it('identifies 3v3 based on string or player count (B72)', () => {
    expect(getDampeningPercentage('Three vs Three', [], 0)).toBe(10);
    const players = [makeUnit('1'), makeUnit('2'), makeUnit('3'), makeUnit('4'), makeUnit('5')];
    expect(getDampeningPercentage('Unknown', players as any, 0)).toBe(10);
  });
});

describe('dampening — timeline logic', () => {
  it('extracts dose events correctly (B73)', () => {
    const dose = makeAuraEvent(LogEvent.SPELL_AURA_APPLIED_DOSE as any, '110310', MATCH_START + 10_000, 'h', 'h');
    (dose.logLine as any).parameters[12] = 15; // 15%
    const p = makeUnit('p', { auraEvents: [dose as any] });

    expect(getDampeningPercentage('3v3', [p] as any, MATCH_START + 20_000)).toBe(15);
  });

  it('builds sparse timeline with de-duplication (B74)', () => {
    const dose1 = makeAuraEvent(LogEvent.SPELL_AURA_APPLIED_DOSE as any, '110310', MATCH_START + 10_000, 'h', 'h');
    (dose1.logLine as any).parameters[12] = 15;
    const dose2 = makeAuraEvent(LogEvent.SPELL_AURA_APPLIED_DOSE as any, '110310', MATCH_START + 70_000, 'h', 'h');
    (dose2.logLine as any).parameters[12] = 20;
    const p = makeUnit('p', { auraEvents: [dose1 as any, dose2 as any] });

    const timeline = computeDampeningTimeline('3v3', [p] as any, MATCH_START, MATCH_START + 90_000);
    // [0s: 10% (initial), 30s: 15% (first), 60s: 15% (same - skip), 70s+: 20%]
    // Final should be at 90s: 20%.
    expect(timeline).toHaveLength(3);
    expect(timeline[0]).toEqual({ atSeconds: 0, dampening: 0.1 });
    expect(timeline[1]).toEqual({ atSeconds: 30, dampening: 0.15 });
    expect(timeline[2]).toEqual({ atSeconds: 90, dampening: 0.2 });
  });
});

describe('dampening — danger scoring', () => {
  it('computes capped percentage (B75)', () => {
    const p = makeUnit('p');
    expect(computeDampening(MATCH_START, '3v3', [p] as any)).toBe(0.1);
  });

  it('computes danger multiplier (B76)', () => {
    // 0% -> 1.0x
    expect(dampeningDangerMultiplier(0)).toBe(1.0);
    // 30% -> 1 + 0.3 * 1.5 = 1.45x
    expect(dampeningDangerMultiplier(0.3)).toBe(1.45);
  });
});

describe('dampening — formatting', () => {
  it('suppresses short/low matches (B77)', () => {
    // 60s match with 10% dampening
    expect(formatDampeningForContext('3v3', [], MATCH_START, MATCH_START + 60_000)).toHaveLength(0);
  });

  it('labels severe dampening (B78)', () => {
    const dose = makeAuraEvent(LogEvent.SPELL_AURA_APPLIED_DOSE as any, '110310', MATCH_START + 10_000, 'h', 'h');
    (dose.logLine as any).parameters[12] = 45;
    const p = makeUnit('p', { auraEvents: [dose as any] });

    const res = formatDampeningForContext('3v3', [p] as any, MATCH_START, MATCH_START + 120_000);
    expect(res[0]).toContain('started at 10%, ended at 45%');
    expect(res[1]).toContain('Severe dampening (45%)');
  });

  it('labels late game note (B79)', () => {
    const dose = makeAuraEvent(LogEvent.SPELL_AURA_APPLIED_DOSE as any, '110310', MATCH_START + 10_000, 'h', 'h');
    (dose.logLine as any).parameters[12] = 25;
    const p = makeUnit('p', { auraEvents: [dose as any] });

    const res = formatDampeningForContext('3v3', [p] as any, MATCH_START, MATCH_START + 120_000);
    expect(res[1]).toContain('Reached 25% dampening');
  });
});
