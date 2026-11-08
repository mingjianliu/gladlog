import { describe, expect, it, vi } from "vitest";

import {
  isUnheldMechanic,
  resolveMitigation,
} from "../src/data/mitigationComponents";
import {
  hasNoOwnPercentage,
  MITIGATION_TABLE,
  MITIGATION_WALL_IDS,
  NO_MITIGATION_IDS,
} from "../src/data/mitigationData";
import { mitigationVerdictOf } from "../src/data/mitigationVerdicts";
import observed from "../src/data/observedSpellIdsGenerated.json";
import spellIdLists from "../src/data/spellIdLists";
import { eligibleExternalMitigation } from "../src/utils/externalDamage";

// GH #126 rows 170 / 171 (2026-11-08, 605 new-season files): Echoing
// Blessings 387801's 15 % on Blessing of Sacrifice's ally end (holders 0.854,
// 72 units; non-holders 1.000; the paladin's own link 1.002) and its 8 s
// linger, the aura Echoing Protection 387804 (0.855, 75 units).
vi.mock("../src/utils/talentOwnership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/utils/talentOwnership")>()),
  talentModifierOwnershipOf: (
    unit: { info: { holds: string[] } },
    talentSpellId: string,
  ) => (unit.info.holds.includes(talentSpellId) ? "yes" : "no"),
}));

const SACRIFICE = "6940";
const ECHOING_PROTECTION = "387804";
const ECHOING = "387801";
const paladin = (holds: string[]) =>
  ({ spec: "65", info: { holds }, spellCastEvents: [] }) as never;
const range = (spellId: string, carrierIsCaster: boolean, holds?: string[]) => {
  const c = resolveMitigation(spellId, {
    carrierIsCaster,
    ...(holds ? { caster: paladin(holds) } : {}),
  })!.components;
  expect(c).toHaveLength(1);
  return [c[0]!.pctMin, c[0]!.pctMax];
};

describe("Echoing Blessings", () => {
  it("Sacrifice on the ally: 15 % for a holder, 0 without, 0–15 unknown", () => {
    expect(range(SACRIFICE, false, [ECHOING])).toEqual([15, 15]);
    expect(range(SACRIFICE, false, [])).toEqual([0, 0]);
    expect(range(SACRIFICE, false)).toEqual([0, 15]);
  });

  it("the paladin's own link carries none of it, holder or not", () => {
    expect(range(SACRIFICE, true, [ECHOING])).toEqual([0, 0]);
    expect(range(SACRIFICE, true)).toEqual([0, 0]);
  });

  it("Sacrifice stays a no-percentage spell for every reader of the id alone", () => {
    expect(NO_MITIGATION_IDS.has(SACRIFICE)).toBe(false);
    expect(hasNoOwnPercentage(SACRIFICE)).toBe(true);
    expect(MITIGATION_WALL_IDS.has(SACRIFICE)).toBe(false);
    expect(eligibleExternalMitigation(SACRIFICE)).toBeNull();
  });

  it("an unheld Sacrifice reads as the off-table mechanic it was (death audit, [STACKED DEFENSIVES])", () => {
    const res = (id: string, carrierIsCaster: boolean, holds?: string[]) =>
      resolveMitigation(id, {
        carrierIsCaster,
        ...(holds ? { caster: paladin(holds) } : {}),
      });
    expect(isUnheldMechanic(SACRIFICE, res(SACRIFICE, false, []))).toBe(true);
    expect(isUnheldMechanic(SACRIFICE, res(SACRIFICE, false))).toBe(true);
    expect(isUnheldMechanic(SACRIFICE, res(SACRIFICE, true, [ECHOING]))).toBe(
      true,
    );
    expect(isUnheldMechanic(SACRIFICE, res(SACRIFICE, false, [ECHOING]))).toBe(
      false,
    );
    // a talent-whole row without the flag stays priced at 0 (Evasion)
    expect(isUnheldMechanic("5277", res("5277", true, []))).toBe(false);
  });

  it("both rows are signed never (R07, 2026-11-08)", () => {
    expect(mitigationVerdictOf(SACRIFICE)).toBe("never");
    expect(mitigationVerdictOf(ECHOING_PROTECTION)).toBe("never");
  });

  it("Echoing Protection is its own 15 % on every school, no ownership needed", () => {
    expect(MITIGATION_TABLE[ECHOING_PROTECTION]).toEqual({
      pct: 15,
      schoolMask: 0x7f,
    });
    expect(range(ECHOING_PROTECTION, false)).toEqual([15, 15]);
    expect(spellIdLists.attributedMitigationSpellIds).toContain(
      ECHOING_PROTECTION,
    );
    expect(
      (observed as unknown as Array<string | number>).map(String),
    ).toContain(ECHOING_PROTECTION);
  });
});
