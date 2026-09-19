import { describe, expect, it } from "vitest";

import { MELEE_RANGE_YD, spellRangeYards } from "../src/data/spellReach";

describe("spellReach — spellRangeYards & MELEE_RANGE_YD", () => {
  it("MELEE_RANGE_YD is 5 yards", () => {
    expect(MELEE_RANGE_YD).toBe(5);
  });

  it("returns official cast ranges for interrupts", () => {
    // Melee kicks (combat range = 5 yd)
    expect(spellRangeYards("1766")).toBe(5); // Kick (Rogue)
    expect(spellRangeYards("6552")).toBe(5); // Pummel (Warrior)

    // Mid-range & ranged kicks
    expect(spellRangeYards("106839")).toBe(13); // Skull Bash (Druid, 13 yd)
    expect(spellRangeYards("47528")).toBe(15); // Mind Freeze (Death Knight, 15 yd)
    expect(spellRangeYards("351338")).toBe(25); // Quell (Evoker, 25 yd)
    expect(spellRangeYards("57994")).toBe(30); // Wind Shear (Shaman, 30 yd)
    expect(spellRangeYards("2139")).toBe(40); // Counterspell (Mage, 40 yd)
  });

  it("returns official cast ranges for ally externals", () => {
    expect(spellRangeYards("1022")).toBe(40); // Blessing of Protection
    expect(spellRangeYards("6940")).toBe(40); // Blessing of Sacrifice
    expect(spellRangeYards("33206")).toBe(40); // Pain Suppression
    expect(spellRangeYards("47788")).toBe(40); // Guardian Spirit
    expect(spellRangeYards("102342")).toBe(40); // Ironbark
    expect(spellRangeYards("116849")).toBe(40); // Life Cocoon
    expect(spellRangeYards("357170")).toBe(30); // Time Dilation (Evoker, 30 yd)
  });

  it("returns null for spells with rangeYards <= 0 (e.g. self-radius spells like Zephyr)", () => {
    expect(spellRangeYards("374227")).toBeNull(); // Zephyr (rangeYards 0, radius 20)
  });

  it("returns null for unknown, empty, or unlisted spell IDs", () => {
    expect(spellRangeYards("no-such-spell")).toBeNull();
    expect(spellRangeYards("")).toBeNull();
    expect(spellRangeYards("99999999")).toBeNull();
  });
});
