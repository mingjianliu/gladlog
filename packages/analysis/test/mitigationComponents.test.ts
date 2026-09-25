import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CombatUnitSpec } from "@gladlog/parser-compat";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  resolveMitigation,
  strongestComponentPct,
  wallDoorPct,
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

// GH #114 (2026-09-25): the [ENEMY DEF] line read the raw table (Barkskin
// 20 %) while burst-into-mitigation priced the same aura through the resolver
// with the caster's talents (30 %). Both now read wallDoorPct.
describe("wallDoorPct (GH #114 — one price for [ENEMY DEF] and the burst-into-mitigation door)", () => {
  const resto = {
    spec: CombatUnitSpec.Druid_Restoration,
    info: { talents: [], pvpTalents: [] },
    spellCastEvents: [],
  } as never;

  it("is the resolver's strongest lower bound (immunity included) for every entry, both carriers, with and without a caster", () => {
    for (const id of Object.keys(MITIGATION_TABLE)) {
      for (const carrierIsCaster of [true, false]) {
        for (const caster of [undefined, resto]) {
          const ctx = { carrierIsCaster, caster };
          const res = resolveMitigation(id, ctx)!;
          expect(wallDoorPct(id, ctx)).toBe(
            strongestComponentPct(res, { includeImmunity: true })?.pctMin,
          );
        }
      }
    }
    expect(wallDoorPct("1", { carrierIsCaster: true })).toBeUndefined();
  });

  it("the [ENEMY DEF] self-wall % is priced through wallDoorPct, not the raw table", () => {
    const src = readFileSync(
      join(__dirname, "../src/utils/enemyDefensives.ts"),
      "utf8",
    );
    expect(src).toContain("pct: wallDoorPct(iv.spellId");
    expect(src).not.toMatch(/pct:\s*MITIGATION_TABLE\[/);
  });
});
