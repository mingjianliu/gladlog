/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";

import {
  computeDpsMetrics,
  CONVERTED_HP_DROP_PT,
  isBurstConverted,
} from "../../src/utils/dpsMetrics";
import {
  makeAdvancedAction,
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./testHelpers";

const MATCH_START = 1_000_000;
const info = { teamId: "0", specId: "x" } as any;

function dmgOut(timestamp: number, amount: number, destUnitId: string): any {
  return {
    logLine: { event: LogEvent.SPELL_DAMAGE, timestamp, parameters: [] },
    timestamp,
    effectiveAmount: amount,
    amount,
    srcUnitId: "p1",
    destUnitId,
    destUnitName: destUnitId,
    spellId: "1",
    spellName: "T",
  };
}

describe("computeDpsMetrics(pro-comparison P1)", () => {
  it("爆发/转化/免疫/协同/首爆秒数全链路", () => {
    const player = makeUnit("p1", {
      name: "Ret",
      spec: CombatUnitSpec.Paladin_Retribution,
      info,
      spellCastEvents: [
        // Burst 1 (10s): target HP drops 90→35 → converted; target pops a
        // shield → intoDefensive
        makeSpellCastEvent("31884", MATCH_START + 10_000, "p1", "S", "p1", "Ret", 0, "Avenging Wrath"),
        // Burst 2 (80s): no damage → not converted, no mitigation flag
        makeSpellCastEvent("31884", MATCH_START + 80_000, "p1", "S", "p1", "Ret", 0, "Avenging Wrath"),
      ],
      damageOut: [dmgOut(MATCH_START + 12_000, -50_000, "e1")],
    } as any);
    const ally = makeUnit("f2", {
      name: "Mage",
      spec: CombatUnitSpec.Mage_Fire,
      info,
      spellCastEvents: [
        makeSpellCastEvent("190319", MATCH_START + 12_000, "f2", "S", "f2", "Mage", 0, "Combustion"),
      ],
    } as any);
    const e1 = makeUnit("e1", {
      name: "Victim",
      info,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "642", MATCH_START + 11_000, "e1", "e1", "BUFF"),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, "642", MATCH_START + 15_000, "e1", "e1", "BUFF"),
      ],
      advancedActions: [
        makeAdvancedAction(MATCH_START + 10_000, 0, 0, 100, 90),
        makeAdvancedAction(MATCH_START + 30_000, 0, 0, 100, 35),
      ],
    } as any);
    const combat = {
      startTime: MATCH_START,
      endTime: MATCH_START + 120_000,
      units: { p1: player, f2: ally, e1 },
    } as any;

    const m = computeDpsMetrics(combat, "Ret");
    expect(m.burstCount).toBe(2);
    expect(m.burstConversionRate).toBeCloseTo(0.5, 5); // 1 of 2 converted
    expect(m.burstIntoDefensiveRatio).toBeCloseTo(0.5, 5); // burst 1 hit a shield
    expect(m.alignedBurstRatio).toBeCloseTo(0.5, 5); // burst 1 overlaps Combustion
    expect(m.firstBurstSeconds).toBe(10);
    expect(m.kickLandedRate).toBeNull(); // no interrupts
  });

  it("无爆发/找不到玩家 → 全 null/0,不抛", () => {
    const player = makeUnit("p1", { name: "Ret", info } as any);
    const e1 = makeUnit("e1", {
      name: "E",
      info,
      reaction: CombatUnitReaction.Hostile,
    } as any);
    const combat = {
      startTime: MATCH_START,
      endTime: MATCH_START + 60_000,
      units: { p1: player, e1 },
    } as any;
    const m = computeDpsMetrics(combat, "Ret");
    expect(m.burstCount).toBe(0);
    expect(m.burstConversionRate).toBeNull();
    expect(computeDpsMetrics(combat, "Nobody").burstCount).toBe(0);
  });
});

describe("isBurstConverted — single-source burst conversion predicate", () => {
  it("pins CONVERTED_HP_DROP_PT to 20 percentage points", () => {
    expect(CONVERTED_HP_DROP_PT).toBe(20);
  });

  it("returns true whenever target died inside the window", () => {
    expect(isBurstConverted({ died: true, hpStartPct: null, hpEndPct: null })).toBe(true);
    expect(isBurstConverted({ died: true, hpStartPct: 100, hpEndPct: 100 })).toBe(true);
    expect(isBurstConverted({ died: true, hpStartPct: 50, hpEndPct: 10 })).toBe(true);
  });

  it("returns true when net HP drop >= 20 percentage points", () => {
    // Exact threshold boundary
    expect(isBurstConverted({ died: false, hpStartPct: 100, hpEndPct: 80 })).toBe(true);
    // Well above threshold
    expect(isBurstConverted({ died: false, hpStartPct: 90, hpEndPct: 35 })).toBe(true);
  });

  it("returns false when net HP drop < 20 percentage points", () => {
    // 19 points drop
    expect(isBurstConverted({ died: false, hpStartPct: 100, hpEndPct: 81 })).toBe(false);
    // Flat
    expect(isBurstConverted({ died: false, hpStartPct: 70, hpEndPct: 70 })).toBe(false);
    // Healed during burst
    expect(isBurstConverted({ died: false, hpStartPct: 40, hpEndPct: 60 })).toBe(false);
  });

  it("returns false when either HP reading is null without death", () => {
    expect(isBurstConverted({ died: false, hpStartPct: null, hpEndPct: 50 })).toBe(false);
    expect(isBurstConverted({ died: false, hpStartPct: 80, hpEndPct: null })).toBe(false);
    expect(isBurstConverted({ died: false, hpStartPct: null, hpEndPct: null })).toBe(false);
  });
});

