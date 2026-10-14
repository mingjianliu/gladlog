/**
 * WO3 #18 (r1008-105, 9e9f9565): the pet kit's control label is the DR
 * category the rest of the prompt prints for the same control — the kit read
 * "Seduction (incapacitate)" beside "Seduction [Disorient]".
 */
import { describe, expect, it } from "vitest";

import { WARLOCK_PET_FUNCTION } from "../src/data/warlockPets";
import { getDRCategory } from "../src/utils/drAnalysis";

describe("WARLOCK_PET_FUNCTION control labels", () => {
  it("Seduction's label is its DR category", () => {
    const cat = getDRCategory("6358").toLowerCase();
    for (const id of ["1863", "184600"])
      expect(WARLOCK_PET_FUNCTION[id]!.does).toBe(`Seduction (${cat})`);
  });
});
