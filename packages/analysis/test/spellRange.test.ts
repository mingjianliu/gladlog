/**
 * GH #83 (user ruling 2026-09-23, "戒律牧46码必须修 看天赋修 … 其他射程距离的
 * 也修"): a spell's range is the CASTER's — official DB2 range plus the range
 * talents they hold. Talent ownership is mocked so the test pins the range
 * arithmetic and the tables, not the loadout reader.
 */
import { describe, expect, it, vi } from "vitest";

const held = new Set<string>();
vi.mock("../src/utils/talentOwnership", () => ({
  talentModifierOwnershipOf: (_u: unknown, talent: string) =>
    held.has(talent) ? "yes" : "no",
}));

import {
  CLEANSE_SPELLS_BY_TYPE,
  dispelReachYards,
  PURGE_SPELLS_BY_SPEC,
} from "../src/utils/dispelAnalysis";
import closeIn from "../src/data/ccCloseInGenerated.json";
import { SPEC_PRIMARY_CC } from "../src/utils/healerExposureAnalysis";
import { DR_CATEGORY_MAP } from "../src/utils/drAnalysis";
import { CC_MAX_CAST_RANGE_YARDS } from "../src/utils/positionSampling";
import {
  CC_CLOSE_IN_MELEE_YD,
  CC_CLOSE_IN_RANGED_YD,
  ccThreatRadiusYards,
  ccThreatReachYards,
  healerReachYards,
  spellRangeForCaster,
  spellReachForCaster,
} from "../src/utils/spellRange";

const PHANTOM_REACH = "459559";
const ASTRAL_INFLUENCE = "197524";
const ARCANE_REACH = "454983";

function unit(spec: string, talents: string[] = []) {
  held.clear();
  for (const t of talents) held.add(t);
  // a fresh object per call: the ownership cache is keyed on the unit
  return { spec, info: {}, spellCastEvents: [] } as never;
}

describe("spellRangeForCaster", () => {
  it("Discipline with Phantom Reach reaches 46 yd; without it 40", () => {
    expect(spellRangeForCaster(unit("256", [PHANTOM_REACH]), "2061")).toBe(46);
    expect(spellRangeForCaster(unit("256"), "2061")).toBe(40);
    // Pain Suppression rides the same talent
    expect(spellRangeForCaster(unit("256", [PHANTOM_REACH]), "33206")).toBe(46);
  });

  it("no caster, or an unlisted spell: the official number / null", () => {
    expect(spellRangeForCaster(null, "2061")).toBe(40);
    expect(spellRangeForCaster(null, "999999999")).toBeNull();
  });

  it("Astral Influence is +5 yd flat on druid heals", () => {
    expect(spellRangeForCaster(unit("105", [ASTRAL_INFLUENCE]), "8936")).toBe(
      45,
    );
  });

  it("a placed area keeps its radius on top of the talented range", () => {
    // Mass Dispel: 30 yd range × 1.15 + 15 yd radius
    expect(
      spellReachForCaster(unit("256", [PHANTOM_REACH]), "32375"),
    ).toBeCloseTo(49.5, 5);
  });
});

describe("healerReachYards", () => {
  it("is the longest core heal with the healer's talents", () => {
    expect(healerReachYards(unit("256", [PHANTOM_REACH]), 40)).toBe(46);
    expect(healerReachYards(unit("105", [ASTRAL_INFLUENCE]), 40)).toBe(45);
    expect(healerReachYards(unit("264"), 40)).toBe(40);
    // Preservation: Echo / Reversion 30 — shorter than the old flat 40
    expect(healerReachYards(unit("1468"), 40)).toBe(30);
    expect(healerReachYards(unit("1468", [ARCANE_REACH]), 40)).toBe(35);
  });

  it("falls back for a spec it does not list", () => {
    expect(healerReachYards(unit("71"), 40)).toBe(40);
  });
});

describe("dispelReachYards", () => {
  it("uses the dispeller's own cleanse, talents included", () => {
    const pres = CLEANSE_SPELLS_BY_TYPE.Poison["1468"];
    const dev = CLEANSE_SPELLS_BY_TYPE.Poison["1467"];
    expect(dispelReachYards(unit("1468"), pres)).toBe(30); // Naturalize
    expect(dispelReachYards(unit("1467"), dev)).toBe(25); // Expunge
    expect(
      dispelReachYards(
        unit("256", [PHANTOM_REACH]),
        CLEANSE_SPELLS_BY_TYPE.Magic["256"],
      ),
    ).toBe(46);
  });

  it("offensive purges are 30 yd, not 40", () => {
    expect(dispelReachYards(unit("262"), PURGE_SPELLS_BY_SPEC["262"])).toBe(30);
    expect(
      dispelReachYards(
        unit("258", [PHANTOM_REACH]),
        PURGE_SPELLS_BY_SPEC["258"],
      ),
    ).toBeCloseTo(34.5, 5);
  });

  it("a spec with no listed spell keeps the old 40", () => {
    expect(dispelReachYards(unit("265"), PURGE_SPELLS_BY_SPEC["265"])).toBe(40);
  });
});

describe("ccThreatReachYards / ccThreatRadiusYards (GH #83)", () => {
  it("a targeted CC is its cast range, a caster-centred one its radius", () => {
    expect(ccThreatReachYards(null, "408")).toBe(5); // Kidney Shot
    expect(ccThreatReachYards(null, "118")).toBe(30); // Polymorph
    expect(ccThreatReachYards(null, "8122")).toBe(8); // Psychic Scream
  });

  it("an aura id resolves through the cast that triggers it", () => {
    // Fear's aura 118699 carries no range; the Fear cast 5782 is 30 yd
    expect(ccThreatReachYards(null, "118699")).toBe(30);
  });

  it("the 100 yd 'vision range' placeholder is not a range", () => {
    expect(ccThreatReachYards(null, "3355")).toBeNull(); // Freezing Trap aura
    expect(ccThreatRadiusYards(null, "3355")).toBe(CC_MAX_CAST_RANGE_YARDS);
  });

  it("adds the spell's measured close-in: melee runs in, ranged casts in place", () => {
    const p85 = (id: string) =>
      (closeIn as { spells: Record<string, { p85: number }> }).spells[id]!.p85;
    expect(ccThreatRadiusYards(null, "408")).toBeCloseTo(5 + p85("408"), 5); // Kidney Shot
    expect(ccThreatRadiusYards(null, "2094")).toBeCloseTo(15 + p85("2094"), 5); // Blind
    expect(ccThreatRadiusYards(null, "118")).toBeCloseTo(30 + p85("118"), 5); // Polymorph
    // the table's own shape: short CC runs in, ranged CC does not
    expect(p85("408")).toBeGreaterThan(8);
    expect(p85("118")).toBeLessThan(2);
  });

  it("falls back to the reach split for a CC with too few landings", () => {
    // Freezing Trap's cast 187650 is never an aura id → not in the table
    expect(
      (closeIn as { spells: Record<string, unknown> }).spells["187650"],
    ).toBeUndefined();
    expect(ccThreatRadiusYards(null, "187650")).toBe(
      40 + CC_CLOSE_IN_RANGED_YD,
    );
    expect(ccThreatRadiusYards(null, undefined)).toBe(CC_MAX_CAST_RANGE_YARDS);
    expect(CC_CLOSE_IN_MELEE_YD).toBeGreaterThan(CC_CLOSE_IN_RANGED_YD);
  });

  it("every fallback primary CC has a DR category (never hand-typed)", () => {
    for (const e of SPEC_PRIMARY_CC)
      expect(DR_CATEGORY_MAP[e.spellId], e.spellName).toBeTruthy();
  });
});
