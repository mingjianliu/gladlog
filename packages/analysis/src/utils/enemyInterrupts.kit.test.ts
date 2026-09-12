import { CombatUnitClass, CombatUnitSpec, type ICombatUnit } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import kitRaw from "../data/interruptKitGenerated.json";
import { interruptForUnit } from "./enemyInterrupts";

const KIT = (kitRaw as unknown as { interrupts: Record<string, { talent: Record<string, { nodeId: number; entryId: number }> }> }).interrupts;
const unit = (cls: CombatUnitClass, spec: CombatUnitSpec, over: Partial<ICombatUnit> = {}): ICombatUnit =>
  ({ id: "u", name: "u", class: cls, spec, spellCastEvents: [], petSpellCastEvents: [], ...over }) as unknown as ICombatUnit;
const taken = (spellId: string, spec: CombatUnitSpec) => {
  const n = KIT[spellId]!.talent[String(spec)]!;
  return [{ id1: n.nodeId, id2: n.entryId, count: 1 }];
};
const filler = [{ id1: 1, id2: 1, count: 1 }]; // a talent list that does not contain the node

describe("interruptForUnit — official kit (GH #78, user correction 2026-09-12)", () => {
  it("Holy Paladin, Preservation Evoker, Restoration Druid, Mistweaver, Disc/Holy Priest: no interrupt, even with no talent data", () => {
    for (const [c, s] of [
      [CombatUnitClass.Paladin, CombatUnitSpec.Paladin_Holy],
      [CombatUnitClass.Evoker, CombatUnitSpec.Evoker_Preservation],
      [CombatUnitClass.Druid, CombatUnitSpec.Druid_Restoration],
      [CombatUnitClass.Monk, CombatUnitSpec.Monk_Mistweaver],
      [CombatUnitClass.Priest, CombatUnitSpec.Priest_Discipline],
      [CombatUnitClass.Priest, CombatUnitSpec.Priest_Holy],
    ] as const)
      expect(interruptForUnit(unit(c, s)), `${c}/${s}`).toBeNull();
  });
  it("class baseline (SkillLineAbility): Warrior Pummel, Rogue Kick, Mage Counterspell, DH Disrupt — regardless of talents", () => {
    expect(interruptForUnit(unit(CombatUnitClass.Warrior, CombatUnitSpec.Warrior_Arms, { info: { talents: filler } as never }))?.name).toBe("Pummel");
    expect(interruptForUnit(unit(CombatUnitClass.Rogue, CombatUnitSpec.Rogue_Assassination))?.name).toBe("Kick");
    expect(interruptForUnit(unit(CombatUnitClass.Mage, CombatUnitSpec.Mage_Frost))?.name).toBe("Counterspell");
    expect(interruptForUnit(unit(CombatUnitClass.DemonHunter, CombatUnitSpec.DemonHunter_Havoc))?.name).toBe("Disrupt");
  });
  it("spec baseline (SpecializationSpells): Shadow Priest Silence", () => {
    expect(interruptForUnit(unit(CombatUnitClass.Priest, CombatUnitSpec.Priest_Shadow))?.name).toBe("Silence");
  });
  it("talent-tree interrupts count only when the player took the node; no talent list → tree availability", () => {
    const ret = CombatUnitSpec.Paladin_Retribution;
    expect(interruptForUnit(unit(CombatUnitClass.Paladin, ret, { info: { talents: taken("96231", ret) } as never }))?.name).toBe("Rebuke");
    expect(interruptForUnit(unit(CombatUnitClass.Paladin, ret, { info: { talents: filler } as never }))).toBeNull();
    expect(interruptForUnit(unit(CombatUnitClass.Paladin, ret))?.name).toBe("Rebuke");
    const bal = CombatUnitSpec.Druid_Balance;
    expect(interruptForUnit(unit(CombatUnitClass.Druid, bal, { info: { talents: taken("78675", bal) } as never }))?.name).toBe("Solar Beam");
    const pres = CombatUnitSpec.Evoker_Preservation;
    expect(interruptForUnit(unit(CombatUnitClass.Evoker, pres, { info: { talents: taken("351338", CombatUnitSpec.Evoker_Devastation) } as never }))).toBeNull();
  });
  it("pet interrupts (Spell Lock) are observed, never assumed", () => {
    const lock = unit(CombatUnitClass.Warlock, CombatUnitSpec.Warlock_Affliction);
    expect(interruptForUnit(lock)).toBeNull();
    expect(interruptForUnit(unit(CombatUnitClass.Warlock, CombatUnitSpec.Warlock_Affliction, { petSpellCastEvents: [{ spellId: "19647", logLine: { event: "SPELL_CAST_SUCCESS", timestamp: 1 } }] as never }))?.name).toBe("Spell Lock");
  });
});
