import { describe, expect, it } from "vitest";
import { CombatUnitType, CombatUnitSpec } from "@gladlog/parser-compat";
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
  it("crisis line uses the ally's spec, not their (possibly non-ASCII) name", () => {
    // Regression: real ladder names like "Sløøsh-Tichondrius-US" are non-ASCII
    // and were leaking into the bundled corpus, failing the ASCII gate.
    const healer: any = {
      name: "Me-Realm-US",
      reaction: 1,
      spellCastEvents: [
        {
          spellId: 2061,
          spellName: "Flash Heal",
          logLine: { event: "SPELL_CAST_SUCCESS", timestamp: 11000 },
        },
      ],
      deathRecords: [],
      damageIn: [],
    };
    const ally: any = {
      id: "ally-1",
      name: "Sløøsh-Tichondrius-US",
      spec: CombatUnitSpec.Mage_Frost, // numeric spec id ('64')
      type: CombatUnitType.Player,
      reaction: 1,
      spellCastEvents: [],
      advancedActions: [
        {
          advanced: true,
          advancedActorId: "ally-1",
          advancedActorMaxHp: 100,
          advancedActorCurrentHp: 30,
          logLine: { timestamp: 10000 },
        },
      ],
    };
    const match: any = {
      units: { "ally-1": ally },
      startTime: 0,
      endTime: 60000,
    };
    const r = extractRotations(healer, match);
    expect(r.crisisEvents.length).toBe(1);
    const line = r.crisisEvents[0];
    expect(line).toMatch(/^[\x00-\x7F]*$/); // ASCII
    expect(line).toContain("Frost Mage"); // specToString('64')
    expect(line).not.toContain("Sløøsh");
    expect(line).toContain("Flash Heal");
  });
});
