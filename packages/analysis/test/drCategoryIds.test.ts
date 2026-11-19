import { describe, expect, it } from "vitest";

import { isFactOnlyHealerLockAura } from "../src/analysis/candidates/cooldownTiming";
import { classMetadata } from "../src/data/classSpells";
import { DR_CATEGORIES_GENERATED } from "../src/data/drCategoriesGenerated";
import { ccSpellIds } from "../src/data/spellTags";
import { SpellTag } from "../src/data/spellTypes";
import {
  computeIncomingDR,
  DR_CATEGORY_HAND_IDS,
  DR_CATEGORY_MAP,
  drCategoryIds,
  drCategoryKnown,
  drCategoryOfCast,
  getDRCategory,
  getDRLevel,
  hasNoDrFamily,
  isNamedDrCategory,
  isStunDrAura,
  SELF_DR_SPELL_IDS,
} from "../src/utils/drAnalysis";
import { ccMechanicOf } from "../src/utils/spellMechanics";

// GH #33: the per-category id set must be the product's view (override layer
// applied), not the raw DB2 arrays.
describe("drCategoryIds (GH #33 — inverse of DR_CATEGORY_MAP)", () => {
  it("applies the override layer: Champion's Spear (blank in DB2) is Stun", () => {
    expect(
      Object.values(DR_CATEGORIES_GENERATED).some((ids) =>
        ids.includes("376077"),
      ),
    ).toBe(false);
    expect(drCategoryIds("Stun").has("376077")).toBe(true);
    expect(DR_CATEGORY_HAND_IDS.has("376077")).toBe(true);
  });
  // T211 (GH #221 g5): this test pinned 323467 as "Horror" — an id with 0
  // rows on the 605. The aura the log writes is 87204, and it does not
  // diminish (45 of 77 repeats inside 18 s ran the full 3.0 s).
  it("Sin and Punishment is in no DR family: neither the dead id nor the live aura", () => {
    expect(DR_CATEGORY_MAP["323467"]).toBeUndefined();
    expect(DR_CATEGORY_MAP["87204"]).toBeUndefined();
    expect(drCategoryIds("Horror").size).toBe(0);
    expect(hasNoDrFamily("87204")).toBe(true);
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

  // codex review 45-FT-102 (2026-10-13): the supplement block filed 107079
  // Quaking Palm under "Stun" over DB2's Incapacitate, and the stun-only
  // readers pressed cooldowns through it. The override layer may fill an id
  // DB2 leaves blank; it may not contradict a category DB2 states.
  it("no entry contradicts the category DB2 states for the same id", () => {
    const official = new Map<string, string>();
    for (const [cat, ids] of Object.entries(DR_CATEGORIES_GENERATED))
      for (const id of ids) official.set(id, cat);
    const contradicting = Object.entries(DR_CATEGORY_MAP)
      .filter(([id, label]) => {
        const cat = official.get(id);
        return cat !== undefined && cat !== label.toLowerCase();
      })
      .map(([id, label]) => `${id}: ${label} vs DB2 ${official.get(id)}`);
    expect(contradicting).toEqual([]);
    expect(official.get("107079")).toBe("incapacitate");
    expect(getDRCategory("107079")).toBe("Incapacitate");
    expect(isStunDrAura("107079")).toBe(false);
    expect(isStunDrAura("20549")).toBe(true); // War Stomp stays a stun
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
    // W1g (2026-09-25): the roster's Control cooldowns too — CC USE / PEEL
    // OPTION sample them by their CAST id.
    const rosterControl = classMetadata.flatMap((c) =>
      c.abilities
        .filter((a) => a.tags.includes(SpellTag.Control))
        .map((a) => a.spellId),
    );
    // Controls whose aura carries no DR category in the log (two disarms, a
    // proc horror): the
    // samplers read them as DR "n/a" (drCategoryKnown) and never bookmark
    // them, so no false DR claim can come of it.
    const KNOWN_UNRESOLVED = new Set([
      "209749", // Faerie Swarm
      "407028", // Sticky Tar Bomb
      // Cascading Horrors (R48, T125): a horror with no official DR category;
      // no button applies it (a proc of 357714 / 357715), its line prints no
      // [DR:] tag
      "358861",
    ]);
    const unresolved = [...new Set([...ccSpellIds, ...rosterControl])].filter(
      (id) =>
        ccMechanicOf(id) !== undefined &&
        !drCategoryKnown(id) &&
        !KNOWN_UNRESOLVED.has(id),
    );
    expect(unresolved).toEqual([]);
    expect(SELF_DR_SPELL_IDS.has("22703")).toBe(true);
    // R48 (T125): Cascading Horrors is a control with no DR family and no
    // declared self-DR — its DR reads "n/a", its line carries no [DR:] tag
    expect(ccSpellIds.has("358861")).toBe(true);
    expect(drCategoryKnown("358861")).toBe(false);
    expect(SELF_DR_SPELL_IDS.has("358861")).toBe(false);
  });
});

// T125 (ruling R48; codex 85-tk-M-T125-2 #1 / #2): a control no DR family
// claims gets no DR tier and is a facts-only healer lock
describe("hasNoDrFamily — Cascading Horrors 358861", () => {
  it("is the one landing control with no DR family and no self-DR", () => {
    expect(hasNoDrFamily("358861")).toBe(true);
    expect(hasNoDrFamily("22703")).toBe(false); // Infernal Awakening: self-DR
    expect(hasNoDrFamily("8122")).toBe(false); // Psychic Scream: disorient
  });

  it("computeIncomingDR states no tier for it and keeps it out of every history", () => {
    // an application, its refresh and a third one 4 s apart: no Full / 50% /
    // Immune; the Psychic Scream beside them still reads its own family
    const drs = computeIncomingDR(
      [
        { atSeconds: 10, durationSeconds: 2, spellId: "358861" },
        { atSeconds: 14, durationSeconds: 2, spellId: "358861" },
        { atSeconds: 18, durationSeconds: 2, spellId: "358861" },
        { atSeconds: 19, durationSeconds: 4, spellId: "8122" },
      ],
      0,
    );
    expect(drs.slice(0, 3)).toEqual([null, null, null]);
    expect(drs[3]!.level).toBe("Full");
  });

  it("is a facts-only healer lock; a control with a DR family is not", () => {
    expect(isFactOnlyHealerLockAura("358861")).toBe(true);
    expect(isFactOnlyHealerLockAura("87204")).toBe(true); // Sin and Punishment
    expect(isFactOnlyHealerLockAura("8122")).toBe(false);
    expect(isFactOnlyHealerLockAura("22703")).toBe(false);
  });
});

describe("isNamedDrCategory — the chain line and the desktop CC chain panel (T125, codex 85-tk-M-T125-2b #2)", () => {
  it("states a tier only for a real DR family", () => {
    expect(isNamedDrCategory("Disorient")).toBe(true);
    expect(isNamedDrCategory("Unknown")).toBe(false);
    expect(isNamedDrCategory(getDRCategory("358861"))).toBe(false);
  });
});
