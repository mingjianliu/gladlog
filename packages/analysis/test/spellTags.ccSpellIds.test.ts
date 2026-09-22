import { describe, expect, it } from "vitest";

import { DR_CATEGORIES_GENERATED } from "../src/data/drCategoriesGenerated";
import {
  ccSpellIds,
  disarmSpellIds,
  rootSpellIds,
  trinketSpellIds,
} from "../src/data/spellTags";

// 2026-08-21 S2 archive (10,682 matches): 63 official-DR hard-CC ids were live
// in play and invisible to [CC] labels / cc-cooldown candidates because
// ccSpellIds was hand-typed only. Pin: official stun/incapacitate/disorient ids
// are CC; silences and roots are not folded in (they keep their own semantics).
describe("ccSpellIds = hand cc ∪ official hard-CC DR categories", () => {
  it("contains every official stun / incapacitate / disorient id", () => {
    for (const cat of ["stun", "incapacitate", "disorient"] as const)
      for (const id of DR_CATEGORIES_GENERATED[cat] ?? [])
        expect(ccSpellIds.has(id), `${cat} ${id}`).toBe(true);
  });
  it("covers the S2 gap examples that used to be missing", () => {
    for (const id of ["203337", "221527", "357768", "22570", "61305", "210873"])
      expect(ccSpellIds.has(id), id).toBe(true);
  });
  it("does not fold silences or roots into cc", () => {
    expect(ccSpellIds.has("47476")).toBe(false); // Strangulate — silence
    for (const id of rootSpellIds) expect(ccSpellIds.has(id), `root ${id}`).toBe(false);
  });
});

describe("disarmSpellIds", () => {
  it("contains canonical PvP disarms", () => {
    expect(disarmSpellIds.has("236077")).toBe(true); // Disarm (Warrior)
    expect(disarmSpellIds.has("233759")).toBe(true); // Grapple Weapon
    expect(disarmSpellIds.has("207777")).toBe(true); // Dismantle (Rogue PvP)
  });

  it("does not contain stuns or silences", () => {
    expect(disarmSpellIds.has("408")).toBe(false); // Kidney Shot
    expect(disarmSpellIds.has("15487")).toBe(false); // Silence
  });
});

describe("trinketSpellIds", () => {
  it("holds canonical Gladiator's Medallion 336126 and Adaptation 195756", () => {
    expect(trinketSpellIds).toEqual(["336126", "195756"]);
  });
});
