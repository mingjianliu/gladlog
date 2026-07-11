import { describe, expect, it } from "vitest";
import { CombatUnitSpec } from "@gladlog/parser-compat";
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
    const recs = combatToRecords(synthCombat());
    expect(recs.length).toBe(1); // 只有 Friendly 的 Resto Shaman
    const r = recs[0];
    expect(r.spec).toBeTruthy();
    expect(r.bracket).toBe("3v3");
    expect(r.archetype).toBe("melee_cleave"); // 2 敌方近战 dps
    expect(typeof r.metrics.offensiveIndex).toBe("number");
    for (const c of r.crisisEvents) expect(c).toMatch(/^[\x00-\x7F]*$/);
  });
  it("returns [] when no Friendly healer is present", () => {
    const c = synthCombat();
    // 把 Friendly 治疗换成近战 → 无 Friendly healer
    c.units["Me-Realm-US"].spec = WARRIOR;
    expect(combatToRecords(c)).toEqual([]);
  });
});
