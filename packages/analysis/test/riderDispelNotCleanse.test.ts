/**
 * Reliability audit D1 (2026-09-25): a `rider` SPELL_DISPEL (a form shift or
 * movement ability breaking a root — dispelKind.ts) is not a cleanse, and a
 * unit that freed ITSELF that way has no cleanse window at all (user ruling
 * 2026-09-24 「自己变形解掉的，当然不算」). a9bc48b5 @2:51: Tree of Life expiry
 * broke Entangling Roots and was rendered as a late cleanse.
 */
import { describe, expect, it } from "vitest";

import {
  type IDispelEvent,
  wasRemovedByAllyDispel,
  wasRemovedBySelfRider,
} from "../src/utils/dispelAnalysis";

const ev = (over: Partial<IDispelEvent>): IDispelEvent =>
  ({
    timeSeconds: 171.65,
    sourceName: "Druid-R",
    targetName: "Druid-R",
    removedSpellId: "339",
    removedSpellName: "Entangling Roots",
    dispelKind: "rider",
    ...over,
  }) as IDispelEvent;

describe("rider removals are not cleanses (D1)", () => {
  it("a self rider (Tree of Life expiry) is not a cleanse, and it IS a self-rider", () => {
    const all = [ev({})];
    expect(wasRemovedByAllyDispel(all, "339", "Druid-R", 171.65)).toBe(false);
    expect(wasRemovedBySelfRider(all, "339", "Druid-R", 171.65)).toBe(true);
  });
  it("another unit's rider is not a cleanse and not a self-rider", () => {
    const all = [ev({ sourceName: "Paladin-R" })];
    expect(wasRemovedByAllyDispel(all, "339", "Druid-R", 171.65)).toBe(false);
    expect(wasRemovedBySelfRider(all, "339", "Druid-R", 171.65)).toBe(false);
  });
  it("a deliberate cleanse and a proc strip still count as cleanses", () => {
    for (const kind of ["deliberate", "proc"] as const) {
      const all = [ev({ sourceName: "Priest-R", dispelKind: kind })];
      expect(wasRemovedByAllyDispel(all, "339", "Druid-R", 171.66)).toBe(true);
      expect(wasRemovedBySelfRider(all, "339", "Druid-R", 171.66)).toBe(false);
    }
  });
});
