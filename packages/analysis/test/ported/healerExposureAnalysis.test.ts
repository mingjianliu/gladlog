/* eslint-disable @typescript-eslint/no-explicit-any */
import { CombatUnitSpec, LogEvent } from '@gladlog/parser-compat';

import * as drAnalysis from '../../src/utils/drAnalysis';
import {
  analyzeHealerExposureAtBurst,
  buildHealerCCReceivedEvents,
  formatEnemyCCKitHeader,
  formatHealerCCReceivedForContext,
  formatHealerExposureEntries,
  formatHealerExposureForContext,
} from '../../src/utils/healerExposureAnalysis';
import { makeAdvancedAction, makeAuraEvent, makeSpellCastEvent, makeUnit } from './testHelpers';

const MATCH_START = 1_000_000;

describe('healerExposureAnalysis — exposure calculation', () => {
  it('returns empty when no burst windows provided', () => {
    const res = analyzeHealerExposureAtBurst(
      [],
      [],
      makeUnit('h'),
      { trinketUseTimes: [], ccInstances: [] } as any,
      [],
      '1505',
      MATCH_START,
    );
    expect(res).toHaveLength(0);
  });

  it('labels Safe when threats are beyond 40 yards (B26)', () => {
    const healer = makeUnit('h', {
      advancedActions: [makeAdvancedAction(MATCH_START, 0, 0)], // at (0,0)
    });
    (healer.advancedActions[0] as any).advancedActorId = 'h';
    const enemy = makeUnit('e', {
      spec: CombatUnitSpec.Mage_Frost,
      advancedActions: [makeAdvancedAction(MATCH_START, 50, 0)], // at (50,0) -> 50 yards
    });
    (enemy.advancedActions[0] as any).advancedActorId = 'e';
    const windows = [{ fromSeconds: 0, dangerLabel: 'High' }] as any;

    const res = analyzeHealerExposureAtBurst(
      windows,
      [enemy],
      healer,
      { trinketUseTimes: [], ccInstances: [] } as any,
      [],
      '1505',
      MATCH_START,
    );
    expect(res).toHaveLength(0); // No threats within range
  });

  it('skips when healer position is missing (B45)', () => {
    const healer = makeUnit('h', { advancedActions: [] });
    const windows = [{ fromSeconds: 0 }] as any;
    const res = analyzeHealerExposureAtBurst(
      windows,
      [],
      healer,
      { trinketUseTimes: [], ccInstances: [] } as any,
      [],
      '1505',
      MATCH_START,
    );
    expect(res).toHaveLength(0);
  });

  it('skips when enemy position is missing (B46)', () => {
    const healer = makeUnit('h', { advancedActions: [makeAdvancedAction(MATCH_START, 0, 0)] });
    (healer.advancedActions[0] as any).advancedActorId = 'h';
    const enemy = makeUnit('e', { advancedActions: [] });
    const windows = [{ fromSeconds: 0 }] as any;
    const res = analyzeHealerExposureAtBurst(
      windows,
      [enemy],
      healer,
      { trinketUseTimes: [], ccInstances: [] } as any,
      [],
      '1505',
      MATCH_START,
    );
    expect(res).toHaveLength(0);
  });

  it('labels Critical when healer has no trinket and Full DR threat is in LoS', () => {
    const healer = makeUnit('h', {
      advancedActions: [makeAdvancedAction(MATCH_START, 0, 0)],
    });
    (healer.advancedActions[0] as any).advancedActorId = 'h';
    const enemy = makeUnit('e', {
      name: 'Mage',
      spec: CombatUnitSpec.Mage_Frost,
      advancedActions: [makeAdvancedAction(MATCH_START, 10, 0)],
    });
    (enemy.advancedActions[0] as any).advancedActorId = 'e';
    const windows = [{ fromSeconds: 0, dangerLabel: 'High' }] as any;
    const healerCCSummary: any = {
      trinketType: 'Gladiator',
      trinketUseTimes: [0], // Used at t=0
      trinketCooldownSeconds: 120,
      ccInstances: [],
    };

    const res = analyzeHealerExposureAtBurst(windows, [enemy], healer, healerCCSummary, [], '1505', MATCH_START);
    expect(res[0].exposureLabel).toBe('Critical');
    expect(res[0].trinketState).toBe('on_cooldown');
  });

  it('labels Exposed with Full DR threat formatting (B47)', () => {
    const healer = makeUnit('h', { advancedActions: [makeAdvancedAction(MATCH_START, 0, 0)] });
    (healer.advancedActions[0] as any).advancedActorId = 'h';
    const enemy = makeUnit('e', {
      name: 'Mage',
      spec: CombatUnitSpec.Mage_Frost,
      advancedActions: [makeAdvancedAction(MATCH_START, 10, 0)],
    });
    (enemy.advancedActions[0] as any).advancedActorId = 'e';
    const windows = [{ fromSeconds: 0, dangerLabel: 'High' }] as any;
    const healerCCSummary: any = {
      trinketType: 'Gladiator',
      trinketUseTimes: [], // Trinket available
      trinketCooldownSeconds: 120,
      ccInstances: [],
    };
    const res = analyzeHealerExposureAtBurst(windows, [enemy], healer, healerCCSummary, [], '1505', MATCH_START);
    expect(res[0].exposureLabel).toBe('Exposed');

    const lines = formatHealerExposureForContext(res);
    expect(lines.join('\n')).toContain('Full-DR CC in LoS; trinket up (sole CC counter)');
  });

  it('handles passive trinkets (Relentless/Adaptation)', () => {
    const healer = makeUnit('h', { advancedActions: [makeAdvancedAction(MATCH_START, 0, 0)] });
    (healer.advancedActions[0] as any).advancedActorId = 'h';
    const enemy = makeUnit('e', {
      spec: CombatUnitSpec.Mage_Frost,
      advancedActions: [makeAdvancedAction(MATCH_START, 10, 0)],
    });
    (enemy.advancedActions[0] as any).advancedActorId = 'e';
    const windows = [{ fromSeconds: 0 }] as any;
    const summary: any = { trinketType: 'Relentless', ccInstances: [] };

    const res = analyzeHealerExposureAtBurst(windows, [enemy], healer, summary, [], '1505', MATCH_START);
    expect(res[0].trinketState).toBe('passive');
  });

  it('labels Pressured when only 50% DR threats in LoS and trinket available', () => {
    const healer = makeUnit('h', { advancedActions: [makeAdvancedAction(MATCH_START, 0, 0)] });
    (healer.advancedActions[0] as any).advancedActorId = 'h';
    const enemy = makeUnit('e', {
      name: 'Mage',
      spec: CombatUnitSpec.Mage_Frost,
      advancedActions: [makeAdvancedAction(MATCH_START, 10, 0)],
    });
    (enemy.advancedActions[0] as any).advancedActorId = 'e';
    const windows = [{ fromSeconds: 0 }] as any;
    const healerCCSummary: any = {
      trinketType: 'Gladiator',
      trinketUseTimes: [],
      trinketCooldownSeconds: 120,
      ccInstances: [
        { atSeconds: -20, durationSeconds: 4, spellId: '118', drInfo: { category: 'Incapacitate' } }, // Recently Poly'd
      ],
    };

    const res = analyzeHealerExposureAtBurst(windows, [enemy], healer, healerCCSummary, [], '1505', MATCH_START);
    expect(res[0].exposureLabel).toBe('Pressured');
  });

  it('skips enemies who are currently in CC (B44)', () => {
    const healer = makeUnit('h', { advancedActions: [makeAdvancedAction(MATCH_START, 0, 0)] });
    (healer.advancedActions[0] as any).advancedActorId = 'h';
    const enemy = makeUnit('e', {
      spec: CombatUnitSpec.Mage_Frost,
      advancedActions: [makeAdvancedAction(MATCH_START, 10, 0)],
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '853', MATCH_START - 2000, 'h', 'e'), // HoJ applied
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, '853', MATCH_START - 1000, 'h', 'e'), // HoJ removed - enemy now free
      ],
    });
    (enemy.advancedActions[0] as any).advancedActorId = 'e';
    const windows = [{ fromSeconds: 0 }] as any;
    const res = analyzeHealerExposureAtBurst(
      windows,
      [enemy],
      healer,
      { trinketUseTimes: [], ccInstances: [] } as any,
      [],
      '1505',
      MATCH_START,
    );
    expect(res).toHaveLength(1); // Enemy is now free and threatens
  });

  it('uses observed CC history from other teammates (B49)', () => {
    const healer = makeUnit('h', { advancedActions: [makeAdvancedAction(MATCH_START, 0, 0)] });
    (healer.advancedActions[0] as any).advancedActorId = 'h';
    const enemy = makeUnit('e', {
      name: 'E1',
      spec: CombatUnitSpec.Warrior_Arms,
      advancedActions: [makeAdvancedAction(MATCH_START, 10, 0)],
    });
    (enemy.advancedActions[0] as any).advancedActorId = 'e';
    const windows = [{ fromSeconds: 0 }] as any;

    // Observed CC: Mage (enemy) cast Polymorph on a teammate
    const friendCCSummary: any = {
      ccInstances: [
        { sourceName: 'E1', spellId: '118', spellName: 'Polymorph' }, // Incapacitate category
      ],
    };

    const res = analyzeHealerExposureAtBurst(
      windows,
      [enemy],
      healer,
      { trinketUseTimes: [], ccInstances: [] } as any,
      [friendCCSummary],
      '1505',
      MATCH_START,
    );
    expect(res[0].threats[0].ccSpellName).toBe('Polymorph');
    expect(res[0].threats[0].ccCategory).toBe('Incapacitate');
  });

  it('handles null LoS result by assuming unblocked (B50)', () => {
    const healer = makeUnit('h', { advancedActions: [makeAdvancedAction(MATCH_START, 0, 0)] });
    (healer.advancedActions[0] as any).advancedActorId = 'h';
    const enemy = makeUnit('e', {
      spec: CombatUnitSpec.Mage_Frost,
      advancedActions: [makeAdvancedAction(MATCH_START, 10, 0)],
    });
    (enemy.advancedActions[0] as any).advancedActorId = 'e';
    const windows = [{ fromSeconds: 0 }] as any;
    // zone '999' returns null from hasLineOfSight
    const res = analyzeHealerExposureAtBurst(
      windows,
      [enemy],
      healer,
      { trinketUseTimes: [], ccInstances: [] } as any,
      [],
      '999',
      MATCH_START,
    );
    expect(res[0].threats[0].losBlocked).toBe(false);
  });
});

describe('healerExposureAnalysis — CC avoidance', () => {
  it('buildHealerCCReceivedEvents detects avoidance tools used/idle', () => {
    const healer = makeUnit('h', {
      spec: CombatUnitSpec.Priest_Discipline,
      spellCastEvents: [
        makeSpellCastEvent('586', MATCH_START + 10_000, 'h', 'Self', 'h', 'Priest'), // Fade success at 10s
      ],
    });
    const friend = makeUnit('f', {
      advancedActions: [
        makeAdvancedAction(MATCH_START + 50_000, 0, 0, 100, 50), // Friend at 50% HP
      ],
    });
    (friend.advancedActions[0] as any).advancedActorId = 'f';
    const ccSummary = {
      ccInstances: [{ atSeconds: 50, durationSeconds: 6, spellName: 'Fear', drInfo: { category: 'Disorient' } }],
    };

    const res = buildHealerCCReceivedEvents({ startTime: MATCH_START } as any, healer, [friend], ccSummary as any);
    expect(res).toHaveLength(1);
    expect(res[0].avoidanceToolsAvailable).toHaveLength(1);
    expect(res[0].avoidanceToolsAvailable[0].spellName).toBe('Fade');
    expect(res[0].avoidanceToolsAvailable[0].idleForSeconds).toBe(10); // 50s - (10s + 30s CD) = 10s
  });

  it('detects avoidance tool as available from time 0 when it has never been cast', () => {
    const healer = makeUnit('h', {
      spec: CombatUnitSpec.Priest_Discipline,
      spellCastEvents: [],
    });
    const friend = makeUnit('f', {
      advancedActions: [makeAdvancedAction(MATCH_START + 50_000, 0, 0, 100, 50)],
    });
    (friend.advancedActions[0] as any).advancedActorId = 'f';
    const ccSummary = {
      ccInstances: [{ atSeconds: 50, durationSeconds: 6, spellName: 'Fear', drInfo: { category: 'Disorient' } }],
    };

    const res = buildHealerCCReceivedEvents({ startTime: MATCH_START } as any, healer, [friend], ccSummary as any);
    expect(res).toHaveLength(1);
    expect(res[0].avoidanceToolsAvailable).toHaveLength(1);
    expect(res[0].avoidanceToolsAvailable[0].spellName).toBe('Fade');
    expect(res[0].avoidanceToolsAvailable[0].idleForSeconds).toBe(50);
  });

  it('skips events where no teammate is at low HP', () => {
    const healer = makeUnit('h', { spec: CombatUnitSpec.Priest_Discipline });
    const friend = makeUnit('f', { advancedActions: [makeAdvancedAction(MATCH_START, 0, 0, 100, 100)] });
    (friend.advancedActions[0] as any).advancedActorId = 'f';
    const ccSummary = { ccInstances: [{ atSeconds: 10, durationSeconds: 6, spellName: 'Fear' }] };
    const res = buildHealerCCReceivedEvents({ startTime: MATCH_START } as any, healer, [friend], ccSummary as any);
    expect(res).toHaveLength(0);
  });

  it('formats correctly when no avoidance tools available (B48)', () => {
    const ev: any = {
      atSeconds: 10,
      ccSpellName: 'Fear',
      durationSeconds: 6,
      avoidanceToolsAvailable: [],
    };
    const res = formatHealerCCReceivedForContext([ev]);
    expect(res).toContain('no avoidance tools available');
  });
});

describe('healerExposureAnalysis — pillar proximity (F15 P2)', () => {
  it('carries a verified losBreak option when a pillar can block an exposed threat', () => {
    // Healer 1.5yd from the edge of Nagrand's north pillar (r=4 @-2044.5,6623.5)
    const healer = makeUnit('h', { advancedActions: [makeAdvancedAction(MATCH_START, -2050, 6623.5)] });
    (healer.advancedActions[0] as any).advancedActorId = 'h';
    const enemy = makeUnit('e', {
      name: 'Mage',
      spec: CombatUnitSpec.Mage_Frost,
      advancedActions: [makeAdvancedAction(MATCH_START, -2050, 6600)],
    });
    (enemy.advancedActions[0] as any).advancedActorId = 'e';
    const windows = [{ fromSeconds: 0, dangerLabel: 'High' }] as any;
    const healerCCSummary: any = {
      trinketType: 'Gladiator',
      trinketUseTimes: [],
      trinketCooldownSeconds: 120,
      ccInstances: [],
    };

    const res = analyzeHealerExposureAtBurst(windows, [enemy], healer, healerCCSummary, [], '1505', MATCH_START);
    expect(res).toHaveLength(1);
    expect(res[0].losBreak).not.toBeNull();
    expect(res[0].losBreak?.blocksEnemyName).toBe('Mage');
    expect(res[0].losBreak?.repositionYards).toBeGreaterThan(0);
    expect(res[0].losBreak?.repositionYards).toBeLessThan(25);
  });

  it('formatter renders the pillar hint on Critical/Exposed entries when a pillar is nearby', () => {
    const base: any = {
      atSeconds: 10,
      burstDangerLabel: 'High',
      trinketState: 'available',
      trinketAvailableAtSeconds: null,
      exposureLabel: 'Exposed',
      threats: [
        {
          enemySpec: 'Frost Mage',
          enemyName: 'M1',
          ccSpellName: 'Polymorph',
          ccCategory: 'Incapacitate',
          healerDRLevel: 'Full',
          losBlocked: false,
        },
      ],
    };
    const near = { ...base, losBreak: { repositionYards: 6.4, blocksEnemyName: 'M1' } };
    const far = { ...base, atSeconds: 20, losBreak: { repositionYards: 48, blocksEnemyName: 'M1' } };
    const unmapped = { ...base, atSeconds: 30, losBreak: null };

    const text = formatHealerExposureForContext([near, far, unmapped]).join('\n');
    expect(text).toContain('LoS break ~6.4yd away (pillar-blocks M1)');
    expect(text).not.toContain('~48yd');
    expect((text.match(/LoS break/g) ?? []).length).toBe(1);
  });

  it('reports the directional reposition distance, never the threat-blind obstacle-edge distance (F194)', () => {
    // Healer 1.5yd from the pillar edge — the OLD hint would say "nearest pillar ~1.5yd"
    // regardless of where the threat stands. The verified spot must sit BEHIND the pillar
    // relative to the mage, so the honest reposition distance is several times larger.
    const healer = makeUnit('h', { advancedActions: [makeAdvancedAction(MATCH_START, -2050, 6623.5)] });
    (healer.advancedActions[0] as any).advancedActorId = 'h';
    const enemy = makeUnit('e', {
      name: 'Mage',
      spec: CombatUnitSpec.Mage_Frost,
      advancedActions: [makeAdvancedAction(MATCH_START, -2050, 6600)],
    });
    (enemy.advancedActions[0] as any).advancedActorId = 'e';
    const windows = [{ fromSeconds: 0, dangerLabel: 'High' }] as any;
    const healerCCSummary: any = {
      trinketType: 'Gladiator',
      trinketUseTimes: [],
      trinketCooldownSeconds: 120,
      ccInstances: [],
    };

    const res = analyzeHealerExposureAtBurst(windows, [enemy], healer, healerCCSummary, [], '1505', MATCH_START);
    expect(res).toHaveLength(1);
    expect(res[0].losBreak).not.toBeNull();
    expect(res[0].losBreak?.repositionYards).toBeGreaterThan(3);
  });

  it('losBreak is null when the zone has no mapped geometry', () => {
    const healer = makeUnit('h', { advancedActions: [makeAdvancedAction(MATCH_START, -2050, 6623.5)] });
    (healer.advancedActions[0] as any).advancedActorId = 'h';
    const enemy = makeUnit('e', {
      name: 'Mage',
      spec: CombatUnitSpec.Mage_Frost,
      advancedActions: [makeAdvancedAction(MATCH_START, -2050, 6600)],
    });
    (enemy.advancedActions[0] as any).advancedActorId = 'e';
    const windows = [{ fromSeconds: 0, dangerLabel: 'High' }] as any;
    const healerCCSummary: any = {
      trinketType: 'Gladiator',
      trinketUseTimes: [],
      trinketCooldownSeconds: 120,
      ccInstances: [],
    };

    const res = analyzeHealerExposureAtBurst(windows, [enemy], healer, healerCCSummary, [], '999999', MATCH_START);
    expect(res).toHaveLength(1);
    expect(res[0].losBreak).toBeNull();
  });
});

const makeThreat = (over: Record<string, unknown> = {}): any => ({
  enemySpec: 'Frost Mage',
  enemyName: 'M1',
  ccSpellName: 'Polymorph',
  ccCategory: 'Incapacitate',
  healerDRLevel: 'Full',
  losBlocked: false,
  ...over,
});

const makeExposure = (over: Record<string, unknown> = {}): any => ({
  atSeconds: 10,
  burstDangerLabel: 'High',
  trinketState: 'available',
  trinketAvailableAtSeconds: null,
  exposureLabel: 'Exposed',
  losBreak: null,
  threats: [makeThreat()],
  ...over,
});

describe('healerExposureAnalysis — enemy CC kit header', () => {
  it('returns [] for empty input', () => {
    expect(formatEnemyCCKitHeader([])).toEqual([]);
  });

  it('unions and dedupes per-enemy spells across all windows (incl. pillar-blocked), in first-appearance order', () => {
    const exposures = [
      makeExposure({
        threats: [
          makeThreat({
            enemyName: 'E1',
            enemySpec: 'Preservation Evoker',
            ccSpellName: 'Sleep Walk',
            ccCategory: 'Disorient',
          }),
          // Pillar-blocked threats still belong to the match-level kit union
          makeThreat({
            enemyName: 'E2',
            enemySpec: 'Feral Druid',
            ccSpellName: 'Rake',
            ccCategory: 'Stun',
            losBlocked: true,
          }),
        ],
      }),
      makeExposure({
        atSeconds: 40,
        threats: [
          // duplicate of window 1 — must not repeat in the kit
          makeThreat({
            enemyName: 'E1',
            enemySpec: 'Preservation Evoker',
            ccSpellName: 'Sleep Walk',
            ccCategory: 'Disorient',
          }),
          makeThreat({
            enemyName: 'E1',
            enemySpec: 'Preservation Evoker',
            ccSpellName: 'Terror of the Skies',
            ccCategory: 'Stun',
          }),
          makeThreat({
            enemyName: 'E2',
            enemySpec: 'Feral Druid',
            ccSpellName: 'Incapacitating Roar',
            ccCategory: 'Disorient',
          }),
        ],
      }),
    ];
    const header = formatEnemyCCKitHeader(exposures);
    expect(header).toEqual([
      'ENEMY CC KIT (threats to you): Preservation Evoker (E1): Sleep Walk [Disorient], Terror of the Skies [Stun]; Feral Druid (E2): Rake [Stun], Incapacitating Roar [Disorient]',
    ]);
  });
});

describe('healerExposureAnalysis — compact per-window entries', () => {
  it('emits exactly one single line per window, tagged and timestamp-free', () => {
    const entries = formatHealerExposureEntries([makeExposure(), makeExposure({ atSeconds: 40 })]);
    expect(entries).toHaveLength(2);
    expect(entries[0].atSeconds).toBe(10);
    expect(entries[1].atSeconds).toBe(40);
    for (const e of entries) {
      expect(e.line.startsWith('[HEALER EXPOSURE]   ')).toBe(true);
      expect(e.line).not.toContain('\n');
    }
  });

  it('uses spec-only refs when specs are unique among threatening enemies', () => {
    const entries = formatHealerExposureEntries([
      makeExposure({
        threats: [
          makeThreat({ enemyName: 'M1', enemySpec: 'Frost Mage' }),
          makeThreat({
            enemyName: 'W1',
            enemySpec: 'Arms Warrior',
            ccSpellName: 'Intimidating Shout',
            ccCategory: 'Disorient',
            losBlocked: true,
          }),
        ],
      }),
    ]);
    expect(entries[0].line).toContain('IN LoS: Frost Mage: Polymorph Full DR');
    expect(entries[0].line).toContain('| Pillar-blocked: Arms Warrior');
    expect(entries[0].line).not.toContain('(M1)');
    expect(entries[0].line).not.toContain('(W1)');
  });

  it('uses Spec (Name) refs for enemies sharing a spec (even across windows)', () => {
    const entries = formatHealerExposureEntries([
      makeExposure({ threats: [makeThreat({ enemyName: 'M1', enemySpec: 'Frost Mage' })] }),
      makeExposure({
        atSeconds: 40,
        threats: [
          makeThreat({
            enemyName: 'M2',
            enemySpec: 'Frost Mage',
            ccSpellName: 'Ring of Frost',
            ccCategory: 'Disorient',
          }),
        ],
      }),
    ]);
    expect(entries[0].line).toContain('IN LoS: Frost Mage (M1): Polymorph Full DR');
    expect(entries[1].line).toContain('IN LoS: Frost Mage (M2): Ring of Frost Full DR');
  });

  it('groups multiple spells of the same enemy under one ref with per-spell DR', () => {
    const entries = formatHealerExposureEntries([
      makeExposure({
        threats: [
          makeThreat({
            enemyName: 'M1',
            enemySpec: 'Frost Mage',
            ccSpellName: 'Polymorph',
            ccCategory: 'Incapacitate',
            healerDRLevel: 'Full',
          }),
          makeThreat({
            enemyName: 'M1',
            enemySpec: 'Frost Mage',
            ccSpellName: 'Ring of Frost',
            ccCategory: 'Disorient',
            healerDRLevel: '50%',
          }),
        ],
      }),
    ]);
    expect(entries[0].line).toContain('IN LoS: Frost Mage: Polymorph Full DR, Ring of Frost 50% DR');
  });

  it('omits the Pillar-blocked and verdict segments when they do not apply', () => {
    // Pressured (50% DR only, trinket ready) → no verdict; no blocked threats → no Pillar-blocked
    const entries = formatHealerExposureEntries([
      makeExposure({ exposureLabel: 'Pressured', threats: [makeThreat({ healerDRLevel: '50%' })] }),
    ]);
    expect(entries[0].line).not.toContain('Pillar-blocked');
    expect(entries[0].line).not.toContain('→');
  });

  it('carries the Critical verdict and trinket CD state on a single line', () => {
    const entries = formatHealerExposureEntries([
      makeExposure({ exposureLabel: 'Critical', trinketState: 'on_cooldown', trinketAvailableAtSeconds: 40 }),
    ]);
    expect(entries[0].line).toContain('trinket on CD (back 0:40)');
    expect(entries[0].line).toContain('⚠ CRITICAL');
    expect(entries[0].line).toContain('| → no trinket available while Full-DR CC is in LoS');
  });
});

describe('healerExposureAnalysis — formatting', () => {
  it('formatHealerExposureForContext produces compact block: kit header once + one line per window', () => {
    const exposure = makeExposure({
      trinketState: 'on_cooldown',
      trinketAvailableAtSeconds: 40,
      exposureLabel: 'Critical',
      threats: [
        makeThreat({ enemySpec: 'Frost Mage', enemyName: 'M1' }),
        makeThreat({
          enemySpec: 'Arms Warrior',
          enemyName: 'W1',
          ccSpellName: 'Intimidating Shout',
          ccCategory: 'Disorient',
          losBlocked: true,
        }),
      ],
    });
    const lines = formatHealerExposureForContext([exposure]);
    const text = lines.join('\n');
    expect(lines[0]).toBe('HEALER EXPOSURE DURING ENEMY BURST WINDOWS:');
    // Kit is stated once, with full Spec (Name) references
    expect(lines[1]).toBe(
      '  ENEMY CC KIT (threats to you): Frost Mage (M1): Polymorph [Incapacitate]; Arms Warrior (W1): Intimidating Shout [Disorient]',
    );
    expect(text).toContain('⚠ CRITICAL');
    expect(text).toContain('trinket on CD (back 0:40)');
    // Per-window line is compact: spec-only refs, no per-window kit re-enumeration
    const windowLines = lines.filter((l) => l.startsWith('  [0:10]'));
    expect(windowLines).toHaveLength(1);
    expect(windowLines[0]).toContain('IN LoS: Frost Mage: Polymorph Full DR');
    expect(windowLines[0]).toContain('| Pillar-blocked: Arms Warrior');
    expect(windowLines[0]).toContain('| → no trinket available while Full-DR CC is in LoS');
  });

  it('formatHealerCCReceivedForContext produces brief summary', () => {
    const ev: any = {
      atSeconds: 10,
      ccSpellName: 'Fear',
      durationSeconds: 6,
      avoidanceToolsAvailable: [{ spellName: 'Fade', idleForSeconds: 5 }],
    };
    const res = formatHealerCCReceivedForContext([ev]);
    expect(res).toContain('Fear (6s)');
    expect(res).toContain('Fade available 5s prior');
  });

  it('handles unknown enemy spec fallback in primary CC selection', () => {
    const healer = makeUnit('h', {
      advancedActions: [makeAdvancedAction(MATCH_START, 0, 0)],
    });
    (healer.advancedActions[0] as any).advancedActorId = 'h';
    const enemy = makeUnit('e', {
      spec: 9999 as any,
      advancedActions: [makeAdvancedAction(MATCH_START, 10, 0)],
    });
    (enemy.advancedActions[0] as any).advancedActorId = 'e';
    const windows = [{ fromSeconds: 0, dangerLabel: 'High' }] as any;

    const res = analyzeHealerExposureAtBurst(
      windows,
      [enemy],
      healer,
      { trinketUseTimes: [], ccInstances: [] } as any,
      [],
      '1505',
      MATCH_START,
    );
    expect(res).toHaveLength(0);
  });

  it('triggers Safe label in computeExposureLabel when threats are in LoS but at 25% DR', () => {
    const healer = makeUnit('h', {
      advancedActions: [makeAdvancedAction(MATCH_START, 0, 0)],
    });
    (healer.advancedActions[0] as any).advancedActorId = 'h';
    const enemy = makeUnit('e', {
      spec: CombatUnitSpec.Mage_Frost,
      advancedActions: [makeAdvancedAction(MATCH_START, 10, 0)],
    });
    (enemy.advancedActions[0] as any).advancedActorId = 'e';
    const windows = [{ fromSeconds: 0, dangerLabel: 'High' }] as any;

    const spy = vi.spyOn(drAnalysis, 'getDRLevelAtTime').mockReturnValue('25%' as any);

    const res = analyzeHealerExposureAtBurst(
      windows,
      [enemy],
      healer,
      { trinketUseTimes: [], ccInstances: [] } as any,
      [],
      '1505',
      MATCH_START,
    );

    spy.mockRestore();

    expect(res).toHaveLength(1);
    expect(res[0].exposureLabel).toBe('Safe');
  });

  it('computes availableSince from previous cooldown cast time', () => {
    const healer = makeUnit('h', {
      spec: CombatUnitSpec.Priest_Discipline,
      spellCastEvents: [makeSpellCastEvent('586', MATCH_START + 5000, 'h', 'h', 'h', 'h', 0, 'Fade')],
      advancedActions: [makeAdvancedAction(MATCH_START + 40000, 0, 0)],
    });
    const act = healer.advancedActions[0] as any;
    act.advancedActorCurrentHp = 100000;
    act.advancedActorMaxHp = 200000;

    const friends = [healer];
    const ccSummary = {
      ccInstances: [
        {
          atSeconds: 40,
          durationSeconds: 6,
          spellId: '118',
          spellName: 'Polymorph',
          drInfo: { category: 'Incapacitate', level: 'Full', sequenceIndex: 0 },
        },
      ],
    } as any;

    const events = buildHealerCCReceivedEvents({ startTime: MATCH_START } as any, healer, friends, ccSummary);

    expect(events).toHaveLength(1);
    expect(events[0].avoidanceToolsAvailable).toHaveLength(1);
    expect(events[0].avoidanceToolsAvailable[0].spellName).toBe('Fade');
    expect(events[0].avoidanceToolsAvailable[0].idleForSeconds).toBeCloseTo(5);
  });
});
