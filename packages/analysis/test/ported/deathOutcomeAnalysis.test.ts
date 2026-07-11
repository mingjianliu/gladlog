/* eslint-disable @typescript-eslint/no-explicit-any */
import { CombatUnitSpec, LogEvent } from '@gladlog/parser-compat';

import {
  buildDeathOutcomeSummary,
  formatDeathOutcomeForContext,
  wasLockedOutThroughWindow,
} from '../../src/utils/deathOutcomeAnalysis';
import { makeAdvancedAction, makeAuraEvent, makeSpellCastEvent, makeUnit } from './testHelpers';

const MATCH_START = 1_000_000;
const MATCH_END = 1_300_000;

function makeCombat() {
  return { startTime: MATCH_START, endTime: MATCH_END, startInfo: { zoneId: '1505' } };
}

function makeDeadUnit(id: string, deathTimestampMs: number, overrides: any = {}) {
  const u = makeUnit(id, overrides) as any;
  u.deathRecords = [{ timestamp: deathTimestampMs, event: LogEvent.UNIT_DIED, parameters: [] }];
  return u;
}

function makeCCSummary(playerName: string, instances: any[] = []): any {
  return { playerName, ccInstances: instances };
}

describe('buildDeathOutcomeSummary — immunity checks', () => {
  it('returns empty events when no friendly deaths occurred', () => {
    const result = buildDeathOutcomeSummary(makeCombat() as any, [], []);
    expect(result.events).toHaveLength(0);
  });

  it('flags Divine Shield available at death when never used', () => {
    const dead = makeDeadUnit('p1', MATCH_START + 10_000, { spec: CombatUnitSpec.Paladin_Retribution });
    const result = buildDeathOutcomeSummary(makeCombat() as any, [dead], [makeCCSummary('p1')]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].availableImmunities).toHaveLength(1);
    expect(result.events[0].availableImmunities[0].spellName).toBe('Divine Shield');
  });

  it('does NOT flag Divine Shield when it was used recently (still on CD)', () => {
    const dead = makeDeadUnit('p1', MATCH_START + 40_000, {
      spec: CombatUnitSpec.Paladin_Retribution,
      spellCastEvents: [makeSpellCastEvent('642', MATCH_START + 10_000, 'p1')],
    });
    const result = buildDeathOutcomeSummary(makeCombat() as any, [dead], [makeCCSummary('p1')]);
    expect(result.events[0]?.availableImmunities ?? []).toHaveLength(0);
  });

  it('flags Ice Block available when Cold Snap reset the cooldown (B30)', () => {
    const dead = makeDeadUnit('p1', MATCH_START + 40_000, {
      spec: CombatUnitSpec.Mage_Frost,
      spellCastEvents: [
        // Ice Block cast at t=10s (CD=240s)
        makeSpellCastEvent('45438', MATCH_START + 10_000, 'p1', 'Self', 'p1', 'Mage'),
        // Cold Snap cast at t=20s (Resets Ice Block)
        makeSpellCastEvent('235219', MATCH_START + 20_000, 'p1', 'Self', 'p1', 'Mage'),
      ],
    });
    const result = buildDeathOutcomeSummary(makeCombat() as any, [dead], [makeCCSummary('p1')]);
    expect(result.events[0].availableImmunities).toHaveLength(1);
    expect(result.events[0].availableImmunities[0].spellName).toBe('Ice Block');
  });

  it('correctly handles multiple lockout intervals via binary search (B29)', () => {
    const dead = makeUnit('p1', {
      spec: CombatUnitSpec.Mage_Frost,
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '41425', MATCH_START + 10_000, 'p1', 'p1', 'DEBUFF'),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, '41425', MATCH_START + 20_000, 'p1', 'p1', 'DEBUFF'),
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '41425', MATCH_START + 40_000, 'p1', 'p1', 'DEBUFF'),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, '41425', MATCH_START + 50_000, 'p1', 'p1', 'DEBUFF'),
      ],
    }) as any;
    // Three deaths: 15s (locked), 30s (free), 45s (locked)
    dead.deathRecords = [
      { timestamp: MATCH_START + 15_000, event: LogEvent.UNIT_DIED, parameters: [] },
      { timestamp: MATCH_START + 30_000, event: LogEvent.UNIT_DIED, parameters: [] },
      { timestamp: MATCH_START + 45_000, event: LogEvent.UNIT_DIED, parameters: [] },
    ];

    const result = buildDeathOutcomeSummary(makeCombat() as any, [dead], [makeCCSummary('p1')]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].atSeconds).toBe(30);
  });

  it('C3: annotates "was in CC" when CC-locked through the window even if free at the death tick', () => {
    // Ret Paladin dies at 10s with Divine Shield available; CC covers [5,9.9] (window [5,10]),
    // but has ended by the exact death tick (10) — the old death-instant check said "not CC'd".
    const dead = makeDeadUnit('p1', MATCH_START + 10_000, { spec: CombatUnitSpec.Paladin_Retribution });
    const ccSummary = makeCCSummary('p1', [{ atSeconds: 5, durationSeconds: 4.9, trinketState: 'available_unused' }]);
    const result = buildDeathOutcomeSummary(makeCombat() as any, [dead], [ccSummary]);
    const out = formatDeathOutcomeForContext(result);
    expect(out).toContain('Divine Shield available, was in CC');
  });
});

describe('buildDeathOutcomeSummary — external defensive checks', () => {
  it('flags missed Ironbark when Druid was free and had it available', () => {
    const warrior = makeDeadUnit('w1', MATCH_START + 90_000, { spec: CombatUnitSpec.Warrior_Arms, name: 'Warrior' });
    const druid = makeUnit('d1', { spec: CombatUnitSpec.Druid_Restoration, name: 'Druid' });
    const result = buildDeathOutcomeSummary(
      makeCombat() as any,
      [warrior, druid],
      [makeCCSummary('Warrior'), makeCCSummary('Druid')],
    );
    expect(result.events[0].missedExternals).toHaveLength(1);
    expect(result.events[0].missedExternals[0].spellName).toBe('Ironbark');
  });

  it('skips Ironbark when Druid was too far away (>40 yards) at death time (B27)', () => {
    const warrior = makeDeadUnit('w1', MATCH_START + 90_000, {
      spec: CombatUnitSpec.Warrior_Arms,
      name: 'Warrior',
      advancedActions: [makeAdvancedAction(MATCH_START + 90_000, 0, 0)],
    });
    const druid = makeUnit('d1', {
      spec: CombatUnitSpec.Druid_Restoration,
      name: 'Druid',
      advancedActions: [makeAdvancedAction(MATCH_START + 90_000, 50, 0)],
    });
    const result = buildDeathOutcomeSummary(
      makeCombat() as any,
      [warrior, druid],
      [makeCCSummary('Warrior'), makeCCSummary('Druid')],
    );
    expect(result.events[0]?.missedExternals ?? []).toHaveLength(0);
  });

  it('flags missed external when teammate cast the spell this match (B113)', () => {
    // Cast at MATCH_START - 500s (so it's available at t=90s)
    const warrior = makeDeadUnit('w1', MATCH_START + 90_000, { spec: CombatUnitSpec.Warrior_Arms, name: 'Warrior' });
    const spriest = makeUnit('p1', {
      spec: CombatUnitSpec.Priest_Shadow,
      name: 'Priest',
      spellCastEvents: [makeSpellCastEvent('47788', MATCH_START - 500_000, 'w1', 'Warrior', 'p1', 'Priest')], // GS
    });
    const result = buildDeathOutcomeSummary(
      makeCombat() as any,
      [warrior, spriest],
      [makeCCSummary('Warrior'), makeCCSummary('Priest')],
    );
    expect(result.events[0].missedExternals).toHaveLength(1);
    expect(result.events[0].missedExternals[0].spellName).toBe('Guardian Spirit');
  });
});

describe('formatDeathOutcomeForContext', () => {
  it('formats multiple events correctly', () => {
    const summary: any = {
      events: [
        {
          deadPlayer: 'P1',
          deadPlayerSpec: 'Arms Warrior',
          atSeconds: 100,
          availableImmunities: [{ spellName: 'Shield', wasInCC: true }],
          missedExternals: [{ casterName: 'C1', spellName: 'Bark', casterWasInCC: false }],
        },
      ],
    };
    const res = formatDeathOutcomeForContext(summary);
    expect(res).toContain('1:40');
    expect(res).toContain('had Shield available, was in CC');
    expect(res).toContain('C1 had Bark available, caster was free');
  });

  it('returns empty for no events', () => {
    expect(formatDeathOutcomeForContext({ events: [] })).toBe('');
  });
});

describe('wasLockedOutThroughWindow', () => {
  const cc = (atSeconds: number, durationSeconds: number, trinketState = 'available_unused'): any => ({
    atSeconds,
    durationSeconds,
    trinketState,
  });

  it('locks out when CC covers the window but the player is free at the death tick', () => {
    // death at 10; window [5,10]; CC [5,9.9] leaves only a 0.1s free tail
    const summary = { playerName: 'p', ccInstances: [cc(5, 4.9)] };
    expect(wasLockedOutThroughWindow(summary, 10)).toBe(true);
  });

  it('does NOT lock out when there is a >= 1s free gap mid-window', () => {
    // death at 10; window [5,10]; stuns [5,6] and [9,9.5] leave a 3s gap
    const summary = { playerName: 'p', ccInstances: [cc(5, 1), cc(9, 0.5)] };
    expect(wasLockedOutThroughWindow(summary, 10)).toBe(false);
  });

  it('locks out when CC fully spans the window', () => {
    const summary = { playerName: 'p', ccInstances: [cc(4, 7)] }; // [4,11] covers [5,10]
    expect(wasLockedOutThroughWindow(summary, 10)).toBe(true);
  });

  it('does NOT lock out when there is no CC', () => {
    expect(wasLockedOutThroughWindow({ playerName: 'p', ccInstances: [] }, 10)).toBe(false);
  });

  it('ignores CC the player trinketed out of', () => {
    const summary = { playerName: 'p', ccInstances: [cc(5, 4.9, 'used')] };
    expect(wasLockedOutThroughWindow(summary, 10)).toBe(false);
  });

  it('clamps the window to match start for an early death', () => {
    // death at 3; window clamps to [0,3]; CC [0,3] fully covers it
    const summary = { playerName: 'p', ccInstances: [cc(0, 3)] };
    expect(wasLockedOutThroughWindow(summary, 3)).toBe(true);
  });
});
