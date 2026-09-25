/**
 * Reliability round 2 W1e — cd-hoarded named Blessing of Protection
 * (physical only) as a held save for crises that were 78 % magic (06bb9860)
 * and 100 % magic (a5a8d31b). A school-limited save is "ready" for a crisis
 * only when it covers SCHOOL_SAVE_MIN_SHARE of the crisis's 2 s of damage.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  coversCrisisSchool,
  SCHOOL_SAVE_MIN_SHARE,
} from "../src/analysis/candidates/cooldownTiming";
import { schoolShareCoveredBy } from "../src/analysis/crisisDecisionPoints";
import { ensureAnalysisData } from "../src/data/ensure";

const BOP = "1022";
const SPELLWARDING = "204018";
const DIVINE_SHIELD = "642";

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("schoolShareCoveredBy", () => {
  it("06bb9860 shape: 22 % physical, 78 % magic (Holy + Nature)", () => {
    const p = { dmg2sBySchool: { "1": 22, "2": 38, "8": 40 } };
    expect(schoolShareCoveredBy(p, 0x1)).toBeCloseTo(0.22, 6);
    expect(schoolShareCoveredBy(p, 0x7e)).toBeCloseTo(0.78, 6);
  });
  it("no damage recorded → no claim", () => {
    expect(schoolShareCoveredBy({ dmg2sBySchool: {} }, 0x1)).toBeNull();
    expect(schoolShareCoveredBy({}, 0x1)).toBeNull();
  });
});

describe("coversCrisisSchool", () => {
  const magicCrisis = { dmg2sBySchool: { "16": 60, "2": 40 } };
  const physicalCrisis = { dmg2sBySchool: { "1": 90, "32": 10 } };
  it("Blessing of Protection is not a save for a magic crisis (a5a8d31b)", () => {
    expect(SCHOOL_SAVE_MIN_SHARE).toBe(0.5);
    expect(coversCrisisSchool(BOP, magicCrisis)).toBe(false);
    expect(coversCrisisSchool(BOP, physicalCrisis)).toBe(true);
  });
  it("Spellwarding is the mirror image", () => {
    expect(coversCrisisSchool(SPELLWARDING, magicCrisis)).toBe(true);
    expect(coversCrisisSchool(SPELLWARDING, physicalCrisis)).toBe(false);
  });
  it("an all-school save and a spell with no mitigation entry always count", () => {
    expect(coversCrisisSchool(DIVINE_SHIELD, magicCrisis)).toBe(true);
    expect(coversCrisisSchool("999999999", magicCrisis)).toBe(true);
  });
  it("a point with no school breakdown keeps the old behaviour", () => {
    expect(coversCrisisSchool(BOP, {})).toBe(true);
  });
});
