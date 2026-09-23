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
import {
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
