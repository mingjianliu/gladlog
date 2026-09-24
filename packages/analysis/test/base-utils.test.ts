import { CombatUnitClass, CombatUnitSpec } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { binarySearchClosest } from "../src/utils/binarySearch";
import { isHealerSpec } from "../src/utils/cooldowns";
import { computeDampening } from "../src/utils/dampening";
import {
  SIGNIFICANT_DAMAGE_HEAL_THRESHOLD,
  tankSpecs,
  Utils,
} from "../src/utils/utils";

describe("base utils", () => {
  it("binarySearchClosest 精确三例", () => {
    const arr = [{ t: 10 }, { t: 20 }, { t: 30 }];
    const get = (x: { t: number }) => x.t;
    expect(binarySearchClosest(arr, 9, get)?.t).toBe(10);
    expect(binarySearchClosest(arr, 21, get)?.t).toBe(20);
    expect(binarySearchClosest(arr, 31, get)?.t).toBe(30);
  });

  it("computeDampening:開局 ≥ 0 且随时间单調不减", () => {
    const d0 = computeDampening(0, "3v3", []);
    const d60 = computeDampening(60_000, "3v3", []);
    const d300 = computeDampening(300_000, "3v3", []);
    expect(d0).toBeGreaterThanOrEqual(0);
    expect(d60).toBeGreaterThanOrEqual(d0);
    expect(d300).toBeGreaterThanOrEqual(d60);
  });

  it("SIGNIFICANT_DAMAGE_HEAL_THRESHOLD: 钉死为 10,000", () => {
    expect(SIGNIFICANT_DAMAGE_HEAL_THRESHOLD).toBe(10_000);
  });

  it("isHealerSpec, tankSpecs: 规格与角色清单", () => {
    expect(isHealerSpec(CombatUnitSpec.Paladin_Holy)).toBe(true);
    expect(isHealerSpec(CombatUnitSpec.Priest_Discipline)).toBe(true);
    expect(isHealerSpec(CombatUnitSpec.Priest_Holy)).toBe(true);
    expect(isHealerSpec(CombatUnitSpec.Shaman_Restoration)).toBe(true);
    expect(isHealerSpec(CombatUnitSpec.Druid_Restoration)).toBe(true);
    expect(isHealerSpec(CombatUnitSpec.Monk_Mistweaver)).toBe(true);
    expect(isHealerSpec(CombatUnitSpec.Evoker_Preservation)).toBe(true);
    expect(isHealerSpec(CombatUnitSpec.Mage_Frost)).toBe(false);

    expect(tankSpecs).toHaveLength(6);
    expect(tankSpecs).toContain(CombatUnitSpec.Druid_Guardian);
    expect(tankSpecs).toContain(CombatUnitSpec.Monk_Brewmaster);
    expect(tankSpecs).toContain(CombatUnitSpec.Warrior_Protection);
    expect(tankSpecs).toContain(CombatUnitSpec.Paladin_Protection);
    expect(tankSpecs).toContain(CombatUnitSpec.DemonHunter_Vengeance);
    expect(tankSpecs).toContain(CombatUnitSpec.DeathKnight_Blood);
  });

  it("Utils.getSpecClass: 专精到职业的反查", () => {
    expect(Utils.getSpecClass(CombatUnitSpec.Paladin_Holy)).toBe(
      CombatUnitClass.Paladin,
    );
    expect(Utils.getSpecClass(CombatUnitSpec.Mage_Frost)).toBe(
      CombatUnitClass.Mage,
    );
    expect(Utils.getSpecClass(CombatUnitSpec.Evoker_Preservation)).toBe(
      CombatUnitClass.Evoker,
    );
    expect(Utils.getSpecClass(CombatUnitSpec.Rogue_Subtlety)).toBe(
      CombatUnitClass.Rogue,
    );
    expect(Utils.getSpecClass(CombatUnitSpec.None)).toBe(CombatUnitClass.None);
  });

  it("Utils.getSpecName & getClassName: 人类可读名称", () => {
    expect(Utils.getSpecName(CombatUnitSpec.Paladin_Holy)).toBe("Holy Paladin");
    expect(Utils.getSpecName(CombatUnitSpec.Warrior_Arms)).toBe("Arms Warrior");
    expect(Utils.getClassName(CombatUnitClass.DeathKnight)).toBe("DeathKnight");
  });

  it("Utils.filterNulls: 过滤空值", () => {
    expect(Utils.filterNulls([1, null, 2, undefined, 3, 0])).toEqual([1, 2, 3]);
  });
});
