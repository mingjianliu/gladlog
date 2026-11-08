import { describe, expect, it, vi } from "vitest";

import {
  resolveMitigation,
  strongestComponentPct,
} from "../src/data/mitigationComponents";
import {
  MITIGATION_TABLE,
  MITIGATION_WALL_IDS,
  NO_MITIGATION_IDS,
} from "../src/data/mitigationData";
import {
  mitigationVerdictOf,
  nonMeleeMitigationVerdictOf,
} from "../src/data/mitigationVerdicts";
import observed from "../src/data/observedSpellIdsGenerated.json";

// GH #126 Elusiveness (user 2026-11-05 「按你说的做」): Feint 1966 and Evasion
// 5277 reduce 20 % only with Elusiveness 79008 (corpus 2026-09-26: holders
// 0.800, non-holders 0.999 / 1.000). Feint is signed `never`; Evasion
// `unconditional` against what a dodge stops, `never` against spells.
vi.mock("../src/utils/talentOwnership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/utils/talentOwnership")>()),
  talentModifierOwnershipOf: (
    unit: { info: { holds: string[] } },
    talentSpellId: string,
  ) => (unit.info.holds.includes(talentSpellId) ? "yes" : "no"),
}));

const FEINT = "1966";
const EVASION = "5277";
const ELUSIVENESS = "79008";
const caster = (holds: string[]) =>
  ({ spec: "261", info: { holds }, spellCastEvents: [] }) as never;
const pct = (spellId: string, holds: string[]) =>
  strongestComponentPct(
    resolveMitigation(spellId, {
      carrierIsCaster: true,
      caster: caster(holds),
    })!,
  );

describe("Feint and Evasion are Elusiveness's 20 %", () => {
  it("both rows are the talent's whole reduction, and no longer no-mitigation", () => {
    for (const id of [FEINT, EVASION]) {
      expect(MITIGATION_TABLE[id]).toMatchObject({
        pct: 20,
        schoolMask: 0x7f,
        wholeReductionTalentId: ELUSIVENESS,
      });
      expect(NO_MITIGATION_IDS.has(id)).toBe(false);
    }
  });

  it("20 % for a holder, 0 % without it, 0–20 % unknown", () => {
    for (const id of [FEINT, EVASION]) {
      expect(pct(id, [ELUSIVENESS])).toEqual({ pctMin: 20, pctMax: 20 });
      expect(pct(id, [])).toEqual({ pctMin: 0, pctMax: 0 });
      // Evasion's ceiling with a caster unknown is Bait and Switch's magic
      // on top (1 − 0.80 × 0.85, GH #126 row 234)
      expect(
        strongestComponentPct(resolveMitigation(id, { carrierIsCaster: true })!),
      ).toEqual({ pctMin: 0, pctMax: id === EVASION ? 32 : 20 });
    }
  });

  it("a talent's whole reduction is no wall: the id-only wall readers leave it out", () => {
    expect(MITIGATION_WALL_IDS.has(FEINT)).toBe(false);
    expect(MITIGATION_WALL_IDS.has(EVASION)).toBe(false);
    // every other 20–99 % row still is one
    for (const [id, e] of Object.entries(MITIGATION_TABLE))
      if (e.pct >= 20 && e.pct < 100 && !e.wholeReductionTalentId)
        expect(MITIGATION_WALL_IDS.has(id), id).toBe(true);
  });

  it("the signed verdicts: Feint never; Evasion unconditional, never against spells", () => {
    expect(mitigationVerdictOf(FEINT)).toBe("never");
    expect(nonMeleeMitigationVerdictOf(FEINT)).toBe("never");
    expect(mitigationVerdictOf(EVASION)).toBe("unconditional");
    expect(nonMeleeMitigationVerdictOf(EVASION)).toBe("never");
  });

  it("the casts are live (the passive talent logs no row of its own; its holders come from COMBATANT_INFO)", () => {
    const ids = (observed as unknown as Array<string | number>).map(String);
    for (const id of [FEINT, EVASION]) expect(ids).toContain(id);
  });
});
