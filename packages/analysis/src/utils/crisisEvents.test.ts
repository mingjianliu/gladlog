import { describe, expect, it } from "vitest";
import { extractRotations } from "./crisisEvents";

function stubUnit(): any {
  return {
    name: "H-Realm-US",
    spellCastEvents: [],
    deathRecords: [],
    damageIn: [],
  };
}
function stubMatch(): any {
  return { units: {}, startTime: 0, endTime: 60000 };
}

describe("extractRotations", () => {
  it("returns empty rotation arrays for a unit with no casts", () => {
    const r = extractRotations(stubUnit(), stubMatch());
    expect(r.opener).toEqual([]);
    expect(r.coreSequences).toEqual([]);
    expect(r.crisisEvents).toEqual([]);
  });
  it("crisisEvents entries are ASCII (English spell names)", () => {
    const r = extractRotations(stubUnit(), stubMatch());
    for (const c of r.crisisEvents) expect(c).toMatch(/^[\x00-\x7F]*$/);
  });
});
