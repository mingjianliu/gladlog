/**
 * The one cast → effect-aura table (triage 2026-09-29 G3, ruling A10 = both:
 * DB2 nominates, the corpus verifies). It absorbed the hand list
 * `CC_CAST_EFFECT_AURA` (GH #111 / reliability round 2 W1g); every one of
 * those 14 rows must still resolve the same way through the DR view, and the
 * pairs the hand list could not hold must be there.
 */
import { describe, expect, it } from "vitest";

import generated from "../src/data/castEffectAuraGenerated.json";
import {
  castAndEffectIds,
  castEffectPairs,
  castsOfEffectAura,
  effectAurasOfCast,
  isCastOrEffect,
} from "../src/data/castEffectAuras";
import {
  drCategoryKnown,
  drCategoryOfCast,
  drEffectAuraOfCast,
  drEffectAurasOfCast,
  getDRCategory,
} from "../src/utils/drAnalysis";

/** The hand list as it stood on 2026-10-02 (drAnalysis.ts, 14 rows). */
const FORMER_HAND_ROWS: Record<string, string> = {
  "46968": "132168", // Shockwave
  "192058": "118905", // Capacitor Totem → Static Charge
  "5782": "118699", // Fear
  "187650": "3355", // Freezing Trap
  "109248": "117526", // Binding Shot → stun
  "19577": "24394", // Intimidation
  "474421": "24394", // Intimidation (12.x id)
  "115750": "105421", // Blinding Light
  "113724": "82691", // Ring of Frost
  "207684": "207685", // Sigil of Misery
  "22570": "203123", // Maim
  "305483": "305485", // Lightning Lasso
  "198898": "198909", // Song of Chi-Ji
  "389794": "389831", // Snowdrift
};

describe("castEffectAuras — the generated cast → effect table", () => {
  it("every former hand row resolves to the same DR-bearing aura and DR category", () => {
    for (const [cast, aura] of Object.entries(FORMER_HAND_ROWS)) {
      expect(effectAurasOfCast(cast), cast).toContain(aura);
      expect(drEffectAuraOfCast(cast), cast).toBe(aura);
      expect(drCategoryOfCast(cast), cast).toBe(getDRCategory(aura));
    }
  });

  it("holds what the single-valued hand list could not (enemy-def F-E25b, F-E25a)", () => {
    // Storm Bolt's stun — its IMMUNE miss is logged under 132169
    expect(effectAurasOfCast("107570")).toContain("132169");
    expect(drCategoryOfCast("107570")).toBe(getDRCategory("132169"));
    // Freezing Trap: the plain trap and Diamond Ice
    expect(drEffectAurasOfCast("187650")).toEqual(
      expect.arrayContaining(["3355", "203337"]),
    );
    expect(isCastOrEffect("187650", "203337")).toBe(true);
    // Maim's MISS is logged under its stun (cc-dr F-TM1)
    expect(castAndEffectIds("22570").has("203123")).toBe(true);
  });

  it("the DR view skips an effect aura without a DR category (Binding Shot's tether)", () => {
    expect(effectAurasOfCast("109248")).toContain("117405");
    expect(drEffectAuraOfCast("109248")).toBe("117526");
  });

  it("a cast whose aura carries its own id has no row and answers for itself", () => {
    expect(effectAurasOfCast("853")).toEqual([]); // Hammer of Justice
    expect(drCategoryOfCast("853")).toBe(getDRCategory("853"));
    expect(isCastOrEffect("853", "853")).toBe(true);
    expect(isCastOrEffect("853", "132169")).toBe(false);
  });

  it("the inverse view and the pair list agree with the forward view", () => {
    expect(castsOfEffectAura("24394")).toEqual(
      expect.arrayContaining(["19577", "474421"]),
    );
    for (const [cast, aura] of castEffectPairs())
      expect(effectAurasOfCast(cast)).toContain(aura);
  });

  it("every row clears the rule stated in the file's meta (hits ≥ 10, mostly fast)", () => {
    const meta = (generated as { meta: { rule: string } }).meta;
    expect(meta.rule).toContain("covered share");
    for (const rows of Object.values(
      (
        generated as unknown as {
          casts: Record<
            string,
            Array<{ hits: number; hitsWithin3s: number; coveredShare: number }>
          >;
        }
      ).casts,
    ))
      for (const r of rows) {
        expect(r.hits).toBeGreaterThanOrEqual(10);
        expect(r.coveredShare).toBeGreaterThanOrEqual(0.5);
        expect(r.hitsWithin3s / r.hits).toBeGreaterThanOrEqual(0.5);
      }
  });
});

describe("a cast whose variants sit in different DR families (codex 35-CD-06)", () => {
  // Holy Word: Chastise 88625 → stun 200200 / incapacitate 200196
  it("is unknown without the caster's evidence — never the more popular family", () => {
    expect(effectAurasOfCast("88625")).toEqual(
      expect.arrayContaining(["200200", "200196"]),
    );
    expect(drCategoryOfCast("88625")).toBe("spell:88625");
    expect(drCategoryKnown("88625")).toBe(false);
  });
  it("takes the family of the variant the caster applied", () => {
    expect(drCategoryOfCast("88625", new Set(["200196"]))).toBe(
      getDRCategory("200196"),
    );
    expect(drCategoryOfCast("88625", new Set(["200200"]))).toBe(
      getDRCategory("200200"),
    );
    expect(drCategoryKnown("88625", new Set(["200200"]))).toBe(true);
    // both seen: still unknown
    expect(drCategoryOfCast("88625", new Set(["200196", "200200"]))).toBe(
      "spell:88625",
    );
  });
});
