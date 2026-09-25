import { describe, expect, it } from "vitest";

import { DR_CATEGORIES_GENERATED } from "../src/data/drCategoriesGenerated";
import { ccSpellIds } from "../src/data/spellTags";
import {
  DR_CATEGORY_MAP,
  drCategoryIds,
  drCategoryOfCast,
  getDRCategory,
  getDRLevel,
} from "../src/utils/drAnalysis";
import { ccMechanicOf } from "../src/utils/spellMechanics";

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

// GH #111 (2026-09-25): the shared CC evaluator looked DR up by the CAST id,
// and three casts differ from the aura the log applies — their DR read Full
// forever in [PEEL OPTION] / [CC BOOKMARK].
describe("drCategoryOfCast (GH #111 — cast id → the applied aura's DR)", () => {
  it("resolves the three split casts to their aura's category", () => {
    expect(drCategoryOfCast("46968")).toBe(getDRCategory("132168")); // Shockwave
    expect(drCategoryOfCast("192058")).toBe(getDRCategory("118905")); // Capacitor Totem
    expect(drCategoryOfCast("5782")).toBe(getDRCategory("118699")); // Fear
    expect(drCategoryOfCast("46968")).toBe("Stun");
    // a cast whose id already is the aura id is untouched
    expect(drCategoryOfCast("853")).toBe(getDRCategory("853"));
  });

  // The evaluator's own filter shape: prior CC auras on the target whose
  // category equals the cast's category. One prior stun (Storm Bolt's aura)
  // must make a Shockwave land at 50 %, two at Immune — the codex astra
  // reproduction that read Full / Full before the fix.
  it("a prior stun diminishes Shockwave", () => {
    const cat = drCategoryOfCast("46968");
    const t0 = 1_000_000;
    const history = [
      { applyMs: t0, removeMs: t0 + 3000, spellId: "132169" },
      { applyMs: t0 + 5000, removeMs: t0 + 6500, spellId: "132168" },
    ].filter((h) => getDRCategory(h.spellId) === cat);
    expect(history).toHaveLength(2);
    expect(getDRLevel(history.slice(0, 1), t0 + 4000).level).toBe("50%");
    expect(getDRLevel(history, t0 + 7000).level).toBe("Immune");
  });

  // Completeness gate (Curated-List Completeness Rule): every CC id with a
  // known mechanic must resolve to a real DR category through
  // drCategoryOfCast, unless it is a declared self-DR spell. A new cast/aura
  // split then fails here instead of silently reading Full DR.
  it("no CC id with a mechanic falls back to a self-DR key unless declared", () => {
    const SELF_DR = new Set([
      "22703", // Infernal Awakening — shares no DR family (drShareScan, 5d6347e3)
    ]);
    const unresolved = [...ccSpellIds].filter(
      (id) =>
        ccMechanicOf(id) !== undefined &&
        drCategoryOfCast(id).startsWith("spell:") &&
        !SELF_DR.has(id),
    );
    expect(unresolved).toEqual([]);
  });
});
