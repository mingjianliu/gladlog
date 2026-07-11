import { describe, expect, it } from "vitest";
import { enemyCompArchetype } from "./enemyCompArchetype";
import { CombatUnitSpec } from "@gladlog/parser-compat";

// 用 spec id 构造敌方单位;isMeleeSpec/isHealerSpec 按 gladlog 的 CombatUnitSpec 判定。
// spec 常量取自 @gladlog/parser-compat 的 CombatUnitSpec(实现者 import 真值):
//   melee dps 例:Warrior_Arms;ranged dps 例:Mage_Frost;healer 例:Paladin_Holy。
function u(spec: CombatUnitSpec): any {
  return { spec, type: 1 };
}

describe("enemyCompArchetype", () => {
  it("two melee dps -> melee_cleave", () => {
    // 两个近战 dps + 一个治疗
    expect(
      enemyCompArchetype([
        u(CombatUnitSpec.Warrior_Arms),
        u(CombatUnitSpec.Warrior_Arms),
        u(CombatUnitSpec.Paladin_Holy),
      ]),
    ).toBe("melee_cleave");
  });
  it("two ranged dps -> caster_cleave", () => {
    expect(
      enemyCompArchetype([
        u(CombatUnitSpec.Mage_Frost),
        u(CombatUnitSpec.Mage_Frost),
        u(CombatUnitSpec.Paladin_Holy),
      ]),
    ).toBe("caster_cleave");
  });
  it("one melee + one ranged dps -> hybrid", () => {
    expect(
      enemyCompArchetype([
        u(CombatUnitSpec.Warrior_Arms),
        u(CombatUnitSpec.Mage_Frost),
        u(CombatUnitSpec.Paladin_Holy),
      ]),
    ).toBe("hybrid");
  });
  it("no dps (edge) -> other", () => {
    expect(enemyCompArchetype([u(CombatUnitSpec.Paladin_Holy)])).toBe("other");
  });
});
