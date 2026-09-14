import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  resolveMitigation,
  strongestComponentPct,
} from "../src/data/mitigationComponents";
import { MITIGATION_TABLE, mitigationPctFor } from "../src/data/mitigationData";
import {
  __resetFactConfigForTests,
  configureFacts,
} from "../src/facts/factProviderConfig";

// GH #96 M3a — the component resolver must reproduce the table read exactly
// (representation change only; product output byte-identical).
describe("mitigation component resolver (M3a parity)", () => {
  // parity is a statement about the table alone: talent components off
  beforeEach(() => {
    __resetFactConfigForTests();
    configureFacts({ talentMitigation: false });
  });
  afterEach(() => __resetFactConfigForTests());

  it("every table entry resolves to one component priced exactly like mitigationPctFor, both carriers", () => {
    for (const [id, entry] of Object.entries(MITIGATION_TABLE)) {
      for (const carrierIsCaster of [true, false]) {
        const res = resolveMitigation(id, { carrierIsCaster })!;
        expect(res.components).toHaveLength(1);
        const c = res.components[0]!;
        const pct = mitigationPctFor(entry, carrierIsCaster);
        expect(c.pctMin).toBe(pct);
        expect(c.pctMax).toBe(pct);
        expect(c.schoolMask).toBe(entry.schoolMask);
        expect(c.kind).toBe(pct >= 100 ? "immunity" : "pct");
        expect(res.positional).toBe(!!entry.positional);
        expect(res.unresolved).toEqual([]);
      }
    }
  });

  it("Obsidian Scales is 30 % on its caster and 15 % on the ally carrying it", () => {
    expect(
      strongestComponentPct(
        resolveMitigation("363916", { carrierIsCaster: true })!,
      ),
    ).toEqual({ pctMin: 30, pctMax: 30 });
    expect(
      strongestComponentPct(
        resolveMitigation("363916", { carrierIsCaster: false })!,
      ),
    ).toEqual({ pctMin: 15, pctMax: 15 });
  });

  it("immunity components are excluded from the strongest percentage unless asked for", () => {
    const divineShield = resolveMitigation("642", { carrierIsCaster: true })!;
    expect(strongestComponentPct(divineShield)).toBeUndefined();
    expect(
      strongestComponentPct(divineShield, { includeImmunity: true }),
    ).toEqual({ pctMin: 100, pctMax: 100 });
  });

  it("an aura outside the table does not resolve", () => {
    expect(resolveMitigation("1", { carrierIsCaster: true })).toBeUndefined();
  });
});
