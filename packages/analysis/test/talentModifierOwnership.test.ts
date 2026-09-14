import { CombatUnitSpec } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  talentModifierOwnershipOf,
  talentOwnershipOf,
} from "../src/utils/talentOwnership";

// GH #96 M3b run 1 (2026-09-13): the plain predicate's "baseline by
// elimination" step read another spec's talent as held — all 302 Barkskin
// casters "held" the Guardian-only Reinforced Fur (393618).
const REINFORCED_FUR = "393618";

const unit = (spec: string) =>
  ({
    spec,
    info: { talents: [], pvpTalents: [] },
    spellCastEvents: [],
  }) as never;

describe("talentModifierOwnershipOf", () => {
  it("a talent outside the caster's spec trees and PvP pool is not held", () => {
    const resto = unit(CombatUnitSpec.Druid_Restoration);
    // the trap this predicate exists for
    expect(talentOwnershipOf(resto, REINFORCED_FUR)).toBe("yes");
    expect(talentModifierOwnershipOf(resto, REINFORCED_FUR)).toBe("no");
  });

  it("inside the spec's trees it defers to the tree selection", () => {
    const guardian = unit(CombatUnitSpec.Druid_Guardian);
    expect(talentModifierOwnershipOf(guardian, REINFORCED_FUR)).toBe(
      talentOwnershipOf(guardian, REINFORCED_FUR),
    );
    expect(talentModifierOwnershipOf(guardian, REINFORCED_FUR)).not.toBe("yes");
  });

  it("an unparseable spec stays unknown", () => {
    expect(talentModifierOwnershipOf(unit("0x"), REINFORCED_FUR)).toBe(
      "unknown",
    );
  });
});
