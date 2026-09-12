import { CombatUnitReaction, CombatUnitSpec } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { ensureHeroTalents } from "@gladlog/analysis";

import type { KeystoneGate } from "./keystoneGates";
import { combatToRecords } from "./perMatchRecord";

const SHAMAN = CombatUnitSpec.Shaman_Restoration;
const WARRIOR = CombatUnitSpec.Warrior_Arms;
const PALADIN = CombatUnitSpec.Paladin_Holy;

// Synthesize a match: 1 Friendly healer (Resto Shaman) + 2 Hostile melee dps
// + 1 Hostile healer. Fields are the minimal set computeHealerMetrics /
// extractRotations actually read (same stub technique as T1).
// reaction: CombatUnitReaction.Friendly=1, Hostile=2. type: Player=1.
function unit(name: string, spec: string, reaction: number): any {
  return {
    id: name,
    name,
    spec,
    type: 1,
    reaction,
    damageOut: [],
    healOut: [],
    absorbsOut: [],
    damageIn: [],
    spellCastEvents: [],
    actionIn: [],
    auraEvents: [],
    advancedActions: [],
    deathRecords: [],
    info: { teamId: reaction === 1 ? "0" : "1" },
  };
}
function synthCombat(): any {
  const healer = unit("Me-Realm-US", SHAMAN, 1);
  const eMelee1 = unit("E1-Realm-US", WARRIOR, 2);
  const eMelee2 = unit("E2-Realm-US", WARRIOR, 2);
  const eHealer = unit("EH-Realm-US", PALADIN, 2);
  return {
    units: {
      [healer.name]: healer,
      [eMelee1.name]: eMelee1,
      [eMelee2.name]: eMelee2,
      [eHealer.name]: eHealer,
    },
    startTime: 0,
    endTime: 120000,
    playerId: "Me-Realm-US",
    startInfo: { bracket: "3v3", zoneId: 1 },
  };
}

describe("combatToRecords", () => {
  it("emits one record per Friendly healer with in-domain metrics + comp archetype", () => {
    const recs = combatToRecords(synthCombat(), []);
    expect(recs.length).toBe(1); // only the Friendly Resto Shaman
    const r = recs[0];
    expect(r.spec).toBeTruthy();
    expect(r.bracket).toBe("3v3");
    expect(r.archetype).toBe("melee_cleave"); // 2 enemy melee dps
    expect(
      typeof (r.metrics as unknown as Record<string, unknown>).offensiveIndex,
    ).toBe("number");
    for (const c of r.crisisEvents) expect(c).toMatch(/^[\x00-\x7F]*$/);
  });
  it("Friendly 非治疗照样出记录(DPS 指标组,pro-comparison P1)", () => {
    const c = synthCombat();
    // Swap the Friendly healer for a melee -> an IDpsMetrics record comes out
    // instead of []
    c.units["Me-Realm-US"].spec = WARRIOR;
    const recs = combatToRecords(c, []);
    expect(recs).toHaveLength(1);
    const m = recs[0]!.metrics as unknown as Record<string, unknown>;
    expect(typeof m.burstCount).toBe("number");
    expect("offensiveIndex" in m).toBe(false);
  });
});

const discGate: KeystoneGate = {
  spec: "Discipline Priest",
  keystoneNodeIds: [82585],
  match: "any",
  metric: "offensiveIndex",
  groupPresent: "offensive",
  groupAbsent: "standard",
};

// Minimal synthetic combat with one Friendly Disc Priest healer carrying talents.
// actionIn/auraEvents are required beyond the brief's literal fields: computeHealerMetrics
// reads them (via cooldowns/ccTrinketAnalysis/enemyCDs) and throws without them, matching
// the field set already used by the sibling stubs in this file and in
// packages/analysis/src/utils/healerMetrics.test.ts.
function combatWithDiscTalents(talentIds: number[]): any {
  const healer = {
    id: "h1",
    name: "H-Realm-US",
    type: 1, // Player
    reaction: CombatUnitReaction.Friendly,
    spec: CombatUnitSpec.Priest_Discipline,
    info: {
      teamId: "0",
      talents: talentIds.map((id1) => ({ id1, id2: 0, count: 1 })),
    },
    damageOut: [],
    healOut: [],
    absorbsOut: [],
    spellCastEvents: [],
    actionIn: [],
    auraEvents: [],
    advancedActions: [],
    deathRecords: [],
    damageIn: [],
  };
  const enemy = {
    id: "e1",
    name: "E-Realm-US",
    type: 1,
    reaction: CombatUnitReaction.Hostile,
    spec: CombatUnitSpec.Warrior_Arms,
    info: { teamId: "1" },
    damageOut: [],
    healOut: [],
    absorbsOut: [],
    spellCastEvents: [],
    actionIn: [],
    auraEvents: [],
    advancedActions: [],
    deathRecords: [],
    damageIn: [],
  };
  return {
    units: { h1: healer, e1: enemy },
    startTime: 0,
    endTime: 60000,
    startInfo: { bracket: "2v2" },
  };
}

describe("combatToRecords buildGroup", () => {
  it("assigns groupPresent when the healer has a keystone node", () => {
    const recs = combatToRecords(combatWithDiscTalents([82585, 999]), [
      discGate,
    ]);
    expect(recs).toHaveLength(1);
    expect(recs[0].buildGroup).toBe("offensive");
  });
  it("assigns groupAbsent when the healer lacks the keystone", () => {
    const recs = combatToRecords(combatWithDiscTalents([111, 222]), [discGate]);
    expect(recs[0].buildGroup).toBe("standard");
  });
  it("assigns '*' when the spec is not gated", () => {
    const recs = combatToRecords(combatWithDiscTalents([82585]), []);
    expect(recs[0].buildGroup).toBe("*");
  });

  // User ruling 2026-09-11: the hero tree is the default dimension for EVERY
  // healer, so a keystone declaration no longer outranks it. Discipline was the
  // only gated spec and therefore the only healer not split by hero tree, while
  // its two trees are measurably two builds (Shadow Mend 72–79% of Oracle vs
  // 41–57% of Voidweaver). The gate stays as the fallback for loadouts whose
  // hero tree cannot be resolved — that is what the three tests above pin.
  it("hero tree outranks a keystone declaration (2026-09-11)", async () => {
    await ensureHeroTalents();
    const combat = combatWithDiscTalents([82585]);
    // 123290 = Oracle's subtree entry id, the shape COMBATANT_INFO really has.
    combat.units.h1.info.talents.push({ id1: 90000, id2: 123290, count: 1 });
    const recs = combatToRecords(combat, [discGate]);
    expect(recs[0].buildGroup).toBe("Oracle");
  });
});
