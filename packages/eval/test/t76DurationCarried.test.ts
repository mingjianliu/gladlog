/**
 * T76: the tools that list which talent duration modifiers the product does
 * NOT price ask one predicate, and it knows every table that prices one.
 */
import { CC_DURATION_TALENT_MODIFIERS } from "@gladlog/analysis/src/data/spellEffectData";
import { describe, expect, it } from "vitest";

import {
  durationAuraCarryingTalent,
  durationPairCarriedBy,
  durationPairCorpusPending,
} from "../scripts/lib/durationCarried";

describe("durationPairCarriedBy", () => {
  it("names the table that prices the pair", () => {
    // Rallying Cry's aura under Battlefield Commander — the hand table
    expect(durationPairCarriedBy("97463", "424742")).toBe("hand");
    // Havoc under Improved Havoc — a tooltip row, which the two tools missed
    expect(durationPairCarriedBy("80240", "1244460")).toBe("tooltip");
    // Spiritwalker's Grace under Spiritwalker's Momentum — per event
    expect(durationPairCarriedBy("79206", "443425")).toBe("per-event");
  });

  it("is undefined for a pair no table names, and for the wrong talent on a priced aura", () => {
    expect(durationPairCarriedBy("80240", "424742")).toBeUndefined();
    expect(durationPairCarriedBy("999999999", "1244460")).toBeUndefined();
  });

  it("a CC entry written on DB2 + tooltip alone is priced and still pending", () => {
    for (const blind of ["2094", "427773"]) {
      expect(durationPairCarriedBy(blind, "200733")).toBe("hand");
    }
    expect(durationPairCorpusPending("97463", "424742")).toBe(false);
    // the answer, not its type (T208 / GH #218 10.8): pending is exactly
    // "an entry of that talent on that aura carries `corpusPending`", for
    // every control entry — true while an entry waits for its holders,
    // false once the corpus split replaced the note
    let entries = 0;
    for (const [aura, mods] of Object.entries(CC_DURATION_TALENT_MODIFIERS))
      for (const m of mods) {
        if (m.talentSpellId === undefined) continue;
        entries++;
        expect(
          durationPairCorpusPending(aura, m.talentSpellId),
          `${aura}|${m.talentSpellId}`,
        ).toBe(
          mods.some(
            (o) =>
              o.talentSpellId === m.talentSpellId &&
              o.corpusPending !== undefined,
          ),
        );
      }
    expect(entries).toBeGreaterThan(0);
  });

  it("durationAuraCarryingTalent finds the aura for a talent of each table, and none for a talent no table names (T208)", () => {
    expect(durationAuraCarryingTalent("424742")).toBe("97463");
    expect(
      durationPairCarriedBy(durationAuraCarryingTalent("1244460")!, "1244460"),
    ).toBe("tooltip");
    expect(
      durationPairCarriedBy(durationAuraCarryingTalent("443425")!, "443425"),
    ).toBe("per-event");
    expect(
      durationPairCarriedBy(durationAuraCarryingTalent("200733")!, "200733"),
    ).toBe("hand");
    expect(durationAuraCarryingTalent("999999999")).toBeUndefined();
  });
});
