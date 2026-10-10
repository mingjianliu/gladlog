/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  CombatUnitSpec,
  CombatUnitType,
  LogEvent,
} from "@gladlog/parser-compat";

import {
  computeDampening,
  computeDampeningTimeline,
  dampeningDangerMultiplier,
  dampeningRulesOf,
  formatDampeningForContext,
  getDampeningPercentage,
} from "../../src/utils/dampening";
import { makeAuraEvent, makeUnit } from "./testHelpers";

const MATCH_START = 1_000_000;

describe("dampening — rule detection", () => {
  it("identifies Rated Solo Shuffle rules (B69)", () => {
    expect(getDampeningPercentage("Rated Solo Shuffle", [], 0)).toBe(10);
  });

  it("identifies 2v2 with healers (B70)", () => {
    const p1 = makeUnit("p1", {
      spec: CombatUnitSpec.Priest_Discipline,
      info: { teamId: "0" },
    });
    const p2 = makeUnit("p2", {
      spec: CombatUnitSpec.Warrior_Arms,
      info: { teamId: "0" },
    });
    const p3 = makeUnit("p3", {
      spec: CombatUnitSpec.Paladin_Holy,
      info: { teamId: "1" },
    });
    const p4 = makeUnit("p4", {
      spec: CombatUnitSpec.Mage_Frost,
      info: { teamId: "1" },
    });

    expect(getDampeningPercentage("2v2", [p1, p2, p3, p4] as any, 0)).toBe(30);
  });

  it("identifies 2v2 double DPS (B71)", () => {
    const p1 = makeUnit("p1", {
      spec: CombatUnitSpec.Warrior_Arms,
      info: { teamId: "0" },
    });
    const p2 = makeUnit("p2", {
      spec: CombatUnitSpec.Mage_Frost,
      info: { teamId: "1" },
    });
    expect(getDampeningPercentage("2v2", [p1, p2] as any, 0)).toBe(10);
  });

  it("identifies 3v3 based on string or player count (B72)", () => {
    expect(getDampeningPercentage("Three vs Three", [], 0)).toBe(10);
    const players = [
      makeUnit("1"),
      makeUnit("2"),
      makeUnit("3"),
      makeUnit("4"),
      makeUnit("5"),
    ];
    expect(getDampeningPercentage("Unknown", players as any, 0)).toBe(10);
  });

  describe("FT-T13 D10: one classification, on players only", () => {
    const healer2v2 = () => [
      makeUnit("p1", {
        spec: CombatUnitSpec.Priest_Discipline,
        info: { teamId: "0" },
      }),
      makeUnit("p2", {
        spec: CombatUnitSpec.Warrior_Arms,
        info: { teamId: "0" },
      }),
      makeUnit("p3", {
        spec: CombatUnitSpec.Paladin_Holy,
        info: { teamId: "1" },
      }),
      makeUnit("p4", {
        spec: CombatUnitSpec.Hunter_BeastMastery,
        info: { teamId: "1" },
      }),
    ];
    const pet = (id: string) => ({
      ...makeUnit(id, { ownerId: "p4" }),
      type: CombatUnitType.Pet,
    });

    it("pets, totems and guardians in the unit list do not tip a 2v2 round into the 3v3 rules", () => {
      const players = healer2v2();
      const withPets = [...players, pet("pet1"), pet("totem1"), pet("g1")];
      expect(dampeningRulesOf("2v2", players as any)).toBe("2v2");
      expect(dampeningRulesOf("2v2", withPets as any)).toBe("2v2");
      // the same reading from both lists — the header read the first, the
      // press lines the second
      expect(getDampeningPercentage("2v2", withPets as any, 0)).toBe(
        getDampeningPercentage("2v2", players as any, 0),
      );
    });

    it("a bracket string that names no bracket falls back to the PLAYER count", () => {
      const players = healer2v2();
      const withPets = [...players, pet("pet1"), pet("totem1")];
      expect(dampeningRulesOf("", withPets as any)).toBe("2v2");
      expect(dampeningRulesOf(undefined, withPets as any)).toBe("2v2");
      expect(dampeningRulesOf("", [...players, makeUnit("p5")] as any)).toBe(
        "3v3",
      );
    });

    it("the literal 2v2 string is not overridden by a roster count", () => {
      const six = [...healer2v2(), makeUnit("p5"), makeUnit("p6")];
      expect(dampeningRulesOf("2v2", six as any)).toBe("2v2");
    });

    it("one side's events, the round's roster: the bracket is classified on the roster", () => {
      const players = healer2v2();
      const enemies = players.slice(2);
      // one side alone reads "double DPS" — which is why the roster is passed
      expect(dampeningRulesOf("2v2", enemies as any)).toBe("2v2_dps");
      expect(
        getDampeningPercentage("2v2", enemies as any, 0, players as any),
      ).toBe(getDampeningPercentage("2v2", players as any, 0));
      expect(computeDampening(0, "2v2", enemies as any, players as any)).toBe(
        computeDampening(0, "2v2", players as any),
      );
    });
  });
});

describe("dampening — timeline logic", () => {
  it("extracts dose events correctly (B73)", () => {
    const dose = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED_DOSE as any,
      "110310",
      MATCH_START + 10_000,
      "h",
      "h",
    );
    (dose.logLine as any).parameters[12] = 15; // 15%
    const p = makeUnit("p", { auraEvents: [dose as any] });

    expect(
      getDampeningPercentage("3v3", [p] as any, MATCH_START + 20_000),
    ).toBe(15);
  });

  it("FT-T08 step 4: the stack also goes down — a REMOVED_DOSE line carries the new count (95127ab4: 51 → 32 after a death)", () => {
    const dose = (event: LogEvent, atMs: number, stacks: number) => {
      const e = makeAuraEvent(
        event as any,
        "110310",
        MATCH_START + atMs,
        "h",
        "h",
      );
      (e.logLine as any).parameters[12] = stacks;
      return e as any;
    };
    const p = makeUnit("p", {
      auraEvents: [
        dose(LogEvent.SPELL_AURA_APPLIED_DOSE, 100_000, 51),
        dose(LogEvent.SPELL_AURA_REMOVED_DOSE, 110_000, 32),
        dose(LogEvent.SPELL_AURA_APPLIED_DOSE, 120_000, 33),
      ],
    });
    const at = (ms: number) =>
      getDampeningPercentage("2v2", [p] as any, MATCH_START + ms);
    expect(at(105_000)).toBe(51);
    expect(at(115_000)).toBe(32);
    expect(at(125_000)).toBe(33);
  });

  it("builds sparse timeline with de-duplication (B74)", () => {
    const dose1 = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED_DOSE as any,
      "110310",
      MATCH_START + 10_000,
      "h",
      "h",
    );
    (dose1.logLine as any).parameters[12] = 15;
    const dose2 = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED_DOSE as any,
      "110310",
      MATCH_START + 70_000,
      "h",
      "h",
    );
    (dose2.logLine as any).parameters[12] = 20;
    const p = makeUnit("p", { auraEvents: [dose1 as any, dose2 as any] });

    const timeline = computeDampeningTimeline(
      "3v3",
      [p] as any,
      MATCH_START,
      MATCH_START + 90_000,
    );
    // [0s: 10% (initial), 30s: 15% (first), 60s: 15% (same - skip), 70s+: 20%]
    // Final should be at 90s: 20%.
    expect(timeline).toHaveLength(3);
    expect(timeline[0]).toEqual({ atSeconds: 0, dampening: 0.1 });
    expect(timeline[1]).toEqual({ atSeconds: 30, dampening: 0.15 });
    expect(timeline[2]).toEqual({ atSeconds: 90, dampening: 0.2 });
  });
});

describe("dampening — danger scoring", () => {
  it("computes capped percentage (B75)", () => {
    const p = makeUnit("p");
    expect(computeDampening(MATCH_START, "3v3", [p] as any)).toBe(0.1);
  });

  it("computes danger multiplier (B76)", () => {
    // 0% -> 1.0x
    expect(dampeningDangerMultiplier(0)).toBe(1.0);
    // 30% -> 1 + 0.3 * 1.5 = 1.45x
    expect(dampeningDangerMultiplier(0.3)).toBe(1.45);
  });
});

describe("dampening — formatting", () => {
  it("renders an explicit n/a line for short/low matches (B77, revised by 2026-07-14 audit)", () => {
    // 60s match with 10% dampening: one explicit "n/a" line instead of silent omission —
    // judges read a missing section as a data gap rather than "considered and irrelevant".
    const lines = formatDampeningForContext(
      "3v3",
      [],
      MATCH_START,
      MATCH_START + 60_000,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("n/a");
    expect(lines[0]).toContain("before dampening ramped");
  });

  it("labels severe dampening (B78)", () => {
    const dose = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED_DOSE as any,
      "110310",
      MATCH_START + 10_000,
      "h",
      "h",
    );
    (dose.logLine as any).parameters[12] = 45;
    const p = makeUnit("p", { auraEvents: [dose as any] });

    const res = formatDampeningForContext(
      "3v3",
      [p] as any,
      MATCH_START,
      MATCH_START + 120_000,
    );
    expect(res[0]).toContain("started at 10%, ended at 45%");
    expect(res[1]).toContain(
      "Dampening 45% at match end (≥40% bracket: healing received reduced by 45%).",
    );
    expect(res[1]).not.toContain("⚠");
    expect(res[1]).not.toContain("CRITICAL");
  });

  it("labels late game note (B79)", () => {
    const dose = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED_DOSE as any,
      "110310",
      MATCH_START + 10_000,
      "h",
      "h",
    );
    (dose.logLine as any).parameters[12] = 25;
    const p = makeUnit("p", { auraEvents: [dose as any] });

    const res = formatDampeningForContext(
      "3v3",
      [p] as any,
      MATCH_START,
      MATCH_START + 120_000,
    );
    expect(res[1]).toContain("Dampening 25% at match end (≥20% bracket).");
    expect(res[1]).not.toContain("⚠");
    expect(res[1]).not.toContain("CRITICAL");
  });
});
