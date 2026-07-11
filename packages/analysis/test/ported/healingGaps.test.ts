/* eslint-disable @typescript-eslint/no-explicit-any */
import { CombatUnitSpec, LogEvent } from '@gladlog/parser-compat';

import { detectHealingGaps, formatHealingGapsForContext } from '../../src/utils/healingGaps';
import { makeAuraEvent, makeSpellCastEvent, makeUnit } from './testHelpers';

const MATCH_START = 1_000_000;

describe('healingGaps — main detection', () => {
  function makeCombat() {
    return { startTime: MATCH_START, endTime: MATCH_START + 60_000 };
  }

  it('identifies gaps with pressure and free cast time (B80)', () => {
    const healer = makeUnit('h', {
      spec: CombatUnitSpec.Priest_Holy,
      spellCastEvents: [
        makeSpellCastEvent('2061', MATCH_START + 10_000, 'f1', 'Friend', 'h', 'Priest'),
        makeSpellCastEvent('2061', MATCH_START + 20_000, 'f1', 'Friend', 'h', 'Priest'),
      ],
    });

    const friend = makeUnit('f1', {
      spec: CombatUnitSpec.Warrior_Arms,
      damageIn: [{ logLine: { timestamp: MATCH_START + 15_000 }, effectiveAmount: -100_000 }] as any,
    });
    const enemy = makeUnit('e1');

    const res = detectHealingGaps(healer as any, [healer, friend] as any, [enemy] as any, makeCombat());
    expect(res).toHaveLength(1);
    expect(res[0].durationSeconds).toBe(10);
    expect(res[0].mostDamagedName).toBe('f1');
    expect(res[0].mostDamagedAmount).toBe(100_000);
  });

  it('skips gaps where the healer is fully CCed (B81)', () => {
    const healer = makeUnit('h', {
      spellCastEvents: [
        makeSpellCastEvent('2061', MATCH_START + 10_000, 'f1'),
        makeSpellCastEvent('2061', MATCH_START + 20_000, 'f1'),
      ],
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '118', MATCH_START + 10_000, 'e1', 'h'),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, '118', MATCH_START + 19_500, 'e1', 'h'),
      ],
    });
    const friend = makeUnit('f1', {
      damageIn: [{ logLine: { timestamp: MATCH_START + 15_000 }, effectiveAmount: -100_000 }] as any,
    });
    const enemy = makeUnit('e1');
    (enemy as any).id = 'e1';

    const res = detectHealingGaps(healer as any, [healer, friend] as any, [enemy] as any, makeCombat());
    expect(res).toHaveLength(0);
  });

  it('handles overlapping CC correctly using merged intervals (B82)', () => {
    const healer = makeUnit('h', {
      spellCastEvents: [
        makeSpellCastEvent('2061', MATCH_START + 10_000, 'f1'),
        makeSpellCastEvent('2061', MATCH_START + 30_000, 'f1'),
      ],
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '853', MATCH_START + 10_000, 'e1', 'h'),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, '853', MATCH_START + 16_000, 'e1', 'h'),
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, '118', MATCH_START + 14_000, 'e1', 'h'),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, '118', MATCH_START + 20_000, 'e1', 'h'),
      ],
    });
    const friend = makeUnit('f1', {
      damageIn: [{ logLine: { timestamp: MATCH_START + 15_000 }, effectiveAmount: -100_000 }] as any,
    });
    const enemy = makeUnit('e1');
    (enemy as any).id = 'e1';

    const res = detectHealingGaps(healer as any, [healer, friend] as any, [enemy] as any, makeCombat());
    expect(res).toHaveLength(1);
    expect(res[0].freeCastSeconds).toBe(10);
  });

  it('suppresses gaps at match start (B19)', () => {
    const healer = makeUnit('h', {
      spellCastEvents: [makeSpellCastEvent('2061', MATCH_START + 4000, 'f1')],
    });
    const friend = makeUnit('f1', {
      damageIn: [{ logLine: { timestamp: MATCH_START + 2000 }, effectiveAmount: -100_000 }] as any,
    });
    const res = detectHealingGaps(healer as any, [healer, friend] as any, [makeUnit('e')], makeCombat());
    expect(res).toHaveLength(0);
  });

  it('clips the tail gap at the healer death — no inactivity charged after death (B137)', () => {
    // Healer's last cast is at 10s; it dies at 20s. The tail gap would otherwise run to match end
    // (60s) and charge 50s of inactivity + count post-death damage. It must clip at the 20s death.
    const healer = makeUnit('h', {
      spec: CombatUnitSpec.Priest_Holy,
      spellCastEvents: [makeSpellCastEvent('2061', MATCH_START + 10_000, 'f1', 'Friend', 'h', 'Priest')],
    });
    (healer as any).deathRecords = [{ timestamp: MATCH_START + 20_000 }];

    const friend = makeUnit('f1', {
      spec: CombatUnitSpec.Warrior_Arms,
      damageIn: [
        { logLine: { timestamp: MATCH_START + 15_000 }, effectiveAmount: -100_000 }, // before death — counts
        { logLine: { timestamp: MATCH_START + 30_000 }, effectiveAmount: -200_000 }, // after death — excluded
      ] as any,
    });
    const enemy = makeUnit('e1');

    const res = detectHealingGaps(healer as any, [healer, friend] as any, [enemy] as any, makeCombat());
    expect(res).toHaveLength(1);
    expect(res[0].toSeconds).toBe(20); // clipped at the death, not match end (60s)
    expect(res[0].durationSeconds).toBe(10);
    expect(res[0].mostDamagedAmount).toBe(100_000); // the 200k post-death hit is excluded
  });

  it('drops a phantom tail gap opened by a post-death HoT tick (B137)', () => {
    // Healer's last cast is 10s; it dies at 15s; a pre-death HoT ticks at 18s (post-mortem), which
    // would otherwise start a phantom gap 18s -> match end. That gap begins after death and must be
    // dropped entirely, even though the teammate is hammered afterward.
    const healer = makeUnit('h', {
      spec: CombatUnitSpec.Monk_Mistweaver,
      spellCastEvents: [makeSpellCastEvent('2061', MATCH_START + 10_000, 'f1', 'Friend', 'h', 'Monk')],
    });
    (healer as any).deathRecords = [{ timestamp: MATCH_START + 15_000 }];
    (healer as any).healOut = [{ logLine: { timestamp: MATCH_START + 18_000 } }]; // Renewing Mist tick post-death

    const friend = makeUnit('f1', {
      spec: CombatUnitSpec.Warrior_Arms,
      damageIn: [{ logLine: { timestamp: MATCH_START + 30_000 }, effectiveAmount: -300_000 }] as any, // all post-death
    });

    const res = detectHealingGaps(healer as any, [healer, friend] as any, [makeUnit('e1')] as any, makeCombat());
    expect(res).toHaveLength(0); // no inactivity charged — the only pressure is after the healer died
  });
});

describe('healingGaps — formatting', () => {
  it('formatHealingGapsForContext handles empty and populated states', () => {
    expect(formatHealingGapsForContext([])).toContain('  None detected.');

    const gap: any = {
      fromSeconds: 10,
      toSeconds: 20,
      durationSeconds: 10,
      freeCastSeconds: 5,
      mostDamagedName: 'Player1',
      mostDamagedSpec: 'Warrior',
      mostDamagedAmount: 150000,
    };
    const res = formatHealingGapsForContext([gap]);
    expect(res.join('\n')).toContain('[INACTIVITY] From 0:10 to 0:20 (10.0s duration, 5.0s free window)');
    expect(res.join('\n')).toContain('Warrior (Player1) took 150k damage');
  });
});
