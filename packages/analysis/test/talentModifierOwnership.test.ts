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

  // GH #96 review (codex astra): a choice node listed with id2 0 reads as
  // "every entry chosen" in the kit walk — for a modifier that is unknown
  it("a choice node whose entry id selects nothing is unknown, not yes", () => {
    const arms = {
      spec: CombatUnitSpec.Warrior_Arms,
      info: { talents: [{ id1: 94789, id2: 0, count: 1 }], pvpTalents: [] },
      spellCastEvents: [],
    } as never;
    expect(talentOwnershipOf(arms, "429639")).toBe("yes"); // the kit walk's reading
    expect(talentModifierOwnershipOf(arms, "429639")).toBe("unknown");
    const holy = {
      spec: CombatUnitSpec.Paladin_Holy,
      info: { talents: [{ id1: 93520, id2: 0, count: 1 }], pvpTalents: [] },
      spellCastEvents: [],
    } as never;
    expect(talentModifierOwnershipOf(holy, "387801")).toBe("unknown");
  });

  it("an unparseable spec stays unknown", () => {
    expect(talentModifierOwnershipOf(unit("0x"), REINFORCED_FUR)).toBe(
      "unknown",
    );
  });
});
