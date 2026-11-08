import { describe, expect, it } from "vitest";

import { checkBacklashDispelWasPressed } from "../src/quality/promptQualityCheck";

const row = (t: string, debuff = "Unstable Affliction") =>
  `  - id=backlash-dispel:P1:${Math.round(Number(t))} type=backlash-dispel t=${t}s units=Dps facts={t=${t}, target=Dps, debuff=${debuff}, stacks=1, targetHpPct=63}`;

describe("checkBacklashDispelWasPressed (fact12 D28)", () => {
  it("cf63da4a r0: a removal folded as a side effect of Fortifying Brew is no dispel decision", () => {
    expect(
      checkBacklashDispelWasPressed([
        "0:22  [MINOR DISPELS]   1(WMonk): Swift Art (side effect of the cast) x3, Fortifying Brew (side effect of the cast) (low-priority, folded)",
        row("103.5"),
      ]),
    ).toHaveLength(1);
  });
  it("a deliberate part's cast at the row's second, or a [CLEANSE] line, backs it", () => {
    expect(
      checkBacklashDispelWasPressed([
        "0:17  [MINOR DISPELS]   1(HPriest): Purify ×2 (0:17 Unstable Affliction、Haunt — backlash silence landed; 0:26 Hunter's Mark), Phantasm (side effect of the cast) (low-priority, folded)",
        row("17.7"),
      ]),
    ).toHaveLength(0);
    expect(
      checkBacklashDispelWasPressed([
        "0:40  [CLEANSE]   1(HPriest) dispelled 2 effects: Polymorph, Unstable Affliction (Purify)",
        "0:52  [CLEANSE]   1(HPriest) dispelled Unstable Affliction off 3(DWarlock) (Purify)",
        row("40.2"),
        row("52.9"),
      ]),
    ).toHaveLength(0);
  });
  it("the cast at another second, or of another debuff, does not back it", () => {
    expect(
      checkBacklashDispelWasPressed([
        "0:17  [MINOR DISPELS]   1(HPriest): Purify ×1 (0:18 Unstable Affliction) (low-priority, folded)",
        row("17.7"),
        row("18.2", "Vampiric Touch"),
      ]),
    ).toHaveLength(2);
  });
  it("a +N fold anywhere does not excuse the row (a backlash cast is never folded)", () => {
    expect(
      checkBacklashDispelWasPressed([
        "0:05  [MINOR DISPELS]   3(RPriest): Dispel Magic ×6 (0:05 Power Word: Fortitude; 0:12 Mark of the Wild; 0:20 Arcane Intellect; 0:31 Battle Shout, +2) (low-priority, folded)",
        "0:17  [MINOR DISPELS]   1(HPriest): Purify ×5 (0:17 Haunt; 0:26 Haunt; 0:53 Haunt; 1:24 Haunt, +1) (low-priority, folded)",
        row("95.2"),
      ]),
    ).toHaveLength(1);
    expect(
      checkBacklashDispelWasPressed([
        "0:17  [MINOR DISPELS]   1(HPriest): Purify ×6 (0:17 Haunt; 0:26 Haunt; 0:53 Haunt; 1:24 Haunt; 1:35 Unstable Affliction — backlash silence landed, +1) (low-priority, folded)",
        row("95.2"),
      ]),
    ).toHaveLength(0);
  });
});
