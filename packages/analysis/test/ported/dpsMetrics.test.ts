/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";

import { computeDpsMetrics } from "../../src/utils/dpsMetrics";
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
        // 爆发 1(10s):目标掉血 90→35 → 转化;目标挂盾 → intoDefensive
        makeSpellCastEvent("31884", MATCH_START + 10_000, "p1", "S", "p1", "Ret", 0, "Avenging Wrath"),
        // 爆发 2(80s):无伤害 → 不转化、无减伤标记
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
    expect(m.burstConversionRate).toBeCloseTo(0.5, 5); // 1/2 转化
    expect(m.burstIntoDefensiveRatio).toBeCloseTo(0.5, 5); // 爆发 1 挂盾
    expect(m.alignedBurstRatio).toBeCloseTo(0.5, 5); // 爆发 1 有 Combustion 重叠
    expect(m.firstBurstSeconds).toBe(10);
    expect(m.kickLandedRate).toBeNull(); // 无 kick
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
