import { describe, expect, it } from "vitest";

import { SPELL_CATEGORIES } from "../src/data/spellCategories";

// User ruling R24 (2026-11-11): the other aura ids of two registered shields
// sit at their same-name ids' tier; Holy's proc Power Word: Shield stays out.
describe("T86 吸收盾的其余光环 id 与同名 id 同档", () => {
  it("两个 Unfolding Vision 副本与 17 / 1253593 同类型", () => {
    for (const id of ["1300008", "1300009"])
      expect(SPELL_CATEGORIES[id]?.type).toBe(SPELL_CATEGORIES["17"].type);
    expect(SPELL_CATEGORIES["1253593"].type).toBe(SPELL_CATEGORIES["17"].type);
  });
  it("Chi Cocoon 第三个 id 与另两个同类型", () => {
    expect(SPELL_CATEGORIES["406139"]?.type).toBe(SPELL_CATEGORIES["406220"].type);
    expect(SPELL_CATEGORIES["1260681"].type).toBe(SPELL_CATEGORIES["406220"].type);
  });
  it("神圣的触发盾 1246768 按裁决不登记", () => {
    expect(SPELL_CATEGORIES["1246768"]).toBeUndefined();
  });
});
