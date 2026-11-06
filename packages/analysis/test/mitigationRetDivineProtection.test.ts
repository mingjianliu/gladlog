import { describe, expect, it, vi } from "vitest";

import {
  resolveMitigation,
  strongestComponentPct,
  wallDoorPct,
} from "../src/data/mitigationComponents";
import { MITIGATION_TABLE } from "../src/data/mitigationData";

// GH #157 / cat1 #2 (2026-11-05): Retribution's Divine Protection 403876 is
// 20 + Shield of Vengeance 1261562's 10 = 30 % since the 2026-08-25 PvP
// hotfix (holders 0.701, 480 unit-rounds; Holy's 498 control flat).
vi.mock("../src/utils/talentOwnership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/utils/talentOwnership")>()),
  talentModifierOwnershipOf: (
    unit: { info: { holds: string[] } },
    talentSpellId: string,
  ) => (unit.info.holds.includes(talentSpellId) ? "yes" : "no"),
}));

import { HOTFIX_2026_08_25_EPOCH_MS } from "../src/data/talentMitigationModifiers";
import { LOG_ZONE_UNCERTAINTY_MS } from "../src/utils/logEra";

const caster = (holds: string[], castAtMs?: number) =>
  ({
    spec: "70",
    info: { holds },
    spellCastEvents:
      castAtMs === undefined ? [] : [{ logLine: { timestamp: castAtMs } }],
  }) as never;
const ctx = (holds: string[], castAtMs?: number) => ({
  carrierIsCaster: true,
  caster: caster(holds, castAtMs),
});

describe("Retribution Divine Protection + Shield of Vengeance", () => {
  it("the DB2 base is 20 %", () => {
    expect(MITIGATION_TABLE["403876"]?.pct).toBe(20);
  });

  it("30 % for a holder, 20 % without it", () => {
    expect(
      strongestComponentPct(resolveMitigation("403876", ctx(["1261562"]))!),
    ).toEqual({ pctMin: 30, pctMax: 30 });
    expect(
      strongestComponentPct(resolveMitigation("403876", ctx([]))!),
    ).toEqual({ pctMin: 20, pctMax: 20 });
    expect(wallDoorPct("403876", ctx(["1261562"]))).toBe(30);
  });

  it("an unknown caster keeps 20 % as the claim, 30 % as the ceiling", () => {
    expect(
      strongestComponentPct(
        resolveMitigation("403876", { carrierIsCaster: true })!,
      ),
    ).toEqual({ pctMin: 20, pctMax: 30 });
  });
});

describe("Retribution Divine Protection by date (2026-08-25 PvP hotfix, user ruling 2026-11-05)", () => {
  const H = HOTFIX_2026_08_25_EPOCH_MS;
  const at = (ms: number, atMs?: number) =>
    strongestComponentPct(
      resolveMitigation("403876", {
        ...ctx(["1261562"], ms),
        ...(atMs === undefined ? {} : { atMs }),
      })!,
    );

  it("25 % for a log certainly before the hotfix (the caster's first cast dates it)", () => {
    const old = H - LOG_ZONE_UNCERTAINTY_MS - 60_000;
    expect(at(old)).toEqual({ pctMin: 25, pctMax: 25 });
    expect(wallDoorPct("403876", ctx(["1261562"], old))).toBe(25);
  });

  it("30 % from it on, and inside the zone uncertainty before it", () => {
    expect(at(H)).toEqual({ pctMin: 30, pctMax: 30 });
    expect(at(H - LOG_ZONE_UNCERTAINTY_MS + 60_000)).toEqual({
      pctMin: 30,
      pctMax: 30,
    });
  });

  it("a caster with aura rows and no cast row is dated by its auras (codex review 2026-11-05)", () => {
    const old = H - LOG_ZONE_UNCERTAINTY_MS - 60_000;
    const auraOnly = {
      spec: "70",
      info: { holds: ["1261562"] },
      spellCastEvents: [],
      auraEvents: [{ logLine: { timestamp: old } }],
    } as never;
    expect(
      strongestComponentPct(
        resolveMitigation("403876", {
          carrierIsCaster: true,
          caster: auraOnly,
        })!,
      ),
    ).toEqual({ pctMin: 25, pctMax: 25 });
  });

  it("an explicit application time wins over the caster's first cast", () => {
    expect(at(H, H - 2 * LOG_ZONE_UNCERTAINTY_MS)).toEqual({
      pctMin: 25,
      pctMax: 25,
    });
  });
});
