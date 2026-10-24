import { describe, expect, it } from "vitest";

import { absorbedHitSchoolMask } from "../src/utils/incomingPressure";

// predicate-index 2026-10-11 (an absorbed hit has no school): the school
// split read the SPELL_ABSORBED line's attack-school field, the `Top sources`
// tag read nothing — on the public wowarenalogs testlogs 13 entries made of
// absorbed hits printed no school; one reading now, 13 → 2.
const absorb = (attackSpellId: string | undefined, schoolParam?: string) => ({
  attackSpellId,
  logLine: {
    parameters: Object.assign([], { 10: schoolParam }) as unknown[],
  },
});

describe("absorbedHitSchoolMask", () => {
  it("reads the line's own attack-school field", () => {
    expect(absorbedHitSchoolMask(absorb("370966", "0x7c"), true)).toBe(0x7c);
  });
  it("falls back to the spell's official mask when the field is missing", () => {
    // Starsurge 78674 — Nature / Arcane
    expect(absorbedHitSchoolMask(absorb("78674"), true)).toBe(0x48);
  });
  it("a swing absorb is physical on a document that records attack spells", () => {
    expect(absorbedHitSchoolMask(absorb(undefined), true)).toBe(1);
  });
  it("unknown on a document that never records them", () => {
    expect(absorbedHitSchoolMask(absorb(undefined), false)).toBeUndefined();
  });
});
