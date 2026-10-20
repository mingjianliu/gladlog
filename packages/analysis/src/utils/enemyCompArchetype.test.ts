import { CombatUnitSpec } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { enemyCompArchetype } from "./enemyCompArchetype";

// Build enemy units from spec ids; isMeleeSpec/isHealerSpec decide based on
// gladlog's CombatUnitSpec. The spec constants come from CombatUnitSpec in
// @gladlog/parser-compat (import the real values, do not hardcode):
//   melee dps e.g. Warrior_Arms; ranged dps e.g. Mage_Frost; healer e.g.
//   Paladin_Holy.
function u(spec: CombatUnitSpec): any {
  return { spec, type: 1 };
}

describe("enemyCompArchetype", () => {
  it("two melee dps -> melee_cleave", () => {
    // two melee dps + one healer
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
