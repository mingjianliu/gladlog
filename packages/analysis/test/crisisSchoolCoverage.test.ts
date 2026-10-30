/**
 * Reliability round 2 W1e — cd-hoarded named Blessing of Protection
 * (physical only) as a held save for crises that were 78 % magic (06bb9860)
 * and 100 % magic (a5a8d31b). A school-limited save is "ready" for a crisis
 * only when it covers SCHOOL_SAVE_MIN_SHARE of the crisis's 2 s of damage.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  coversCrisisSchool,
  saveSchoolMask,
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

// Triage F-H20 (user ruling 2026-09-30): Anti-Magic Shell has no percentage
// row — its schools come from the DB2 absorb mask (aura 69 MiscValue 0x7e)
describe("Anti-Magic Shell — DB2 absorb school mask", () => {
  it("both ids read 0x7e (all magic, no physical); a signed row still wins", () => {
    expect(saveSchoolMask("48707")).toBe(0x7e);
    expect(saveSchoolMask("410358")).toBe(0x7e);
    expect(saveSchoolMask(BOP)).toBe(0x1);
    // Ice Barrier absorbs every school → no school claim narrows it
    expect(saveSchoolMask("11426")).toBe(0x7f);
  });
  it("58a3d0f8 H:492 shape: 78 % physical → AMS is not a ready save", () => {
    const p = { dmg2sBySchool: { "1": 78, "32": 22 } };
    expect(coversCrisisSchool("48707", p)).toBe(false);
    expect(coversCrisisSchool("410358", p)).toBe(false);
  });
  it("a crisis at least half magic keeps it (the A30 / W1e 50 % rule)", () => {
    expect(
      coversCrisisSchool("48707", { dmg2sBySchool: { "1": 50, "32": 50 } }),
    ).toBe(true);
    expect(
      coversCrisisSchool("48707", { dmg2sBySchool: { "1": 51, "32": 49 } }),
    ).toBe(false);
  });
});
