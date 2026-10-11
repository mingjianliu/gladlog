/**
 * Gates of the FT leftovers round (2026-10-11), one `describe` per gate.
 */
import { describe, expect, it } from "vitest";

import { checkBareRosterPossessive } from "../src/quality/promptQualityCheck";

const ROSTER = [
  '  <unit id="1" name="Me-Realm" spec="Restoration Druid" role="log owner">',
  '  <unit id="2" name="Mate-Realm" spec="Beast Mastery Hunter" role="teammate">',
  '  <unit id="5" name="Foe-Realm" spec="Subtlety Rogue" role="enemy">',
];

describe("checkBareRosterPossessive", () => {
  it("flags a roster id named without its spec tag (the two forms of main 8c3275fa)", () => {
    const f = checkBareRosterPossessive([
      ...ROSTER,
      "1:17  [CC BROKEN]   2's Kill Command broke own team's Polymorph on 5(SRogue) — 3.5s of CC wasted",
      "1:41  [CC ON TEAM]   1(RDruid) ← Sin and Punishment (by 4(SPriest)) | 2s | broken by 5's Bestial Wrath",
    ]);
    expect(f).toHaveLength(2);
    expect(f[0]).toContain("roster id 2");
    expect(f[1]).toContain("roster id 5");
  });

  it("passes the tagged forms, the damage rows and plain numbers", () => {
    expect(
      checkBareRosterPossessive([
        ...ROSTER,
        "1:17  [CC BROKEN]   2(BMHunter)'s pet's Kill Command broke own team's Polymorph on 5(SRogue)",
        "1:41  [CC ON TEAM]   1(RDruid) ← Fear (by 5(SRogue)'s guardian) | broken by 2(BMHunter)'s Barbed Shot",
        "                 Top sources: 2's pet — Kill Command [Physical] (226k), 5 — Eviscerate [Physical] (106k)",
        "0:26  [UNIT DESTROYED]   Capacitor Totem (Friendly) killed by: 5's guardian — Strike As One [Physical]",
        "0:40  [YOU] [CAST]   Regrowth → 2 (the 3 s cast's end)",
      ]),
    ).toEqual([]);
  });

  it("an id the roster gives no spec is not held to a tag", () => {
    expect(
      checkBareRosterPossessive([
        '  <unit id="3" name="Other-Realm" spec="" role="teammate">',
        "1:17  [CC BROKEN]   3's Slam broke own team's Polymorph on 5",
      ]),
    ).toEqual([]);
  });
});
