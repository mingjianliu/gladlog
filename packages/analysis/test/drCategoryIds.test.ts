import { describe, expect, it } from "vitest";

import { DR_CATEGORIES_GENERATED } from "../src/data/drCategoriesGenerated";
import { DR_CATEGORY_MAP, drCategoryIds } from "../src/utils/drAnalysis";

// GH #33: the per-category id set must be the product's view (override layer
// applied), not the raw DB2 arrays.
describe("drCategoryIds (GH #33 — inverse of DR_CATEGORY_MAP)", () => {
  it("applies the override layer: Sin and Punishment (blank in DB2) is Horror", () => {
    expect(
      Object.values(DR_CATEGORIES_GENERATED).some((ids) =>
        ids.includes("323467"),
      ),
    ).toBe(false);
    expect(drCategoryIds("Horror").has("323467")).toBe(true);
  });

  // Reliability audit C5 (2026-09-25): the two overrides this test used to
  // pin ("Cyclone is its own category", "Incapacitating Roar is Disorient")
  // were contradicted by the log — drShareScan.ts on 605 files: Cyclone after
  // Disorient full 19 % (n=93) vs 69 % baseline; Roar after Incapacitate 9 %
  // (n=35) vs 53 % after Disorient. Pin the DB2 categories so the overrides
  // cannot come back without new evidence.
  it("Cyclone is Disorient and Incapacitating Roar is Incapacitate, as in DB2", () => {
    expect(DR_CATEGORIES_GENERATED.disorient).toContain("33786");
    expect(drCategoryIds("Disorient").has("33786")).toBe(true);
    expect(drCategoryIds("Cyclone").size).toBe(0);

    expect(DR_CATEGORIES_GENERATED.incapacitate).toContain("99");
    expect(drCategoryIds("Incapacitate").has("99")).toBe(true);
    expect(drCategoryIds("Disorient").has("99")).toBe(false);
  });

  it("is exactly the inverse of DR_CATEGORY_MAP", () => {
    for (const label of new Set(Object.values(DR_CATEGORY_MAP))) {
      const ids = drCategoryIds(label);
      for (const [id, cat] of Object.entries(DR_CATEGORY_MAP))
        expect(ids.has(id)).toBe(cat === label);
    }
  });
});
