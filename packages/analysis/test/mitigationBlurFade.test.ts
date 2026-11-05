import { describe, expect, it, vi } from "vitest";

import {
  resolveMitigation,
  strongestComponentPct,
  wallDoorPct,
} from "../src/data/mitigationComponents";
import { MITIGATION_TABLE } from "../src/data/mitigationData";
import observed from "../src/data/observedSpellIdsGenerated.json";
import { talentMitigationModifiersFor } from "../src/data/talentMitigationModifiers";

// GH #164 / GH #126 row 203 (2026-11-05, 605 new-season files): Havoc's Blur
// is 35 % with Desperate Instincts (holders 0.650, Devourer 0.750); Fade
// reduces nothing without Translucent Image (holders 0.900, non-holders
// 1.000).
vi.mock("../src/utils/talentOwnership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/utils/talentOwnership")>()),
  talentModifierOwnershipOf: (
    unit: { info: { holds: string[] } },
    talentSpellId: string,
  ) => (unit.info.holds.includes(talentSpellId) ? "yes" : "no"),
}));

const caster = (spec: string, holds: string[]) =>
  ({ spec, info: { holds }, spellCastEvents: [] }) as never;
const pct = (spellId: string, spec: string, holds: string[]) =>
  strongestComponentPct(
    resolveMitigation(spellId, {
      carrierIsCaster: true,
      caster: caster(spec, holds),
    })!,
  );

describe("Blur + Desperate Instincts", () => {
  it("reads 35 % for a holder (Havoc) and 25 % without it (Devourer)", () => {
    expect(pct("198589", "577", ["205411"])).toEqual({
      pctMin: 35,
      pctMax: 35,
    });
    expect(pct("198589", "1480", [])).toEqual({ pctMin: 25, pctMax: 25 });
  });

  it("the 35 % crosses the burst-into-mitigation door only for a holder", () => {
    const door = (holds: string[]) =>
      wallDoorPct("198589", {
        carrierIsCaster: true,
        caster: caster("577", holds),
      });
    expect(door(["205411"])).toBe(35);
    expect(door([])).toBe(25);
  });

  it("an unknown caster keeps 25 % as the claim, 35 % as the ceiling", () => {
    expect(
      strongestComponentPct(
        resolveMitigation("198589", { carrierIsCaster: true })!,
      ),
    ).toEqual({ pctMin: 25, pctMax: 35 });
  });
});

describe("Fade is Translucent Image's 10 %", () => {
  it("the table keeps the signed 10 %, gated on the talent", () => {
    expect(MITIGATION_TABLE["586"]).toMatchObject({
      pct: 10,
      wholeReductionTalentId: "373446",
    });
    expect(talentMitigationModifiersFor("586")).toEqual([]);
  });

  it("10 % for a holder, 0 % without the talent, 0–10 % unknown", () => {
    expect(pct("586", "257", ["373446"])).toEqual({ pctMin: 10, pctMax: 10 });
    expect(pct("586", "257", [])).toEqual({ pctMin: 0, pctMax: 0 });
    const unknown = resolveMitigation("586", { carrierIsCaster: true })!;
    expect(strongestComponentPct(unknown)).toEqual({ pctMin: 0, pctMax: 10 });
    expect(unknown.unresolved).toEqual(["talent 373446 on 586: caster unknown"]);
  });

  it("the ids the corpus split read are live", () => {
    const ids = (observed as unknown as Array<string | number>).map(String);
    expect(ids).toContain("586");
    expect(ids).toContain("212800");
  });
});
