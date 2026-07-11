/* eslint-disable @typescript-eslint/no-explicit-any */
import { CombatExtraSpellAction, CombatUnitReaction, CombatUnitSpec, LogEvent } from '@gladlog/parser-compat';

import {
  annotateMissedPurgesWithKillWindows,
  canDefensiveCleanse,
  canOffensivePurge,
  formatDispelContextForAI,
  IMissedPurgeWindow,
  reconstructDispelSummary,
  wasRemovedByAllyDispel,
} from '../../src/utils/dispelAnalysis';
import { DISPEL_FEATURE_FLAGS } from '../../src/data/dispelFeatureFlags';
import { makeAuraEvent, makeUnit } from './testHelpers';

beforeAll(() => {
  DISPEL_FEATURE_FLAGS.F18_FATAL_DISPEL = true;
  DISPEL_FEATURE_FLAGS.F124_ENHANCED_CC_ANNOTATIONS = true;
  DISPEL_FEATURE_FLAGS.F131_F132_CLEANSE_COOLDOWNS = true;
  DISPEL_FEATURE_FLAGS.F142_OFFENSIVE_DISPEL_SUMMARY = true;
  DISPEL_FEATURE_FLAGS.F152_MISSED_PURGES_TIMELINE = true;
});

// Mock talents module to bypass complex lookups
vi.mock('../../src/utils/talents', () => ({
  getPlayerTalentedSpellIds: (_spec: any, talents: any) => {
    if (talents === 'HAS_DISEASE') return new Set(['213634']);
    if (talents === 'HAS_FELHUNTER') return new Set(['30146']);
    if (talents === 'EMPTY') return new Set();
    return null;
  },
  getSpecTalentTreeSpellIds: () => new Set(['213634', '278326', '30146']),
}));

const MATCH_START = 1_000_000;

function makeExtraAction(timestamp: number, event: LogEvent, overrides: any): CombatExtraSpellAction {
  // compat 中 CombatExtraSpellAction 为接口:直接构造字面量
  const action: any = {};
  Object.assign(action, {
    timestamp,
    logLine: { event, timestamp, parameters: [] },
    spellId: '123',
    spellName: 'Test',
    extraSpellId: '456',
    extraSpellName: 'Extra',
    srcUnitId: 's1',
    destUnitId: 'd1',
    destUnitName: 'Dest',
    ...overrides,
  });
  return action;
}

describe('dispelAnalysis — cleanse/purge capability', () => {
  it('handles talent-gated Shadow Priest Purify Disease (B54)', () => {
    const spriest = makeUnit('p1', { spec: CombatUnitSpec.Priest_Shadow });
    expect(canDefensiveCleanse(spriest as any, 'Disease')).toBe(false);

    (spriest as any).info = { talents: 'HAS_DISEASE' };
    expect(canDefensiveCleanse(spriest as any, 'Disease')).toBe(true);
  });

  it('handles DH Consume Magic talent gating (B55)', () => {
    const dh = makeUnit('dh', { spec: CombatUnitSpec.DemonHunter_Havoc });
    (dh as any).info = undefined;
    expect(canOffensivePurge(dh as any)).toBe(true);

    (dh as any).info = { talents: 'EMPTY' };
    expect(canOffensivePurge(dh as any)).toBe(false);
  });

  it('handles Warlock Felhunter talent gating (B56)', () => {
    const lock = makeUnit('lock', { spec: CombatUnitSpec.Warlock_Affliction });
    (lock as any).info = { talents: 'EMPTY' };
    expect(canOffensivePurge(lock as any)).toBe(false);

    (lock as any).info = { talents: 'HAS_FELHUNTER' };
    expect(canOffensivePurge(lock as any)).toBe(true);
  });
});

describe('dispelAnalysis — summary reconstruction', () => {
  function makeCombat() {
    return { startTime: MATCH_START, endTime: MATCH_START + 120_000 };
  }

  it('attributes pet dispels to the owner (B45)', () => {
    const owner = makeUnit('owner1', { name: 'Player1', spec: CombatUnitSpec.Priest_Discipline });
    const pet = makeUnit('pet1', { ownerId: 'owner1', name: 'Imp' } as any);

    const action = makeExtraAction(MATCH_START + 10_000, LogEvent.SPELL_DISPEL, {
      extraSpellId: '118',
      destUnitId: 'owner1',
      destUnitName: 'Player1',
      srcUnitId: 'pet1',
    });
    (pet as any).actionOut = [action];

    const res = reconstructDispelSummary([owner] as any, [], makeCombat(), [pet] as any);
    expect(res.allyCleanse).toHaveLength(1);
    expect(res.allyCleanse[0].sourceName).toBe('Player1');
    expect(res.allyCleanse[0].isPetDispel).toBe(true);
  });

  it('handles hostile purges (B96)', () => {
    const friend = makeUnit('f1', { name: 'Friend', spec: CombatUnitSpec.Warrior_Arms });
    const enemy = makeUnit('e1', { name: 'Enemy', spec: CombatUnitSpec.Mage_Frost });
    (enemy as any).id = 'e1';

    const action = makeExtraAction(MATCH_START + 10_000, LogEvent.SPELL_DISPEL, {
      extraSpellId: '123',
      destUnitId: 'f1',
      srcUnitId: 'e1',
    });
    (enemy as any).actionOut = [action];

    const res = reconstructDispelSummary([friend] as any, [enemy] as any, makeCombat());
    expect(res.hostilePurges).toHaveLength(1);
  });

  it('detects missed cleanse windows and identifies CD usage (B58)', () => {
    const healer = makeUnit('h', { name: 'Healer', spec: CombatUnitSpec.Priest_Holy });
    (healer as any).id = 'h';
    const target = makeUnit('t', { name: 'Target', spec: CombatUnitSpec.Warrior_Arms });
    (target as any).id = 't';

    const firstCleanse = makeExtraAction(MATCH_START + 10_000, LogEvent.SPELL_DISPEL, {
      extraSpellId: '118',
      destUnitId: 't',
      destUnitName: 'Target',
      srcUnitId: 'h',
    });
    (healer as any).actionOut = [firstCleanse];

    const ccApply = makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '118', MATCH_START + 15_000, 'e1', 't');
    const ccRemove = makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, '118', MATCH_START + 25_000, 'e1', 't');
    (target as any).auraEvents = [ccApply, ccRemove];

    const enemy = makeUnit('e1', { reaction: CombatUnitReaction.Hostile });

    const res = reconstructDispelSummary([healer, target] as any, [enemy] as any, makeCombat());
    expect(res.missedCleanseWindows).toHaveLength(1);
    expect(res.missedCleanseWindows[0].cleanseWasOnCD).toBe(true);
  });

  it('F131/F132: respects dynamic cleanse cooldowns based on spell ID', () => {
    const healer = makeUnit('h', { name: 'Healer', spec: CombatUnitSpec.Evoker_Preservation });
    (healer as any).id = 'h';
    const target = makeUnit('t', { name: 'Target', spec: CombatUnitSpec.Warrior_Arms });
    (target as any).id = 't';

    // Evoker uses Cauterizing Flame (374251, 60s CD) at MATCH_START + 5s
    const firstCleanse = makeExtraAction(MATCH_START + 5_000, LogEvent.SPELL_DISPEL, {
      spellId: '374251',
      extraSpellId: '118',
      destUnitId: 't',
      destUnitName: 'Target',
      srcUnitId: 'h',
    });
    (healer as any).actionOut = [firstCleanse];

    // CC applied at 10s (within 60s window)
    const ccApply = makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '118', MATCH_START + 10_000, 'e1', 't');
    const ccRemove = makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, '118', MATCH_START + 20_000, 'e1', 't');
    (target as any).auraEvents = [ccApply, ccRemove];

    const enemy = makeUnit('e1', { reaction: CombatUnitReaction.Hostile });

    const res = reconstructDispelSummary([healer, target] as any, [enemy] as any, makeCombat());
    expect(res.missedCleanseWindows).toHaveLength(1);
    // Should be on cooldown because 60s window covers 10s
    expect(res.missedCleanseWindows[0].cleanseWasOnCD).toBe(true);

    // CC applied at 70s (outside 60s window)
    const ccApplyLate = makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '118', MATCH_START + 70_000, 'e1', 't');
    const ccRemoveLate = makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, '118', MATCH_START + 80_000, 'e1', 't');
    (target as any).auraEvents = [ccApplyLate, ccRemoveLate];

    const resLate = reconstructDispelSummary([healer, target] as any, [enemy] as any, makeCombat());
    // Should NOT be on cooldown because 60s window has expired
    expect(resLate.missedCleanseWindows[0].cleanseWasOnCD).toBe(false);
  });

  it('skips missed cleanse if all dispellers were blocked (B97)', () => {
    const healer = makeUnit('h', { name: 'Healer', spec: CombatUnitSpec.Priest_Holy });
    const target = makeUnit('t', { name: 'Target', spec: CombatUnitSpec.Warrior_Arms });
    const enemy = makeUnit('e1', { reaction: CombatUnitReaction.Hostile });

    const ccApply = makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '118', MATCH_START + 10_000, 'e1', 't');
    const ccRemove = makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, '118', MATCH_START + 20_000, 'e1', 't');
    (target as any).auraEvents = [ccApply, ccRemove];

    // Healer is also CC'd for the same duration
    (healer as any).auraEvents = [
      makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '118', MATCH_START + 10_000, 'e1', 'h'),
      makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, '118', MATCH_START + 20_000, 'e1', 'h'),
    ];

    const res = reconstructDispelSummary([healer, target] as any, [enemy] as any, makeCombat());
    expect(res.ccEfficiency[1].missedCount).toBe(0);
  });

  it('detects a fatal dispel when the dispeller dies within 4s of dispel', () => {
    const healer = makeUnit('h', { name: 'Healer', spec: CombatUnitSpec.Priest_Holy });
    (healer as any).id = 'h';
    const target = makeUnit('t', { name: 'Target', spec: CombatUnitSpec.Warrior_Arms });
    (target as any).id = 't';

    const action = makeExtraAction(MATCH_START + 10_000, LogEvent.SPELL_DISPEL, {
      extraSpellId: '316099', // UA - has dispel penalty
      destUnitId: 't',
      destUnitName: 'Target',
      srcUnitId: 'h',
    });
    (healer as any).actionOut = [action];

    // Mock death of the healer at MATCH_START + 12_000 (2s after dispel)
    (healer as any).deathRecords = [{ timestamp: MATCH_START + 12_000 }];

    const enemy = makeUnit('e1', { reaction: CombatUnitReaction.Hostile });

    const res = reconstructDispelSummary([healer, target] as any, [enemy] as any, makeCombat());
    expect(res.allyCleanse).toHaveLength(1);
    expect(res.allyCleanse[0].wasFatal).toBe(true);
    expect(res.allyCleanse[0].fatalUnitName).toBe('Healer');
    expect(res.allyCleanse[0].fatalUnitSpec).toBe('Holy Priest');
  });

  it('F124: detects backlash CC on the dispeller within 100ms', () => {
    const healer = makeUnit('h', { name: 'Healer', spec: CombatUnitSpec.Priest_Holy });
    (healer as any).id = 'h';
    const target = makeUnit('t', { name: 'Target', spec: CombatUnitSpec.Warrior_Arms });
    (target as any).id = 't';

    const action = makeExtraAction(MATCH_START + 10_000, LogEvent.SPELL_DISPEL, {
      extraSpellId: '316099', // UA - has dispel penalty
      destUnitId: 't',
      destUnitName: 'Target',
      srcUnitId: 'h',
    });
    (healer as any).actionOut = [action];

    // Mock Silence (196363) applied to the healer within 100ms (at MATCH_START + 10_050)
    (healer as any).auraEvents = [
      makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '196363', MATCH_START + 10_050, 'enemy', 'h'),
    ];

    const enemy = makeUnit('e1', { reaction: CombatUnitReaction.Hostile });

    const res = reconstructDispelSummary([healer, target] as any, [enemy] as any, makeCombat());
    expect(res.allyCleanse).toHaveLength(1);
    expect(res.allyCleanse[0].backlashCcSpellId).toBe('196363');
  });

  it('detects missed purge and identifies if all eligible purgers were on CD (B108)', () => {
    const purger = makeUnit('dh1', { name: 'DH', spec: CombatUnitSpec.DemonHunter_Havoc });
    (purger as any).id = 'dh1';
    const enemy = makeUnit('e1', {
      name: 'Enemy',
      spec: CombatUnitSpec.Mage_Frost,
      reaction: CombatUnitReaction.Hostile,
    });
    (enemy as any).id = 'e1';

    // DH uses purge at 5s
    const firstPurge = makeExtraAction(MATCH_START + 5_000, LogEvent.SPELL_DISPEL, {
      srcUnitId: 'dh1',
      destUnitId: 'e1',
      extraSpellId: '1022', // BOP - Critical priority
      extraSpellName: 'Blessing of Protection',
    });
    (purger as any).actionOut = [firstPurge];

    // BOP applied at 10s (DH purge on CD for 8s until 13s)
    const buffApply = makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '1022', MATCH_START + 10_000, 'e1', 'e1', 'BUFF');
    const buffRemove = makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, '1022', MATCH_START + 20_000, 'e1', 'e1', 'BUFF');
    (enemy as any).auraEvents = [buffApply, buffRemove];

    const res = reconstructDispelSummary([purger] as any, [enemy] as any, makeCombat());
    expect(res.missedPurgeWindows).toHaveLength(1);
    expect(res.missedPurgeWindows[0].purgeWasOnCD).toBe(true);
    expect(res.missedPurgeWindows[0].cdBurnedOn?.spellName).toBe('Blessing of Protection');
  });
});

describe('dispelAnalysis — formatting', () => {
  it('formatDispelContextForAI produces detailed text', () => {
    const summary: any = {
      missedCleanseWindows: [
        {
          priority: 'Critical',
          spellName: 'Fear',
          targetSpec: 'Arms Warrior',
          timeSeconds: 10,
          durationSeconds: 6,
          postCcDamage: 150_000,
        },
      ],
      ccEfficiency: [
        {
          targetName: 'T1',
          targetSpec: 'Arms Warrior',
          totalCCWindows: 1,
          missedCount: 1,
          cleanseCount: 0,
          brokenCount: 0,
        },
      ],
      missedPurgeWindows: [
        {
          priority: 'High',
          spellName: 'Combustion',
          enemySpec: 'Fire Mage',
          durationSeconds: 10,
          teamUnderPressure: true,
        },
      ],
    };

    const lines = formatDispelContextForAI(summary);
    expect(lines.join('\n')).toContain('DISPEL SUMMARY:');
    expect(lines.join('\n')).toContain('CC windows on your team: 1 total — 1 missed');
    expect(lines.join('\n')).toContain('Worst missed cleanse: Fear [Critical] on Arms Warrior');
  });

  it('formatDispelContextForAI handles no CC state', () => {
    const summary: any = {
      missedCleanseWindows: [],
      ccEfficiency: [],
      missedPurgeWindows: [],
    };
    const lines = formatDispelContextForAI(summary);
    expect(lines).toContain('  No significant CC applied to your team.');
    expect(lines).toContain('  Missed purge windows: None (Critical/High)');
  });
});

describe('wasRemovedByAllyDispel', () => {
  it('matches the dispel/removal pair within a 50ms tolerance, tolerating 1ms log skew (B11)', () => {
    const allyCleanse = [
      {
        timeSeconds: 10.2,
        removedSpellId: '118',
        targetName: 'Player1',
      } as any,
    ];
    expect(wasRemovedByAllyDispel(allyCleanse, '118', 'Player1', 10.2)).toBe(true); // exact
    expect(wasRemovedByAllyDispel(allyCleanse, '118', 'Player1', 10.201)).toBe(true); // 1ms log skew — real ~5% of pairs
    expect(wasRemovedByAllyDispel(allyCleanse, '118', 'Player1', 10.24)).toBe(true); // 40ms — within tolerance
    expect(wasRemovedByAllyDispel(allyCleanse, '118', 'Player1', 10.27)).toBe(false); // 70ms — distinct event
    expect(wasRemovedByAllyDispel(allyCleanse, '118', 'Player1', 10.7)).toBe(false); // 500ms — distinct event
    expect(wasRemovedByAllyDispel(allyCleanse, '999', 'Player1', 10.2)).toBe(false); // wrong spell
  });
});

function makeMissedPurge(timeSeconds: number, priority: 'Critical' | 'High' | 'Medium' | 'Low'): IMissedPurgeWindow {
  return {
    timeSeconds,
    durationSeconds: 8,
    enemyName: 'Rsham',
    enemySpec: 'Restoration Shaman',
    spellName: 'Earth Shield',
    spellId: '974',
    priority,
    purgeWasOnCD: false,
    teamUnderPressure: false,
  };
}

describe('annotateMissedPurgesWithKillWindows', () => {
  it('flags misses inside a kill window and leaves others untouched', () => {
    const misses = [makeMissedPurge(45, 'Medium'), makeMissedPurge(80, 'Medium')];
    annotateMissedPurgesWithKillWindows(misses, [{ fromSeconds: 40, toSeconds: 50 }]);
    expect(misses[0].duringKillWindow).toBe(true);
    expect(misses[1].duringKillWindow).toBe(false);
  });

  it('escalates in-window misses in the formatter even at Medium priority', () => {
    const misses = [makeMissedPurge(45, 'Medium')];
    annotateMissedPurgesWithKillWindows(misses, [{ fromSeconds: 40, toSeconds: 50 }]);
    const summary = {
      allyCleanse: [],
      ourPurges: [],
      hostilePurges: [],
      missedCleanseWindows: [],
      ccEfficiency: [],
      missedPurgeWindows: misses,
    };
    const text = formatDispelContextForAI(summary as never).join('\n');
    expect(text).toContain('MISSED PURGE DURING FRIENDLY KILL WINDOW');
    expect(text).toContain('Earth Shield');
  });

  it('surfaces an in-window Medium miss via a dedicated line without displacing a longer Critical worst pick', () => {
    const criticalMiss: IMissedPurgeWindow = {
      ...makeMissedPurge(10, 'Critical'),
      durationSeconds: 20,
      spellName: 'Ice Block',
      enemySpec: 'Frost Mage',
      enemyName: 'Fmage',
      duringKillWindow: false,
    };
    const mediumInWindowMiss: IMissedPurgeWindow = {
      ...makeMissedPurge(45, 'Medium'),
      durationSeconds: 5,
      spellName: 'Earth Shield',
    };
    annotateMissedPurgesWithKillWindows([mediumInWindowMiss], [{ fromSeconds: 40, toSeconds: 50 }]);
    expect(mediumInWindowMiss.duringKillWindow).toBe(true);

    const summary = {
      allyCleanse: [],
      ourPurges: [],
      hostilePurges: [],
      missedCleanseWindows: [],
      ccEfficiency: [],
      missedPurgeWindows: [criticalMiss, mediumInWindowMiss],
    };
    const text = formatDispelContextForAI(summary as never).join('\n');

    // Worst line stays on the Critical (longer, non-window) miss — unchanged from pre-existing behavior.
    expect(text).toContain('Missed purge windows: 1 — worst: Ice Block on Frost Mage');
    expect(text).not.toContain('worst: Earth Shield');

    // The in-window Medium miss is still always surfaced via its own dedicated line.
    expect(text).toContain('MISSED PURGE DURING FRIENDLY KILL WINDOW: Earth Shield on Restoration Shaman (Rsham)');
  });

  it('renders no kill-window line when no missed purge carries the duringKillWindow annotation', () => {
    const misses = [makeMissedPurge(10, 'Critical'), makeMissedPurge(20, 'High')];
    // duringKillWindow deliberately left undefined (annotateMissedPurgesWithKillWindows never ran).
    const summary = {
      allyCleanse: [],
      ourPurges: [],
      hostilePurges: [],
      missedCleanseWindows: [],
      ccEfficiency: [],
      missedPurgeWindows: misses,
    };
    const text = formatDispelContextForAI(summary as never).join('\n');
    expect(text).not.toContain('MISSED PURGE DURING FRIENDLY KILL WINDOW');
  });
});
