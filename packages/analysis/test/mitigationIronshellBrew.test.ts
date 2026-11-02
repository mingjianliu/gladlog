import { describe, expect, it, vi } from "vitest";

import { CURATED_ID_TABLES } from "../src/data/curatedIdRegistry";
import {
  resolveMitigation,
  strongestComponentPct,
} from "../src/data/mitigationComponents";
import observed from "../src/data/observedSpellIdsGenerated.json";
import { talentMitigationModifiersFor } from "../src/data/talentMitigationModifiers";

// GH #125 (2026-11-02): Fortifying Brew is 20 % without Ironshell Brew and 30 %
// with it (corpus 0.80 / 0.70), the choice-node talent the row left out.
vi.mock("../src/utils/talentOwnership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/utils/talentOwnership")>()),
  talentModifierOwnershipOf: (unit: { info: { holds: boolean } }) =>
    unit.info.holds ? "yes" : "no",
}));

const monk = (holds: boolean) =>
  ({ spec: "269", info: { holds }, spellCastEvents: [] }) as never;
const pct = (holds: boolean) =>
  strongestComponentPct(
    resolveMitigation("115203", {
      carrierIsCaster: true,
      caster: monk(holds),
    })!,
  );

describe("Fortifying Brew + Ironshell Brew", () => {
  it("reads 30 % with the talent and 20 % without", () => {
    expect(pct(true)).toEqual({ pctMin: 30, pctMax: 30 });
    expect(pct(false)).toEqual({ pctMin: 20, pctMax: 20 });
  });

  it("the row is promoted, keyed by the table's cast id", () => {
    expect(talentMitigationModifiersFor("115203")).toEqual([
      expect.objectContaining({
        talentSpellId: "388814",
        modPct: 10,
        validation: "promoted",
      }),
    ]);
    expect(talentMitigationModifiersFor("120954")).toEqual([]);
  });

  it("the buff the corpus split read is live, and the table is registered", () => {
    expect(
      (observed as unknown as Array<string | number>).map(String),
    ).toContain("120954");
    expect(
      CURATED_ID_TABLES.some((t) => t.name === "TALENT_MITIGATION_MODIFIERS"),
    ).toBe(true);
  });
});
