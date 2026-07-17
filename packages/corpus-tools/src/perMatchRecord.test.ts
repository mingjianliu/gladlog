import { CombatUnitReaction, CombatUnitSpec } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import type { KeystoneGate } from "./keystoneGates";
import { combatToRecords } from "./perMatchRecord";

const SHAMAN = CombatUnitSpec.Shaman_Restoration;
const WARRIOR = CombatUnitSpec.Warrior_Arms;
const PALADIN = CombatUnitSpec.Paladin_Holy;

// 合成一场:1 Friendly 治疗(Resto Shaman)+ 2 Hostile 近战 dps + 1 Hostile 治疗。
// 字段取 computeHealerMetrics/extractRotations 实际读到的最小集(同 T1 stub 手法)。
// reaction:CombatUnitReaction.Friendly=1,Hostile=2。type:Player=1。
function unit(name: string, spec: string, reaction: number): any {
  return {
    id: name,
    name,
    spec,
    type: 1,
    reaction,
    damageOut: [],
    healOut: [],
    absorbsOut: [],
    damageIn: [],
    spellCastEvents: [],
    actionIn: [],
    auraEvents: [],
    advancedActions: [],
    deathRecords: [],
    info: { teamId: reaction === 1 ? "0" : "1" },
  };
}
function synthCombat(): any {
  const healer = unit("Me-Realm-US", SHAMAN, 1);
  const eMelee1 = unit("E1-Realm-US", WARRIOR, 2);
  const eMelee2 = unit("E2-Realm-US", WARRIOR, 2);
  const eHealer = unit("EH-Realm-US", PALADIN, 2);
  return {
    units: {
      [healer.name]: healer,
      [eMelee1.name]: eMelee1,
      [eMelee2.name]: eMelee2,
      [eHealer.name]: eHealer,
    },
    startTime: 0,
    endTime: 120000,
    playerId: "Me-Realm-US",
    startInfo: { bracket: "3v3", zoneId: 1 },
  };
}

describe("combatToRecords", () => {
  it("emits one record per Friendly healer with in-domain metrics + comp archetype", () => {
    const recs = combatToRecords(synthCombat(), []);
    expect(recs.length).toBe(1); // 只有 Friendly 的 Resto Shaman
    const r = recs[0];
    expect(r.spec).toBeTruthy();
    expect(r.bracket).toBe("3v3");
    expect(r.archetype).toBe("melee_cleave"); // 2 敌方近战 dps
    expect(typeof r.metrics.offensiveIndex).toBe("number");
    for (const c of r.crisisEvents) expect(c).toMatch(/^[\x00-\x7F]*$/);
  });
  it("Friendly 非治疗照样出记录(DPS 指标组,pro-comparison P1)", () => {
    const c = synthCombat();
    // 把 Friendly 治疗换成近战 → 出的是 IDpsMetrics 记录而非 []
    c.units["Me-Realm-US"].spec = WARRIOR;
    const recs = combatToRecords(c, []);
    expect(recs).toHaveLength(1);
    const m = recs[0]!.metrics as Record<string, unknown>;
    expect(typeof m.burstCount).toBe("number");
    expect("offensiveIndex" in m).toBe(false);
  });
});

const discGate: KeystoneGate = {
  spec: "Discipline Priest",
  keystoneNodeIds: [82585],
  match: "any",
  metric: "offensiveIndex",
  groupPresent: "offensive",
  groupAbsent: "standard",
};

// Minimal synthetic combat with one Friendly Disc Priest healer carrying talents.
// actionIn/auraEvents are required beyond the brief's literal fields: computeHealerMetrics
// reads them (via cooldowns/ccTrinketAnalysis/enemyCDs) and throws without them, matching
// the field set already used by the sibling stubs in this file and in
// packages/analysis/src/utils/healerMetrics.test.ts.
function combatWithDiscTalents(talentIds: number[]): any {
  const healer = {
    id: "h1",
    name: "H-Realm-US",
    type: 1, // Player
    reaction: CombatUnitReaction.Friendly,
    spec: CombatUnitSpec.Priest_Discipline,
    info: {
      teamId: "0",
      talents: talentIds.map((id1) => ({ id1, id2: 0, count: 1 })),
    },
    damageOut: [],
    healOut: [],
    absorbsOut: [],
    spellCastEvents: [],
    actionIn: [],
    auraEvents: [],
    advancedActions: [],
    deathRecords: [],
    damageIn: [],
  };
  const enemy = {
    id: "e1",
    name: "E-Realm-US",
    type: 1,
    reaction: CombatUnitReaction.Hostile,
    spec: CombatUnitSpec.Warrior_Arms,
    info: { teamId: "1" },
    damageOut: [],
    healOut: [],
    absorbsOut: [],
    spellCastEvents: [],
    actionIn: [],
    auraEvents: [],
    advancedActions: [],
    deathRecords: [],
    damageIn: [],
  };
  return {
    units: { h1: healer, e1: enemy },
    startTime: 0,
    endTime: 60000,
    startInfo: { bracket: "2v2" },
  };
}

describe("combatToRecords buildGroup", () => {
  it("assigns groupPresent when the healer has a keystone node", () => {
    const recs = combatToRecords(combatWithDiscTalents([82585, 999]), [
      discGate,
    ]);
    expect(recs).toHaveLength(1);
    expect(recs[0].buildGroup).toBe("offensive");
  });
  it("assigns groupAbsent when the healer lacks the keystone", () => {
    const recs = combatToRecords(combatWithDiscTalents([111, 222]), [discGate]);
    expect(recs[0].buildGroup).toBe("standard");
  });
  it("assigns '*' when the spec is not gated", () => {
    const recs = combatToRecords(combatWithDiscTalents([82585]), []);
    expect(recs[0].buildGroup).toBe("*");
  });
});
