/**
 * Reliability leftovers batch 4 (2026-09-26): spec-passive range modifiers
 * apply by spec; Cauterizing Flame is not a save cooldown (user ruling).
 */
import { CombatUnitSpec } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import roster from "../src/data/healerSaveCdGenerated.json";
import { spellRangeForCaster, spellReachToAccuse } from "../src/utils/spellRange";

beforeAll(async () => {
  await ensureAnalysisData();
});

const caster = (spec: CombatUnitSpec) =>
  ({ spec, info: undefined, spellCastEvents: [] }) as never;

describe("spec-passive range modifiers apply by spec (GH #120 §1)", () => {
  it("Preservation's +5 reaches Living Flame / Verdant Embrace; Holy Paladin's +10 reaches Divine Toll; other specs unchanged", () => {
    expect(spellRangeForCaster(caster(CombatUnitSpec.Evoker_Preservation), "361469")).toBe(30);
    expect(spellRangeForCaster(caster(CombatUnitSpec.Evoker_Preservation), "360995")).toBe(30);
    expect(spellRangeForCaster(caster(CombatUnitSpec.Evoker_Devastation), "361469")).toBe(25);
    expect(spellRangeForCaster(caster(CombatUnitSpec.Paladin_Holy), "375576")).toBe(40);
    expect(spellRangeForCaster(caster(CombatUnitSpec.Paladin_Retribution), "375576")).toBe(30);
  });
  it("a spec passive is never 'unknown ownership' for the accusation reach", () => {
    expect(spellReachToAccuse(caster(CombatUnitSpec.Evoker_Preservation), "361469")).not.toBeNull();
  });
});

describe("Cauterizing Flame 374251 is out of the save roster (user ruling 2026-09-26)", () => {
  it("no spec lists it as a save; Preservation's rejectedForReview carries the ruling", () => {
    const specs = (roster as { specs: Record<string, { spells: { spellId: string }[] }> }).specs;
    for (const [spec, s] of Object.entries(specs))
      expect(s.spells.some((x) => x.spellId === "374251"), spec).toBe(false);
    const rej = (roster as { rejectedForReview: Record<string, { spellId: string; reason: string }[]> }).rejectedForReview["Preservation Evoker"];
    expect(rej.find((r) => r.spellId === "374251")?.reason).toContain("not_save_role, 2026-09-26");
  });
});
