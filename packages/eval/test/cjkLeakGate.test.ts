import { describe, expect, it } from "vitest";

import { checkCjkLeak, CJK_LEAK } from "../src/quality/promptQualityCheck";

const ROSTER = [
  '  <unit id="1" name="Bingbumlol-Illidan-US" spec="Restoration Shaman" role="log owner">',
  '  <unit id="4" name="风暴之怒-Illidan-US" spec="Balance Druid" role="enemy">',
];

describe("checkCjkLeak (hardFailure: untranslated spell / unit names)", () => {
  it("a KILL ATTEMPTS outcome carrying a client-locale spell name → red, with the line", () => {
    const fails = checkCjkLeak([
      ...ROSTER,
      "  [1:47–2:05] on Trillebelly-Area52-US — Recklessness burst | FAILED: popped 星界转移",
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("line 3");
    expect(fails[0]).toContain("popped 星界转移");
  });

  it("a [ROOT] caster name in the client locale → red", () => {
    expect(
      checkCjkLeak([
        ...ROSTER,
        "2:51  [ROOT]   Earthgrab (from 陷地图腾) rooted enemy Jonboyy-Illidan-US (ranged) for 2.9s",
      ]),
    ).toHaveLength(1);
  });

  it("a CN-realm player's own name is not a leak — full and realm-stripped forms", () => {
    expect(
      checkCjkLeak([
        ...ROSTER,
        "0:12  [CC ON TEAM]   1(RShaman) ← Cyclone (by 风暴之怒-Illidan-US) 6.0s",
        "0:30  [ENEMY CD]   4(BDruid) 风暴之怒: Incarnation",
      ]),
    ).toEqual([]);
  });

  it("all-English prompt → clean; the regex is the one pipelineFuzz shares", () => {
    expect(
      checkCjkLeak([...ROSTER, "0:05  [YOU] [CD]   Astral Shift"]),
    ).toEqual([]);
    expect(CJK_LEAK.test("Barkskin")).toBe(false);
    expect(CJK_LEAK.test("树皮术")).toBe(true);
  });
});
