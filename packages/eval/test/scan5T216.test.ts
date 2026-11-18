/**
 * scan5/t216 `taggedLineParts` (T216, Mac job T216-1): the tagged owner
 * lines the check reads — with a named unit and without one.
 */
import { describe, expect, it } from "vitest";

import { taggedLineParts } from "../scripts/scan5/t216";

describe("scan5/t216 taggedLineParts", () => {
  it("a cast line that names its unit", () => {
    expect(
      taggedLineParts(
        "1:12  [YOU] [CAST]   Prayer of Mending → 3(FMage) [IMMUNE — Cyclone was up]",
      ),
    ).toEqual({ time: "1:12", name: "Prayer of Mending", pid: "3" });
  });
  it("a cooldown line that names no unit is read too (it was skipped)", () => {
    expect(
      taggedLineParts(
        "2:31  [YOU] [CD]   The Hunt (self: 98% HP, +9%/s, 98k DPS) [IMMUNE — Cloak of Shadows was up] | dampening: 10%",
      ),
    ).toEqual({ time: "2:31", name: "The Hunt" });
    expect(
      taggedLineParts(
        "3:59  [YOU] [CD]   Feral Frenzy [IMMUNE — Divine Shield was up]",
      ),
    ).toEqual({ time: "3:59", name: "Feral Frenzy" });
  });
  it("an untagged line, a team line and a bare tag are not read", () => {
    expect(
      taggedLineParts("1:12  [YOU] [CAST]   Prayer of Mending → 3(FMage)"),
    ).toBeNull();
    expect(
      taggedLineParts(
        "1:16  [TEAM] [CD]   2(FMage) (Frost Mage): Ray of Frost [IMMUNE — Blessing of Spellwarding was up]",
      ),
    ).toBeNull();
    expect(
      taggedLineParts("1:12  [YOU] [CAST]   Smite → 5(RDruid) [IMMUNE]"),
    ).toBeNull();
  });
});
