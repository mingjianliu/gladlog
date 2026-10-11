/**
 * Gates of the FT leftovers round (2026-10-11), one `describe` per gate.
 */
import { describe, expect, it } from "vitest";

import {
  checkBareRosterPossessive,
  checkStayedInForcedMove,
} from "../src/quality/promptQualityCheck";

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

describe("checkStayedInForcedMove", () => {
  const stayed = (moved: string) =>
    `    0:13–0:23 [Moderate burst] 4.3→8.8yd from Trench-Velen-US — you moved 29.2 yd${moved} — you were the burst target — your HP 90%→40% (min over window)`;
  const GRIP = "0:15  [GRIP]   1(RDruid) ← Death Grip (by 5(SRogue))";

  it("flags `yourself` with a landed [GRIP] on the owner inside the span (main 8c3275fa)", () => {
    const f = checkStayedInForcedMove([
      ...ROSTER,
      GRIP,
      stayed(" yourself (span start→end)"),
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain('says "yourself"');
  });

  it("passes the line that names the grip, and a plain line with no grip in the span", () => {
    expect(
      checkStayedInForcedMove([
        ...ROSTER,
        GRIP,
        stayed(
          " (span start→end), not all of it yourself: Death Grip pulled you at 0:15",
        ),
      ]),
    ).toEqual([]);
    for (const grip of [
      // on a teammate, not landed, at the end second (after the end sample)
      "0:15  [GRIP]   2(BMHunter) ← Death Grip (by 5(SRogue))",
      `${GRIP} — did not land (IMMUNE)`,
      GRIP.replace("0:15", "0:23"),
    ])
      expect(
        checkStayedInForcedMove([
          ...ROSTER,
          grip,
          stayed(" yourself (span start→end)"),
        ]),
        grip,
      ).toEqual([]);
  });

  it("flags a named grip with no [GRIP] line, one outside the span, and a second grip left out", () => {
    const named = (list: string) =>
      stayed(` (span start→end), not all of it yourself: ${list}`);
    expect(
      checkStayedInForcedMove([
        ...ROSTER,
        named("Death Grip pulled you at 0:15"),
      ])[0],
    ).toContain("no landed [GRIP] line");
    expect(
      checkStayedInForcedMove([
        ...ROSTER,
        named("an enemy knockback or pull landed on you at 0:25"),
      ])[0],
    ).toContain("outside the span");
    expect(
      checkStayedInForcedMove([
        ...ROSTER,
        GRIP,
        GRIP.replace("0:15", "0:19"),
        named("Death Grip pulled you at 0:15"),
      ])[0],
    ).toContain("does not name it");
    // a knockback has no line of its own: inside the span it passes
    expect(
      checkStayedInForcedMove([
        ...ROSTER,
        named("an enemy knockback or pull landed on you at 0:18"),
      ]),
    ).toEqual([]);
  });
});
