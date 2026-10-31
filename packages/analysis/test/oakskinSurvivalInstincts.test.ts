/**
 * fact7 class 11 (D39 / D57): the 2026-10-29 logs measure Survival Instincts
 * at 50 % on Oakskin holders, not the 60 % DB2 and the tooltip give, while
 * Barkskin + Oakskin on the same druids still reads 30 %. The real row, so a
 * re-promotion has to come with the scan that earns it (`mitigationTalentScan
 * --only 61336 --split-spec`).
 */
import { describe, expect, it, vi } from "vitest";

import {
  resolveMitigation,
  strongestComponentPct,
  wallDoorPct,
} from "../src/data/mitigationComponents";

vi.mock("../src/utils/talentOwnership", () => ({
  talentModifierOwnershipOf: () => "yes",
}));

const ctx = { carrierIsCaster: true, caster: { spec: "103" } as never };

describe("Survival Instincts + Oakskin", () => {
  it("prints the 50 % the log measures; 60 % stays an upper bound", () => {
    expect(wallDoorPct("61336", ctx)).toBe(50);
    expect(strongestComponentPct(resolveMitigation("61336", ctx)!)).toEqual({
      pctMin: 50,
      pctMax: 60,
    });
    expect(resolveMitigation("61336", ctx)!.unresolved).toEqual([
      "talent 449191 on 61336: unvalidated",
    ]);
  });
  it("Barkskin + Oakskin keeps its 30 %", () => {
    expect(wallDoorPct("22812", ctx)).toBe(30);
  });
});
