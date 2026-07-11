/* eslint-disable @typescript-eslint/no-explicit-any */
import { CombatUnitClass, CombatUnitReaction, CombatUnitSpec, LogEvent } from '@gladlog/parser-compat';

import { analyzePlayerCCAndTrinket, detectTrinketType } from '../../src/utils/ccTrinketAnalysis';
import { makeAdvancedAction, makeAuraEvent, makeInterruptEvent, makeSpellCastEvent, makeUnit } from './testHelpers';

// Mock the generated JSON so tests never depend on real item IDs.
vi.mock('../../src/data/trinketItemIds.json', () => ({
  // vitest ESM JSON mock 需 default 包裹(jest 直接返回对象)
  default: {
    adaptationItemIds: ['TEST_ADAPT_1', '181816'],
    relentlessItemIds: ['TEST_RELENTLESS_1', '181335'],
  },
}));

// Builds an ICombatUnit with specific item IDs at trinket slots (indices 12 and 13).
function unitWithTrinket(slot12Id: string | null, slot13Id: string | null = null) {
  const equipment: any[] = [];
  if (slot12Id) equipment[12] = { id: slot12Id, ilvl: 450, enchants: [], bonuses: [], gems: [] };
  if (slot13Id) equipment[13] = { id: slot13Id, ilvl: 450, enchants: [], bonuses: [], gems: [] };
  return makeUnit('p1', {
    spec: CombatUnitSpec.Paladin_Holy,
    info: { equipment } as any,
  });
}

describe('detectTrinketType', () => {
  it('returns Adaptation when slot 12 matches an Adaptation item ID', () => {
    expect(detectTrinketType(unitWithTrinket('TEST_ADAPT_1'))).toBe('Adaptation');
  });

  it('returns Adaptation for legacy ID 181816 still present in JSON', () => {
    expect(detectTrinketType(unitWithTrinket('181816'))).toBe('Adaptation');
  });

  it('returns Relentless when slot 12 matches a Relentless item ID', () => {
    expect(detectTrinketType(unitWithTrinket('TEST_RELENTLESS_1'))).toBe('Relentless');
  });

  it('returns Relentless for legacy ID 181335 still present in JSON', () => {
    expect(detectTrinketType(unitWithTrinket('181335'))).toBe('Relentless');
  });

  it('returns Gladiator when equipment is present but ID is not in either set', () => {
    expect(detectTrinketType(unitWithTrinket('99999'))).toBe('Gladiator');
  });

  it('returns Unknown when unit has no equipment info', () => {
    const unit = makeUnit('p1', { spec: CombatUnitSpec.Paladin_Holy, info: undefined });
    expect(detectTrinketType(unit)).toBe('Unknown');
  });

  it('returns Unknown when equipment array is empty', () => {
    const unit = makeUnit('p1', {
      spec: CombatUnitSpec.Paladin_Holy,
      info: { equipment: [] } as any,
    });
    expect(detectTrinketType(unit)).toBe('Unknown');
  });

  it('checks slot 13 as well as slot 12', () => {
    expect(detectTrinketType(unitWithTrinket(null, 'TEST_ADAPT_1'))).toBe('Adaptation');
  });

  it('Relentless check takes precedence over Adaptation (first match wins)', () => {
    // Relentless check runs first in detectTrinketType
    expect(detectTrinketType(unitWithTrinket('TEST_RELENTLESS_1', 'TEST_ADAPT_1'))).toBe('Relentless');
  });
});

describe('analyzePlayerCCAndTrinket — root/disarm/interrupt tracking', () => {
  const MATCH_START = 1_000_000;
  const MATCH_END = 1_300_000;

  function makeCombat() {
    return { startTime: MATCH_START, endTime: MATCH_END, startInfo: { zoneId: '1672' } };
  }

  function makeEnemy(id: string, name: string) {
    return makeUnit(id, {
      name,
      reaction: CombatUnitReaction.Hostile,
      spec: CombatUnitSpec.Rogue_Subtlety,
    });
  }

  it('tracks a root applied by an enemy', () => {
    // Entangling Roots = spellId '339'
    const apply = makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '339', MATCH_START + 5_000, 'enemy-1', 'player-1');
    const removed = makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, '339', MATCH_START + 8_000, 'enemy-1', 'player-1');
    const player = makeUnit('player-1', { auraEvents: [apply, removed] });
    const enemy = makeEnemy('enemy-1', 'EnemyA');

    const result = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());

    expect(result.rootInstances).toHaveLength(1);
    expect(result.rootInstances[0].spellId).toBe('339');
    expect(result.rootInstances[0].durationSeconds).toBeCloseTo(3);
    expect(result.rootInstances[0].atSeconds).toBeCloseTo(5);
  });

  it('does not track roots from friendly sources', () => {
    const apply = makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '339', MATCH_START + 5_000, 'friend-1', 'player-1');
    const player = makeUnit('player-1', { auraEvents: [apply] });
    const enemy = makeEnemy('enemy-1', 'EnemyA');

    const result = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());

    expect(result.rootInstances).toHaveLength(0);
  });

  it('tracks a disarm applied by an enemy', () => {
    // Disarm (Warrior) = spellId '236077'
    const apply = makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '236077', MATCH_START + 10_000, 'enemy-1', 'player-1');
    const removed = makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, '236077', MATCH_START + 15_000, 'enemy-1', 'player-1');
    const player = makeUnit('player-1', { auraEvents: [apply, removed] });
    const enemy = makeEnemy('enemy-1', 'EnemyA');

    const result = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());

    expect(result.disarmInstances).toHaveLength(1);
    expect(result.disarmInstances[0].spellId).toBe('236077');
    expect(result.disarmInstances[0].durationSeconds).toBeCloseTo(5);
  });

  it('tracks a kick from an enemy (SPELL_INTERRUPT)', () => {
    // Kick (Rogue) = extraSpellId '1766', lockout 5s; interrupted = Frost Bolt
    const kick = makeInterruptEvent('1766', 'Kick', '116', 'Frostbolt', MATCH_START + 20_000, 'enemy-1', 'EnemyA');
    const player = makeUnit('player-1', { actionIn: [kick] });
    const enemy = makeEnemy('enemy-1', 'EnemyA');

    const result = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());

    expect(result.interruptInstances).toHaveLength(1);
    expect(result.interruptInstances[0].kickSpellId).toBe('1766');
    expect(result.interruptInstances[0].kickSpellName).toBe('Kick');
    expect(result.interruptInstances[0].interruptedSpellName).toBe('Frostbolt');
    expect(result.interruptInstances[0].lockoutDurationSeconds).toBe(3);
    expect(result.interruptInstances[0].atSeconds).toBeCloseTo(20);
  });

  it('uses a 3s default lockout for unknown interrupt spells', () => {
    // Unknown spell ID '99999999' — not in spells.json
    const kick = makeInterruptEvent('99999999', 'UnknownKick', '116', 'Frostbolt', MATCH_START + 5_000);
    const player = makeUnit('player-1', { actionIn: [kick] });
    const enemy = makeEnemy('enemy-1', 'EnemyA');

    const result = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());

    expect(result.interruptInstances[0].lockoutDurationSeconds).toBe(3);
  });

  it('does not track kicks from friendly sources', () => {
    const kick = makeInterruptEvent('1766', 'Kick', '116', 'Frostbolt', MATCH_START + 5_000, 'friend-1', 'Friend');
    const player = makeUnit('player-1', { actionIn: [kick] });
    const enemy = makeEnemy('enemy-1', 'EnemyA');

    const result = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());

    expect(result.interruptInstances).toHaveLength(0);
  });
});

describe('analyzePlayerCCAndTrinket — trinketCDSecondsLeft', () => {
  const MATCH_START = 1_000_000;
  const MATCH_END = 1_300_000;

  // CC spell that is tracked: Hammer of Justice (853) is in ccSpellIds
  const HOJ_SPELL_ID = '853';

  function makeCombat() {
    return { startTime: MATCH_START, endTime: MATCH_END, startInfo: { zoneId: '1672' } };
  }

  function makeEnemy(id: string) {
    return makeUnit(id, {
      name: 'Enemy',
      reaction: CombatUnitReaction.Hostile,
      spec: CombatUnitSpec.Paladin_Retribution,
    });
  }

  it('sets trinketCDSecondsLeft when trinket is on cooldown', () => {
    // Gladiator Medallion (spell 336126) cast at T+10s. CD is 90s (healer).
    // CC lands at T+40s → trinket has been on CD for 30s → 60s left.
    const trinketCast = {
      logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: MATCH_START + 10_000, parameters: [] },
      spellId: '336126',
      spellName: "Gladiator's Medallion",
      srcUnitId: 'player-1',
      srcUnitName: 'Player',
      destUnitId: 'player-1',
      destUnitName: 'Player',
      effectiveAmount: 0,
      advancedActorMaxHp: 0,
      advancedActorCurrentHp: 0,
      advancedActorPositionX: 0,
      advancedActorPositionY: 0,
    };
    const ccApply = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      HOJ_SPELL_ID,
      MATCH_START + 40_000,
      'enemy-1',
      'player-1',
    );
    const ccRemove = makeAuraEvent(
      LogEvent.SPELL_AURA_REMOVED,
      HOJ_SPELL_ID,
      MATCH_START + 44_000,
      'enemy-1',
      'player-1',
    );

    const player = makeUnit('player-1', {
      spec: CombatUnitSpec.Paladin_Holy, // healer → 90s CD
      info: { equipment: [{ id: '99999', ilvl: 450, enchants: [], bonuses: [], gems: [] }] } as any,
      spellCastEvents: [trinketCast] as any,
      auraEvents: [ccApply, ccRemove],
    });
    const enemy = makeEnemy('enemy-1');

    const result = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());

    expect(result.ccInstances).toHaveLength(1);
    expect(result.ccInstances[0].trinketState).toBe('on_cooldown');
    expect(result.ccInstances[0].trinketCDSecondsLeft).toBe(60);
  });

  it('does not set trinketCDSecondsLeft when trinket is available_unused', () => {
    // No prior trinket cast → available
    const ccApply = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      HOJ_SPELL_ID,
      MATCH_START + 40_000,
      'enemy-1',
      'player-1',
    );
    const ccRemove = makeAuraEvent(
      LogEvent.SPELL_AURA_REMOVED,
      HOJ_SPELL_ID,
      MATCH_START + 44_000,
      'enemy-1',
      'player-1',
    );

    const player = makeUnit('player-1', {
      spec: CombatUnitSpec.Paladin_Holy,
      info: { equipment: [{ id: '99999', ilvl: 450, enchants: [], bonuses: [], gems: [] }] } as any,
      spellCastEvents: [],
      auraEvents: [ccApply, ccRemove],
    });
    const enemy = makeEnemy('enemy-1');

    const result = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());

    expect(result.ccInstances[0].trinketState).toBe('available_unused');
    expect(result.ccInstances[0].trinketCDSecondsLeft).toBeUndefined();
  });
});

describe('analyzePlayerCCAndTrinket — edge cases and corner branches', () => {
  const MATCH_START = 1_000_000;
  const MATCH_END = 1_300_000;

  function makeCombat() {
    return { startTime: MATCH_START, endTime: MATCH_END, startInfo: { zoneId: '1672' } };
  }

  function makeEnemy(id: string) {
    return makeUnit(id, {
      name: 'Enemy',
      reaction: CombatUnitReaction.Hostile,
      spec: CombatUnitSpec.Paladin_Retribution,
    });
  }

  it('closes CCs still pending at match end', () => {
    // HoJ (853) applied at T+10s, never removed
    const ccApply = makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '853', MATCH_START + 10_000, 'enemy-1', 'player-1');
    const player = makeUnit('player-1', { auraEvents: [ccApply] });
    const result = analyzePlayerCCAndTrinket(player, [makeEnemy('enemy-1')], makeCombat());

    expect(result.ccInstances).toHaveLength(1);
    expect(result.ccInstances[0].durationSeconds).toBe(290); // (1,300,000 - 1,010,000) / 1000
  });

  it('tracks roots/disarms broken by damage or spell', () => {
    const rootApply = makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '339', MATCH_START + 5_000, 'enemy-1', 'player-1');
    const rootBroken = makeAuraEvent(LogEvent.SPELL_AURA_BROKEN, '339', MATCH_START + 7_000, 'enemy-1', 'player-1');
    const disarmApply = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      '236077',
      MATCH_START + 10_000,
      'enemy-1',
      'player-1',
    );
    const disarmBrokenSpell = makeAuraEvent(
      LogEvent.SPELL_AURA_BROKEN_SPELL,
      '236077',
      MATCH_START + 12_000,
      'enemy-1',
      'player-1',
    );

    const player = makeUnit('player-1', { auraEvents: [rootApply, rootBroken, disarmApply, disarmBrokenSpell] });
    const result = analyzePlayerCCAndTrinket(player, [makeEnemy('enemy-1')], makeCombat());

    expect(result.rootInstances).toHaveLength(1);
    expect(result.rootInstances[0].durationSeconds).toBe(2);
    expect(result.disarmInstances).toHaveLength(1);
    expect(result.disarmInstances[0].durationSeconds).toBe(2);
  });

  it('flags trinketState="used" when trinket used within response window', () => {
    const ccApply = makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '853', MATCH_START + 10_000, 'enemy-1', 'player-1');
    const trinketCast = {
      logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: MATCH_START + 11_000, parameters: [] },
      spellId: '336126',
      spellName: "Gladiator's Medallion",
      srcUnitId: 'player-1',
    };

    const player = makeUnit('player-1', {
      auraEvents: [ccApply],
      spellCastEvents: [trinketCast] as any,
    });
    const result = analyzePlayerCCAndTrinket(player, [makeEnemy('enemy-1')], makeCombat());

    expect(result.ccInstances[0].trinketState).toBe('used');
  });

  it('suppresses the CC distance annotation when snapshots are sparse (stale positions)', () => {
    // Opener scenario: victim/caster have only two snapshots 120s apart —
    // interpolated positions are fabricated (100-game sweep found 0:06 Sap "64.7yd").
    const ccApply = makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '853', MATCH_START + 60_000, 'enemy-1', 'player-1');
    const ccRemove = makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, '853', MATCH_START + 64_000, 'enemy-1', 'player-1');
    const player = makeUnit('player-1', {
      auraEvents: [ccApply, ccRemove],
      advancedActions: [makeAdvancedAction(MATCH_START, 0, 0), makeAdvancedAction(MATCH_START + 120_000, 0, 0)],
    });
    const enemy = makeEnemy('enemy-1');
    (enemy as any).advancedActions = [
      makeAdvancedAction(MATCH_START, 30, 0),
      makeAdvancedAction(MATCH_START + 120_000, 30, 0),
    ];

    const result = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());

    expect(result.ccInstances).toHaveLength(1);
    expect(result.ccInstances[0].distanceYards).toBeNull();
    expect(result.ccInstances[0].losBlocked).toBeNull();
  });

  it('suppresses the CC distance annotation beyond plausible CC range (>45yd)', () => {
    const denseAt = (x: number) => {
      const actions = [];
      for (let t = 0; t <= 300_000; t += 5_000) actions.push(makeAdvancedAction(MATCH_START + t, x, 0));
      return actions;
    };
    const ccApply = makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '853', MATCH_START + 60_000, 'enemy-1', 'player-1');
    const ccRemove = makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, '853', MATCH_START + 64_000, 'enemy-1', 'player-1');
    const player = makeUnit('player-1', { auraEvents: [ccApply, ccRemove], advancedActions: denseAt(0) });
    const enemy = makeEnemy('enemy-1');
    (enemy as any).advancedActions = denseAt(60);

    const result = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());

    expect(result.ccInstances[0].distanceYards).toBeNull();
    expect(result.ccInstances[0].losBlocked).toBeNull();
  });

  it('keeps the CC distance annotation for dense, plausible positions', () => {
    const denseAt = (x: number) => {
      const actions = [];
      for (let t = 0; t <= 300_000; t += 5_000) actions.push(makeAdvancedAction(MATCH_START + t, x, 0));
      return actions;
    };
    const ccApply = makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '853', MATCH_START + 60_000, 'enemy-1', 'player-1');
    const ccRemove = makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, '853', MATCH_START + 64_000, 'enemy-1', 'player-1');
    const player = makeUnit('player-1', { auraEvents: [ccApply, ccRemove], advancedActions: denseAt(0) });
    const enemy = makeEnemy('enemy-1');
    (enemy as any).advancedActions = denseAt(5);

    const result = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());

    expect(result.ccInstances[0].distanceYards).toBe(5);
  });

  it('correctly calculates missedTrinketWindows based on damage threshold', () => {
    const cc1 = makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '853', MATCH_START + 10_000, 'enemy-1', 'player-1');
    const cc1Rem = makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, '853', MATCH_START + 15_000, 'enemy-1', 'player-1');
    const dmg1 = {
      srcUnitId: 'enemy-1',
      effectiveAmount: -20_000, // Below 30k threshold
      logLine: { timestamp: MATCH_START + 12_000 },
    };

    const cc2 = makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '853', MATCH_START + 30_000, 'enemy-1', 'player-1');
    const cc2Rem = makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, '853', MATCH_START + 35_000, 'enemy-1', 'player-1');
    const dmg2 = {
      srcUnitId: 'enemy-1',
      effectiveAmount: -40_000, // Above 30k threshold
      logLine: { timestamp: MATCH_START + 32_000 },
    };

    const player = makeUnit('player-1', {
      auraEvents: [cc1, cc1Rem, cc2, cc2Rem],
      damageIn: [dmg1, dmg2] as any,
    });
    const result = analyzePlayerCCAndTrinket(player, [makeEnemy('enemy-1')], makeCombat());

    expect(result.missedTrinketWindows).toHaveLength(1);
    expect(result.missedTrinketWindows[0].atSeconds).toBe(30);
  });
});

import { formatCCTrinketForContext } from '../../src/utils/ccTrinketAnalysis';

describe('formatCCTrinketForContext', () => {
  const summaryBase: any = {
    playerName: 'PlayerA',
    playerSpec: 'Frost Mage',
    trinketType: 'Gladiator',
    ccInstances: [],
    trinketUseTimes: [],
    missedTrinketWindows: [],
  };

  it('returns empty message when no CC detected', () => {
    const res = formatCCTrinketForContext([summaryBase]);
    expect(res).toContain('  No hard CC events detected on your team.');
  });

  it('formats multiple CCs and trinket usage correctly', () => {
    const summary: any = {
      ...summaryBase,
      ccInstances: [
        { atSeconds: 10, spellName: 'Polymorph', drInfo: { level: 'Full' }, distanceYards: 30 },
        { atSeconds: 50, spellName: 'Polymorph', drInfo: { level: 'Half' }, distanceYards: 5 },
        { atSeconds: 90, spellName: 'Kidney Shot', drInfo: { level: 'Full' }, distanceYards: 2 },
      ],
      trinketUseTimes: [10, 150], // 10s is during a CC window (±5s), 150s is off-CC
      missedTrinketWindows: [{ damageTakenDuring: 50000 }],
    };

    const res = formatCCTrinketForContext([summary]);
    const line = res[1];

    expect(line).toContain('Frost Mage (PlayerA): 3 CC');
    expect(line).toContain('2× Polymorph, 1× Kidney Shot');
    expect(line).toContain('Gladiator trinket used off-CC at 2:30'); // 150s = 2:30
    expect(line).toContain('1 reduced/immune DR');
    expect(line).toContain('2 at melee range');
    expect(line).toContain('⚠ 1 missed trinket window(s) (50k dmg total)');
  });

  it('handles Relentless and Unknown trinket types', () => {
    const s1 = { ...summaryBase, trinketType: 'Relentless', ccInstances: [{ spellName: 'Fear' }] };
    const s2 = { ...summaryBase, trinketType: 'Unknown', ccInstances: [{ spellName: 'Fear' }] };

    const res = formatCCTrinketForContext([s1, s2]);
    expect(res[1]).toContain('| Relentless');
    expect(res[2]).toContain('| Unknown');
  });

  it('lists each missed trinket window with time, damage, and position when available', () => {
    const missedWithPos: any = {
      atSeconds: 30,
      spellName: 'Kidney Shot',
      durationSeconds: 5,
      damageTakenDuring: 180_000,
      drInfo: { level: 'Full' },
      distanceYards: 6.2,
      losBlocked: false,
    };
    const missedNoPos: any = {
      atSeconds: 75,
      spellName: 'Polymorph',
      durationSeconds: 6,
      damageTakenDuring: 50_000,
      drInfo: { level: 'Full' },
      distanceYards: null,
      losBlocked: null,
    };
    const summary: any = {
      ...summaryBase,
      ccInstances: [missedWithPos, missedNoPos],
      missedTrinketWindows: [missedWithPos, missedNoPos],
    };

    const res = formatCCTrinketForContext([summary]).join('\n');

    expect(res).toContain('0:30 Kidney Shot (5s, 180k dmg) — 6.2yd from caster');
    expect(res).toContain('1:15 Polymorph (6s, 50k dmg)');
    // No position annotation when advanced logging did not supply coordinates
    expect(res).not.toContain('1:15 Polymorph (6s, 50k dmg) —');
  });
});

describe('analyzePlayerCCAndTrinket — further branches', () => {
  const MATCH_START = 1_000_000;
  const MATCH_END = 1_300_000;

  it('handles Adaptation trinket (B35)', () => {
    const equipment: any[] = [];
    equipment[12] = { id: 'TEST_ADAPT_1' };
    const player = makeUnit('p1', {
      spec: CombatUnitSpec.Warrior_Arms,
      info: { equipment } as any,
      spellCastEvents: [
        {
          logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: MATCH_START + 6100 },
          spellId: '195756', // Adaptation
          spellName: 'Adaptation',
          srcUnitId: 'p1',
        },
      ] as any,
      auraEvents: [makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '853', MATCH_START + 6000, 'e1', 'p1')],
    });
    const enemy = makeUnit('e1', { reaction: CombatUnitReaction.Hostile });
    const result = analyzePlayerCCAndTrinket(player, [enemy], {
      startTime: MATCH_START,
      endTime: MATCH_END,
      startInfo: { zoneId: '1672' },
    });

    expect(result.trinketType).toBe('Adaptation');
    expect(result.ccInstances[0].trinketState).toBe('used');
  });

  it('handles null LoS correctly (B36)', () => {
    const player = makeUnit('p1', {
      advancedActions: [{ timestamp: MATCH_START + 5000, advancedActorPositionX: 0, advancedActorPositionY: 0 }] as any,
      auraEvents: [makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '853', MATCH_START + 5000, 'e1', 'p1')],
    });
    const enemy = makeUnit('e1', {
      reaction: CombatUnitReaction.Hostile,
      advancedActions: [
        { timestamp: MATCH_START + 5000, advancedActorPositionX: 10, advancedActorPositionY: 0 },
      ] as any,
    });
    // zoneId '999' is not in arenaGeometry, so hasLineOfSight returns null
    const result = analyzePlayerCCAndTrinket(player, [enemy], {
      startTime: MATCH_START,
      endTime: MATCH_END,
      startInfo: { zoneId: '999' },
    });
    expect(result.ccInstances[0].losBlocked).toBeNull();
  });
});

describe('analyzePlayerCCAndTrinket — CC Avoidance', () => {
  const MATCH_START = 1_000_000;
  const MATCH_END = 1_300_000;

  function makeCombat() {
    return { startTime: MATCH_START, endTime: MATCH_END, startInfo: { zoneId: '1672' } };
  }

  function makeEnemy(id: string, name: string) {
    return makeUnit(id, {
      name,
      reaction: CombatUnitReaction.Hostile,
      spec: CombatUnitSpec.Rogue_Subtlety,
    });
  }

  it('tracks buff-based CC avoidance (Precognition buff active)', () => {
    // Player has Precognition buff ('377362') active from T+5s to T+15s
    const precogApply = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      '377362',
      MATCH_START + 5_000,
      'player-1',
      'player-1',
      'BUFF',
    );
    const precogRemove = makeAuraEvent(
      LogEvent.SPELL_AURA_REMOVED,
      '377362',
      MATCH_START + 15_000,
      'player-1',
      'player-1',
      'BUFF',
    );

    // Enemy casts Polymorph ('118') targeting player at T+10s
    const enemyCast = makeSpellCastEvent('118', MATCH_START + 10_000, 'player-1', 'Player', 'enemy-1', 'EnemyA');

    const player = makeUnit('player-1', {
      class: CombatUnitClass.Mage,
      spec: CombatUnitSpec.Mage_Frost,
      auraEvents: [precogApply, precogRemove],
    });
    const enemy = makeEnemy('enemy-1', 'EnemyA');
    enemy.spellCastEvents = [enemyCast as any];

    const result = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());

    expect(result.ccAvoidedInstances).toHaveLength(1);
    expect(result.ccAvoidedInstances[0].spellId).toBe('118');
    expect(result.ccAvoidedInstances[0].avoidanceSpellName).toBe('Precognition');
    expect(result.ccAvoidedInstances[0].avoidanceSpellId).toBe('377362');
  });

  it('credits Phase Shift (408558) as CC avoidance — the talented-Fade phase-out window (B139-P0)', () => {
    // Priest has the Phase Shift untargetable buff ('408558') active T+5s..T+6s (~1s window).
    const phaseApply = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      '408558',
      MATCH_START + 5_000,
      'player-1',
      'player-1',
      'BUFF',
    );
    const phaseRemove = makeAuraEvent(
      LogEvent.SPELL_AURA_REMOVED,
      '408558',
      MATCH_START + 6_000,
      'player-1',
      'player-1',
      'BUFF',
    );
    // Enemy casts Polymorph ('118') at the priest at T+5.5s — inside the phase-out window.
    const enemyCast = makeSpellCastEvent('118', MATCH_START + 5_500, 'player-1', 'Player', 'enemy-1', 'EnemyA');

    const player = makeUnit('player-1', {
      class: CombatUnitClass.Priest,
      spec: CombatUnitSpec.Priest_Discipline,
      auraEvents: [phaseApply, phaseRemove],
    });
    const enemy = makeEnemy('enemy-1', 'EnemyA');
    enemy.spellCastEvents = [enemyCast as any];

    const result = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());

    expect(result.ccAvoidedInstances).toHaveLength(1);
    expect(result.ccAvoidedInstances[0].avoidanceSpellName).toBe('Phase Shift');
    expect(result.ccAvoidedInstances[0].avoidanceSpellId).toBe('408558');
  });

  it('credits Peaceweaver (353319) as CC avoidance — Revival magic-immunity window (B139 catalog)', () => {
    // Mistweaver has the Peaceweaver magic-immunity buff ('353319') active T+5s..T+7s (~2s window).
    const pwApply = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      '353319',
      MATCH_START + 5_000,
      'player-1',
      'player-1',
      'BUFF',
    );
    const pwRemove = makeAuraEvent(
      LogEvent.SPELL_AURA_REMOVED,
      '353319',
      MATCH_START + 7_000,
      'player-1',
      'player-1',
      'BUFF',
    );
    // Enemy casts Polymorph ('118') at the monk at T+6s — inside the immunity window.
    const enemyCast = makeSpellCastEvent('118', MATCH_START + 6_000, 'player-1', 'Player', 'enemy-1', 'EnemyA');

    const player = makeUnit('player-1', {
      class: CombatUnitClass.Monk,
      spec: CombatUnitSpec.Monk_Mistweaver,
      auraEvents: [pwApply, pwRemove],
    });
    const enemy = makeEnemy('enemy-1', 'EnemyA');
    enemy.spellCastEvents = [enemyCast as any];

    const result = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());

    expect(result.ccAvoidedInstances).toHaveLength(1);
    expect(result.ccAvoidedInstances[0].avoidanceSpellName).toBe('Peaceweaver');
    expect(result.ccAvoidedInstances[0].avoidanceSpellId).toBe('353319');
  });

  it('does NOT credit Fade as CC avoidance (Fade only drops threat, grants no CC immunity)', () => {
    // Player has Fade ('586') active T+5s..T+15s
    const fadeApply = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      '586',
      MATCH_START + 5_000,
      'player-1',
      'player-1',
      'BUFF',
    );
    const fadeRemove = makeAuraEvent(
      LogEvent.SPELL_AURA_REMOVED,
      '586',
      MATCH_START + 15_000,
      'player-1',
      'player-1',
      'BUFF',
    );

    // Enemy casts Polymorph ('118') at the player at T+10s; it whiffs (no resulting CC aura).
    const enemyCast = makeSpellCastEvent('118', MATCH_START + 10_000, 'player-1', 'Player', 'enemy-1', 'EnemyA');

    const player = makeUnit('player-1', {
      class: CombatUnitClass.Priest,
      spec: CombatUnitSpec.Priest_Discipline,
      auraEvents: [fadeApply, fadeRemove],
    });
    const enemy = makeEnemy('enemy-1', 'EnemyA');
    enemy.spellCastEvents = [enemyCast as any];

    const result = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());

    expect(result.ccAvoidedInstances).toHaveLength(0);
  });

  it('tracks grounding totem redirects for Shamans', () => {
    // Enemy casts Polymorph ('118') targeting "Grounding Totem" at T+12s
    const enemyCast = makeSpellCastEvent(
      '118',
      MATCH_START + 12_000,
      'grounding-totem-id',
      'Grounding Totem',
      'enemy-1',
      'EnemyA',
    );

    const player = makeUnit('player-1', {
      class: CombatUnitClass.Shaman,
      spec: CombatUnitSpec.Shaman_Restoration,
    });
    const enemy = makeEnemy('enemy-1', 'EnemyA');
    enemy.spellCastEvents = [enemyCast as any];

    const result = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());

    expect(result.ccAvoidedInstances).toHaveLength(1);
    expect(result.ccAvoidedInstances[0].spellId).toBe('118');
    expect(result.ccAvoidedInstances[0].avoidanceSpellName).toBe('Grounding Totem');
    expect(result.ccAvoidedInstances[0].avoidanceSpellId).toBe('8177');
  });

  it('tracks SW:D self-damage breaks for Priests', () => {
    // CC (Polymorph '118') is applied to Priest at T+10s and removed at T+10.5s (duration <= 1.0)
    const ccApply = makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '118', MATCH_START + 10_000, 'enemy-1', 'player-1');
    const ccRemove = makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, '118', MATCH_START + 10_500, 'enemy-1', 'player-1');

    // Priest cast SW:D ('32379') at T+9.8s (within 500ms before CC application)
    const swdCast = makeSpellCastEvent('32379', MATCH_START + 9_800, 'enemy-1', 'EnemyA', 'player-1', 'Player');

    const player = makeUnit('player-1', {
      class: CombatUnitClass.Priest,
      spec: CombatUnitSpec.Priest_Shadow,
      auraEvents: [ccApply, ccRemove],
      spellCastEvents: [swdCast as any],
    });
    const enemy = makeEnemy('enemy-1', 'EnemyA');

    const result = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());

    expect(result.ccAvoidedInstances).toHaveLength(1);
    expect(result.ccAvoidedInstances[0].spellId).toBe('118');
    expect(result.ccAvoidedInstances[0].avoidanceSpellName).toBe('Shadow Word: Death');
    expect(result.ccAvoidedInstances[0].avoidanceSpellId).toBe('32379');
  });

  it('tracks CC avoidance when a buff is refreshed or initial APPLIED is missing', () => {
    // Buff refreshed at T+5s (missing initial SPELL_AURA_APPLIED)
    const precogRefresh = makeAuraEvent(
      LogEvent.SPELL_AURA_REFRESH,
      '377362',
      MATCH_START + 5_000,
      'player-1',
      'player-1',
      'BUFF',
    );
    const precogRemove = makeAuraEvent(
      LogEvent.SPELL_AURA_REMOVED,
      '377362',
      MATCH_START + 15_000,
      'player-1',
      'player-1',
      'BUFF',
    );

    const enemyCast = makeSpellCastEvent('118', MATCH_START + 10_000, 'player-1', 'Player', 'enemy-1', 'EnemyA');

    const player = makeUnit('player-1', {
      class: CombatUnitClass.Mage,
      spec: CombatUnitSpec.Mage_Frost,
      auraEvents: [precogRefresh, precogRemove],
    });
    const enemy = makeEnemy('enemy-1', 'EnemyA');
    enemy.spellCastEvents = [enemyCast as any];

    const result = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());

    expect(result.ccAvoidedInstances).toHaveLength(1);
    expect(result.ccAvoidedInstances[0].spellId).toBe('118');
    expect(result.ccAvoidedInstances[0].avoidanceSpellName).toBe('Precognition');
  });

  it('tracks Shaman Grounding Totem redirect via Creature NPC ID on non-English logs', () => {
    // Enemy casts hex (51514) on the grounding totem NPC (5925)
    const enemyCast = {
      logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: MATCH_START + 10_000 },
      spellId: '51514',
      spellName: 'Hex',
      destUnitId: 'Creature-0-1234-1234-1234-5925-00004C5085',
      destUnitName: '根基图腾', // Localized Chinese name
      srcUnitId: 'enemy-1',
      srcUnitName: 'EnemyA',
    };

    const player = makeUnit('player-1', {
      class: CombatUnitClass.Shaman,
      spec: CombatUnitSpec.Shaman_Restoration,
    });
    const enemy = makeEnemy('enemy-1', 'EnemyA');
    enemy.spellCastEvents = [enemyCast as any];

    const result = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());
    expect(result.ccAvoidedInstances).toHaveLength(1);
    expect(result.ccAvoidedInstances[0].avoidanceSpellName).toBe('Grounding Totem');
  });

  it('tracks Druid shapeshift form Polymorph immunity (applied during match)', () => {
    // Druid in Bear Form (5487) avoids Polymorph (118)
    const bearFormBuff = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      '5487',
      MATCH_START + 2_000,
      'player-1',
      'player-1',
      'BUFF',
    );
    const enemyCast = makeSpellCastEvent('118', MATCH_START + 10_000, 'player-1', 'Player', 'enemy-1', 'EnemyA');

    const player = makeUnit('player-1', {
      class: CombatUnitClass.Druid,
      spec: CombatUnitSpec.Druid_Restoration,
      auraEvents: [bearFormBuff],
    });
    const enemy = makeEnemy('enemy-1', 'EnemyA');
    enemy.spellCastEvents = [enemyCast as any];

    const result = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());
    expect(result.ccAvoidedInstances).toHaveLength(1);
    expect(result.ccAvoidedInstances[0].avoidanceSpellName).toBe('Bear Form');
  });

  it('tracks Druid shapeshift form Polymorph immunity when active at start (via interestingAurasJSON)', () => {
    const enemyCast = makeSpellCastEvent('118', MATCH_START + 10_000, 'player-1', 'Player', 'enemy-1', 'EnemyA');

    const player = makeUnit('player-1', {
      class: CombatUnitClass.Druid,
      spec: CombatUnitSpec.Druid_Restoration,
      info: {
        interestingAurasJSON: JSON.stringify([5487]), // Bear Form active at start
      } as any,
    });
    const enemy = makeEnemy('enemy-1', 'EnemyA');
    enemy.spellCastEvents = [enemyCast as any];

    const result = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());
    expect(result.ccAvoidedInstances).toHaveLength(1);
    expect(result.ccAvoidedInstances[0].avoidanceSpellName).toBe('Bear Form');
  });

  it('does NOT track Druid shapeshift form when targeted by non-Polymorph CCs (like Hammer of Justice)', () => {
    const bearFormBuff = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      '5487',
      MATCH_START + 2_000,
      'player-1',
      'player-1',
      'BUFF',
    );
    const enemyCast = makeSpellCastEvent('853', MATCH_START + 10_000, 'player-1', 'Player', 'enemy-1', 'EnemyA'); // HoJ

    const player = makeUnit('player-1', {
      class: CombatUnitClass.Druid,
      spec: CombatUnitSpec.Druid_Restoration,
      auraEvents: [bearFormBuff],
    });
    const enemy = makeEnemy('enemy-1', 'EnemyA');
    enemy.spellCastEvents = [enemyCast as any];

    const result = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());
    expect(result.ccAvoidedInstances).toHaveLength(0);
  });

  it('tracks Monk Transcendence: Transfer CC avoidance', () => {
    // Monk teleports (119996) at T+10s, enemy CC cast at T+10s.
    const enemyCast = makeSpellCastEvent('118', MATCH_START + 10_000, 'player-1', 'Player', 'enemy-1', 'EnemyA');
    const transCast = {
      logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: MATCH_START + 10_100 },
      spellId: '119996',
      spellName: 'Transcendence: Transfer',
    };

    const player = makeUnit('player-1', {
      class: CombatUnitClass.Monk,
      spec: CombatUnitSpec.Monk_Mistweaver,
      spellCastEvents: [transCast as any],
    });
    const enemy = makeEnemy('enemy-1', 'EnemyA');
    enemy.spellCastEvents = [enemyCast as any];

    const result = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());
    expect(result.ccAvoidedInstances).toHaveLength(1);
    expect(result.ccAvoidedInstances[0].avoidanceSpellName).toBe('Transcendence: Transfer');
  });

  it('tracks Paladin Blessing of Sacrifice CC break', () => {
    // Paladin casts Sacrifice (6940) at T+5s, gets feared (5782) at T+10s, fear breaks at T+11s (duration=1s <= 1.5s)
    const sacrificeCast = {
      logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: MATCH_START + 5_000 },
      spellId: '6940',
      spellName: 'Blessing of Sacrifice',
    };
    const fearApply = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      '5782',
      MATCH_START + 10_000,
      'enemy-1',
      'player-1',
      'DEBUFF',
    );
    const fearRemove = makeAuraEvent(
      LogEvent.SPELL_AURA_REMOVED,
      '5782',
      MATCH_START + 11_000,
      'enemy-1',
      'player-1',
      'DEBUFF',
    );

    const player = makeUnit('player-1', {
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Holy,
      spellCastEvents: [sacrificeCast as any],
      auraEvents: [fearApply, fearRemove],
    });
    const enemy = makeEnemy('enemy-1', 'EnemyA');

    const result = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());
    expect(result.ccAvoidedInstances).toHaveLength(1);
    expect(result.ccAvoidedInstances[0].avoidanceSpellName).toBe('Blessing of Sacrifice');
  });

  it('tracks Monk Roll avoiding Hunter Freezing Trap ground CC', () => {
    // Enemy Hunter casts Freezing Trap (3355) on the ground (no target ID)
    const enemyCast = {
      logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: MATCH_START + 10_000 },
      spellId: '3355',
      spellName: 'Freezing Trap',
      destUnitId: '0000000000000000',
      destUnitName: 'nil',
      srcUnitId: 'enemy-1',
      srcUnitName: 'HunterA',
    };

    // Monk rolls (109132) at T+9.5s
    const monkRoll = {
      logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: MATCH_START + 9_500 },
      spellId: '109132',
      spellName: 'Roll',
      destUnitId: 'player-1',
      destUnitName: 'MonkPlayer',
      srcUnitId: 'player-1',
      srcUnitName: 'MonkPlayer',
    };

    const player = makeUnit('player-1', {
      class: CombatUnitClass.Monk,
      spec: CombatUnitSpec.Monk_Mistweaver,
      spellCastEvents: [monkRoll as any],
    });
    const enemy = makeEnemy('enemy-1', 'HunterA');
    enemy.spellCastEvents = [enemyCast as any];

    const result = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());
    expect(result.ccAvoidedInstances).toHaveLength(1);
    expect(result.ccAvoidedInstances[0].avoidanceSpellName).toBe('Roll');
  });

  it('tracks Druid shapeshift form Hex immunity', () => {
    // Enemy Shamans casts Hex (51514) on Druid
    const enemyCast = {
      logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: MATCH_START + 10_000 },
      spellId: '51514',
      spellName: 'Hex',
      destUnitId: 'player-1',
      destUnitName: 'DruidPlayer',
      srcUnitId: 'enemy-1',
      srcUnitName: 'ShamanEnemy',
    };

    const bearFormBuff = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      '5487',
      MATCH_START + 8_000,
      'player-1',
      'DruidPlayer',
    );

    const player = makeUnit('player-1', {
      class: CombatUnitClass.Druid,
      spec: CombatUnitSpec.Druid_Restoration,
      auraEvents: [bearFormBuff as any],
    });
    const enemy = makeEnemy('enemy-1', 'ShamanEnemy');
    enemy.spellCastEvents = [enemyCast as any];

    const result = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());
    expect(result.ccAvoidedInstances).toHaveLength(1);
    expect(result.ccAvoidedInstances[0].avoidanceSpellName).toBe('Bear Form');
  });

  it('does NOT credit Druid Cat Form as avoiding a GROUND CC (shapeshift does not dodge ground stuns)', () => {
    // H14: A Druid merely in Cat Form ('768') when an enemy drops a ground CC
    // (Capacitor Totem '192058') must NOT be credited with avoiding it — shapeshifting
    // does not move the player out of a ground AoE stun.
    const catFormBuff = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      '768',
      MATCH_START + 2_000,
      'player-1',
      'player-1',
      'BUFF',
    );
    // Player also entered Cat Form via a cast near the ground CC (realistic: in Cat Form).
    const catFormCast = {
      logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: MATCH_START + 9_800 },
      spellId: '768',
      spellName: 'Cat Form',
      destUnitId: 'player-1',
      destUnitName: 'DruidPlayer',
      srcUnitId: 'player-1',
      srcUnitName: 'DruidPlayer',
    };
    // Enemy Shaman drops Capacitor Totem (ground CC) at T+10s; it does NOT land on the player.
    const enemyCast = {
      logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: MATCH_START + 10_000 },
      spellId: '192058',
      spellName: 'Capacitor Totem',
      destUnitId: '0000000000000000',
      destUnitName: 'nil',
      srcUnitId: 'enemy-1',
      srcUnitName: 'ShamanEnemy',
    };

    const player = makeUnit('player-1', {
      class: CombatUnitClass.Druid,
      spec: CombatUnitSpec.Druid_Restoration,
      auraEvents: [catFormBuff as any],
      spellCastEvents: [catFormCast as any],
    });
    const enemy = makeEnemy('enemy-1', 'ShamanEnemy');
    enemy.spellCastEvents = [enemyCast as any];

    const result = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());

    expect(result.ccAvoidedInstances.some((i) => i.avoidanceSpellName === 'Cat Form')).toBe(false);
    expect(result.ccAvoidedInstances).toHaveLength(0);
  });

  it('tracks Shaman Tremor Totem breaking Fear early', () => {
    // Shaman gets feared at T+10s, breaks at T+11s (duration 1.0s)
    const fearApplied = makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '5782', MATCH_START + 10_000, 'enemy-1', 'EnemyA');
    const fearRemoved = makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, '5782', MATCH_START + 11_000, 'enemy-1', 'EnemyA');

    // Tremor Totem cast at T+8s
    const tremorCast = {
      logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: MATCH_START + 8_000 },
      spellId: '8143',
      spellName: 'Tremor Totem',
      destUnitId: '0000000000000000',
      destUnitName: 'nil',
      srcUnitId: 'player-1',
      srcUnitName: 'ShamanPlayer',
    };

    const player = makeUnit('player-1', {
      class: CombatUnitClass.Shaman,
      spec: CombatUnitSpec.Shaman_Restoration,
      auraEvents: [fearApplied as any, fearRemoved as any],
      spellCastEvents: [tremorCast as any],
    });
    const enemy = makeEnemy('enemy-1', 'EnemyA');

    const result = analyzePlayerCCAndTrinket(player, [enemy], makeCombat());
    expect(result.ccAvoidedInstances).toHaveLength(1);
    expect(result.ccAvoidedInstances[0].avoidanceSpellName).toBe('Tremor Totem');
  });
});
