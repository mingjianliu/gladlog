import { describe, expect, it } from "vitest";

import { cdWasteEvents,extractCandidateFindings } from "./candidateFindings";

// Synthetic combat: one Friendly death + one Hostile death. spec "256" is
// Priest_Discipline (a healer) with reaction 1 (Friendly).
function combat(): any {
  return {
    startTime: 0,
    endTime: 60000,
    units: {
      a: {
        id: "a",
        name: "Me-R",
        type: 1,
        reaction: 1,
        spec: "256",
        deathRecords: [{ timestamp: 30000 }],
        spellCastEvents: [],
        advancedActions: [],
        info: { teamId: "0" },
      },
      b: {
        id: "b",
        name: "Enemy-R",
        type: 1,
        reaction: 2,
        spec: "577",
        deathRecords: [{ timestamp: 45000 }],
        spellCastEvents: [],
        advancedActions: [],
        info: { teamId: "1" },
      },
    },
  };
}

describe("extractCandidateFindings", () => {
  it("emits a death CandidateEvent with a stable id, time, unit, and facts", () => {
    const evts = extractCandidateFindings(combat());
    const death = evts.find((e) => e.id === "death:a:30");
    expect(death).toBeTruthy();
    expect(death!.t).toBe(30);
    expect(death!.unitNames).toContain("Me-R");
    expect(death!.type).toBe("death");
    expect(death!.facts["t"]).toBe("30");
  });
  it("tags each death friendly/enemy so the LLM knows a kill from a loss", () => {
    const evts = extractCandidateFindings(combat());
    const mine = evts.find((e) => e.id === "death:a:30");
    const theirs = evts.find((e) => e.id === "death:b:45");
    expect(mine!.facts["side"]).toBe("friendly");
    expect(theirs!.facts["side"]).toBe("enemy");
  });
  it("excludes pet/guardian deaths (no COMBATANT_INFO) — players only", () => {
    const c = combat();
    // A warlock pet dies too, but has no `info` (not a real player).
    c.units.pet = {
      id: "pet",
      name: "Gzaadym",
      type: 3,
      reaction: 1,
      spec: "0",
      deathRecords: [{ timestamp: 20000 }],
      spellCastEvents: [],
      advancedActions: [],
    };
    const evts = extractCandidateFindings(c);
    expect(evts.some((e) => e.unitNames.includes("Gzaadym"))).toBe(false);
    // The two real player deaths are still present.
    expect(evts.filter((e) => e.type === "death")).toHaveLength(2);
  });
  it("returns [] for an empty combat without throwing", () => {
    expect(
      extractCandidateFindings({ startTime: 0, endTime: 1000, units: {} }),
    ).toEqual([]);
  });
});

describe("cdWasteEvents", () => {
  const healer = { id: "a", name: "Me-R" };

  it("emits a cd-waste event for a never-used survival cooldown", () => {
    const evts = cdWasteEvents(
      [
        {
          spellId: "33206",
          spellName: "Pain Suppression",
          neverUsed: true,
          isThroughput: false,
        },
      ],
      healer,
    );
    expect(evts).toHaveLength(1);
    expect(evts[0].id).toBe("cd-waste:a:33206");
    expect(evts[0].type).toBe("cd-waste");
    expect(evts[0].spell).toBe("Pain Suppression");
    expect(evts[0].facts).toEqual({ spell: "Pain Suppression", unit: "Me-R" });
  });
  it("skips a cooldown that was used", () => {
    const evts = cdWasteEvents(
      [
        {
          spellId: "33206",
          spellName: "Pain Suppression",
          neverUsed: false,
          isThroughput: false,
        },
      ],
      healer,
    );
    expect(evts).toEqual([]);
  });
  it("skips a never-used THROUGHPUT cooldown (not a survival wall)", () => {
    const evts = cdWasteEvents(
      [
        {
          spellId: "10060",
          spellName: "Power Infusion",
          neverUsed: true,
          isThroughput: true,
        },
      ],
      healer,
    );
    expect(evts).toEqual([]);
  });
});
