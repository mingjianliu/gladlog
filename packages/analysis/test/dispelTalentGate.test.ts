import { CombatUnitSpec } from "@gladlog/parser-compat";
import { describe, expect, it, vi } from "vitest";

import { canDefensiveCleanse } from "../src/utils/dispelAnalysis";

// Talent reads stubbed: "IMPROVED" holds Improved Purify, "PLAIN" does not,
// null = no parsed loadout.
vi.mock("../src/utils/talents", () => ({
  getPlayerTalentedSpellIds: (_spec: unknown, talents: unknown) =>
    talents === "IMPROVED"
      ? new Set(["390632"])
      : talents === "PLAIN"
        ? new Set<string>()
        : null,
  getSpecTalentTreeSpellIds: () => new Set(["390632", "213634"]),
  isLoadoutFullyResolved: () => true,
  choiceSelectionResolved: () => true,
  getSpecFreeOrEntrySpellIds: () => new Set<string>(),
}));

const priest = (talents: unknown) =>
  ({ spec: CombatUnitSpec.Priest_Discipline, info: { talents } }) as never;

/**
 * DISPEL_TYPE_TALENT_GATES (talent impact audit 2026-09-26): Purify removes
 * disease only with Improved Purify (taken by 8 % of Discipline priests).
 */
describe("dispel type talent gate", () => {
  it("没点强化纯净术 → 不能驱散疾病,魔法照旧", () => {
    expect(canDefensiveCleanse(priest("PLAIN"), "Disease")).toBe(false);
    expect(canDefensiveCleanse(priest("PLAIN"), "Magic")).toBe(true);
  });
  it("点了 → 能驱散疾病", () => {
    expect(canDefensiveCleanse(priest("IMPROVED"), "Disease")).toBe(true);
  });
  it("天赋未知 → 不据缺失数据下结论(保持能)", () => {
    expect(canDefensiveCleanse(priest(undefined), "Disease")).toBe(true);
    // codex review: an empty loadout is "unknown", not "took nothing"
    expect(canDefensiveCleanse(priest([]), "Disease")).toBe(true);
  });
});
