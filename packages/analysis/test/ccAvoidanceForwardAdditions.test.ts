/**
 * corpusFactScan2 immunityTableForward (2026-10-22): the ranked auras DB2
 * explains join the avoidance table — by mechanic (aura 77) or all-school
 * (aura 39) — as facts only, not as cc-avoidable tools.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  applicableCCAvoidanceIds,
  CC_AVOIDANCE_FACT_ONLY_IDS,
} from "../src/utils/ccTrinketAnalysis";

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("avoidance table — DB2-explained forward additions", () => {
  it("Icebound Fortitude explains a stun (Kidney Shot), not a fear (Psychic Scream)", () => {
    expect(applicableCCAvoidanceIds("408", "Kidney Shot").has("48792")).toBe(
      true,
    );
    expect(
      applicableCCAvoidanceIds("8122", "Psychic Scream").has("48792"),
    ).toBe(false);
  });
  it("Lichborne explains a fear; Sanctified Ground a silence (Garrote – Silence)", () => {
    expect(
      applicableCCAvoidanceIds("8122", "Psychic Scream").has("49039"),
    ).toBe(true);
    expect(
      applicableCCAvoidanceIds("1330", "Garrote - Silence").has("289655"),
    ).toBe(true);
  });
  it("a unit inside a Freezing Trap is immune to the next control", () => {
    expect(applicableCCAvoidanceIds("118", "Polymorph").has("203337")).toBe(
      true,
    );
  });
  it("every addition is a fact-only id (no new cc-avoidable tool)", () => {
    for (const id of ["48792", "49039", "289655", "203337", "1953"])
      expect(CC_AVOIDANCE_FACT_ONLY_IDS.has(id)).toBe(true);
  });
});
