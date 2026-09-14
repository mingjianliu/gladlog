import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resolveMitigation,
  strongestComponentPct,
} from "../src/data/mitigationComponents";
import {
  __resetFactConfigForTests,
  configureFacts,
} from "../src/facts/factProviderConfig";

// GH #96 M3b — the resolver's talent path, against a fixture table (the real
// table's promotion status comes from mitigationTalentScan, not from tests).
vi.mock("../src/data/talentMitigationModifiers", () => {
  const rows = [
    // Barkskin 20 % + a promoted +10
    {
      auraSpellId: "22812",
      talentSpellId: "900001",
      schoolMask: 127,
      modPct: 10,
      validation: "promoted",
      evidence: "fixture",
    },
    // Cloak of Shadows: magic immunity + an unvalidated 20 % physical
    {
      auraSpellId: "31224",
      talentSpellId: "900002",
      schoolMask: 1,
      modPct: 20,
      validation: "unvalidated",
      evidence: "fixture",
    },
    // Obsidian Scales 30 % self / 15 % ally + a promoted +10
    {
      auraSpellId: "363916",
      talentSpellId: "900003",
      schoolMask: 127,
      modPct: 10,
      validation: "promoted",
      evidence: "fixture",
    },
  ];
  return {
    TALENT_MITIGATION_MODIFIERS: rows,
    talentMitigationModifiersFor: (id: string) =>
      rows.filter((r) => r.auraSpellId === id),
  };
});

// ownership is the shared predicate's job (pinned in
// talentModifierOwnership.test.ts); here a unit "holds" what it lists
vi.mock("../src/utils/talentOwnership", () => ({
  talentModifierOwnershipOf: (
    unit: { held: string[] },
    talentSpellId: string,
  ) => (unit.held.includes(talentSpellId) ? "yes" : "no"),
}));

const holder = (talentSpellId: string) => ({ held: [talentSpellId] }) as never;

describe("mitigation resolver talent components (M3b)", () => {
  afterEach(() => __resetFactConfigForTests());

  it("switch off: talents change nothing", () => {
    configureFacts({ talentMitigation: false });
    const res = resolveMitigation("22812", {
      carrierIsCaster: true,
      caster: holder("900001"),
    })!;
    expect(strongestComponentPct(res)).toEqual({ pctMin: 20, pctMax: 20 });
    expect(res.unresolved).toEqual([]);
  });

  it("promoted + held: raises both bounds by the modifier's points (20 + 10 = 30)", () => {
    configureFacts({ talentMitigation: true });
    const res = resolveMitigation("22812", {
      carrierIsCaster: true,
      caster: holder("900001"),
    })!;
    expect(strongestComponentPct(res)).toEqual({ pctMin: 30, pctMax: 30 });
    expect(res.unresolved).toEqual([]);
  });

  it("caster unknown: only the upper bound moves, and the reason is recorded", () => {
    configureFacts({ talentMitigation: true });
    const res = resolveMitigation("22812", { carrierIsCaster: true })!;
    expect(strongestComponentPct(res)).toEqual({ pctMin: 20, pctMax: 30 });
    expect(res.unresolved).toEqual(["talent 900001 on 22812: caster unknown"]);
  });

  it("unvalidated school-only modifier becomes its own component, upper bound only", () => {
    configureFacts({ talentMitigation: true });
    const res = resolveMitigation("31224", {
      carrierIsCaster: true,
      caster: holder("900002"),
    })!;
    expect(res.components).toContainEqual({
      kind: "pct",
      schoolMask: 1,
      pctMin: 0,
      pctMax: 20,
    });
    expect(res.unresolved).toEqual(["talent 900002 on 31224: unvalidated"]);
  });

  it("an uncertain weakening modifier lowers pctMin only (bounds stay ordered)", async () => {
    configureFacts({ talentMitigation: true });
    const mod = await import("../src/data/talentMitigationModifiers");
    (mod.TALENT_MITIGATION_MODIFIERS as unknown as object[]).push({
      auraSpellId: "108271",
      talentSpellId: "900004",
      schoolMask: 127,
      modPct: -10,
      validation: "unvalidated",
      evidence: "fixture",
    });
    const res = resolveMitigation("108271", {
      carrierIsCaster: true,
      caster: holder("900004"),
    })!;
    expect(strongestComponentPct(res)).toEqual({ pctMin: 30, pctMax: 40 });
  });

  it("ally-carried Obsidian Scales copy: modifier reach is unmeasured, upper bound only", () => {
    configureFacts({ talentMitigation: true });
    const self = resolveMitigation("363916", {
      carrierIsCaster: true,
      caster: holder("900003"),
    })!;
    expect(strongestComponentPct(self)).toEqual({ pctMin: 40, pctMax: 40 });
    const ally = resolveMitigation("363916", {
      carrierIsCaster: false,
      caster: holder("900003"),
    })!;
    expect(strongestComponentPct(ally)).toEqual({ pctMin: 15, pctMax: 25 });
    expect(ally.unresolved).toEqual([
      "talent 900003 on 363916: ally-carried copy",
    ]);
  });
});
