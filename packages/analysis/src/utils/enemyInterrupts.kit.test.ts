import {
  CombatUnitClass,
  CombatUnitSpec,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import kitRaw from "../data/interruptKitGenerated.json";
import {
  computeEnemyInterruptAvailability,
  interruptForUnit,
  kickCastSpellId,
} from "./enemyInterrupts";

const KIT = (
  kitRaw as unknown as {
    interrupts: Record<
      string,
      { talent: Record<string, { nodeId: number; entryId: number }> }
    >;
  }
).interrupts;
const unit = (
  cls: CombatUnitClass,
  spec: CombatUnitSpec,
  over: Partial<ICombatUnit> = {},
): ICombatUnit =>
  ({
    id: "u",
    name: "u",
    class: cls,
    spec,
    spellCastEvents: [],
    petSpellCastEvents: [],
    ...over,
  }) as unknown as ICombatUnit;
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
    expect(
      interruptForUnit(
        unit(CombatUnitClass.Warrior, CombatUnitSpec.Warrior_Arms, {
          info: { talents: filler } as never,
        }),
      )?.name,
    ).toBe("Pummel");
    expect(
      interruptForUnit(
        unit(CombatUnitClass.Rogue, CombatUnitSpec.Rogue_Assassination),
      )?.name,
    ).toBe("Kick");
    expect(
      interruptForUnit(unit(CombatUnitClass.Mage, CombatUnitSpec.Mage_Frost))
        ?.name,
    ).toBe("Counterspell");
    expect(
      interruptForUnit(
        unit(CombatUnitClass.DemonHunter, CombatUnitSpec.DemonHunter_Havoc),
      )?.name,
    ).toBe("Disrupt");
  });
  it("spec baseline (SpecializationSpells): Shadow Priest Silence", () => {
    expect(
      interruptForUnit(
        unit(CombatUnitClass.Priest, CombatUnitSpec.Priest_Shadow),
      )?.name,
    ).toBe("Silence");
  });
  it("talent-tree interrupts count only when the player took the node; no talent list → tree availability", () => {
    const ret = CombatUnitSpec.Paladin_Retribution;
    expect(
      interruptForUnit(
        unit(CombatUnitClass.Paladin, ret, {
          info: { talents: taken("96231", ret) } as never,
        }),
      )?.name,
    ).toBe("Rebuke");
    expect(
      interruptForUnit(
        unit(CombatUnitClass.Paladin, ret, {
          info: { talents: filler } as never,
        }),
      ),
    ).toBeNull();
    expect(interruptForUnit(unit(CombatUnitClass.Paladin, ret))?.name).toBe(
      "Rebuke",
    );
    const bal = CombatUnitSpec.Druid_Balance;
    expect(
      interruptForUnit(
        unit(CombatUnitClass.Druid, bal, {
          info: { talents: taken("78675", bal) } as never,
        }),
      )?.name,
    ).toBe("Solar Beam");
    const pres = CombatUnitSpec.Evoker_Preservation;
    expect(
      interruptForUnit(
        unit(CombatUnitClass.Evoker, pres, {
          info: {
            talents: taken("351338", CombatUnitSpec.Evoker_Devastation),
          } as never,
        }),
      ),
    ).toBeNull();
  });
  it("pet interrupts (Spell Lock) are observed, never assumed", () => {
    const lock = unit(
      CombatUnitClass.Warlock,
      CombatUnitSpec.Warlock_Affliction,
    );
    expect(interruptForUnit(lock)).toBeNull();
    expect(
      interruptForUnit(
        unit(CombatUnitClass.Warlock, CombatUnitSpec.Warlock_Affliction, {
          petSpellCastEvents: [
            {
              spellId: "19647",
              logLine: { event: "SPELL_CAST_SUCCESS", timestamp: 1 },
            },
          ] as never,
        }),
      )?.name,
    ).toBe("Spell Lock");
  });
});

describe("interruptForUnit — `confirmed` provenance (codex round-1, 2026-09-12)", () => {
  it("baseline kits and talents present in the log are confirmed; tree-availability fallback and pets are not", () => {
    expect(
      interruptForUnit(
        unit(CombatUnitClass.Warrior, CombatUnitSpec.Warrior_Arms),
      )?.confirmed,
    ).toBe(true);
    expect(
      interruptForUnit(
        unit(CombatUnitClass.Priest, CombatUnitSpec.Priest_Shadow),
      )?.confirmed,
    ).toBe(true);
    const ret = CombatUnitSpec.Paladin_Retribution;
    expect(
      interruptForUnit(
        unit(CombatUnitClass.Paladin, ret, {
          info: { talents: taken("96231", ret) } as never,
        }),
      )?.confirmed,
    ).toBe(true);
    expect(
      interruptForUnit(unit(CombatUnitClass.Paladin, ret))?.confirmed,
    ).toBe(false);
    expect(
      interruptForUnit(
        unit(CombatUnitClass.Warlock, CombatUnitSpec.Warlock_Affliction, {
          petSpellCastEvents: [
            {
              spellId: "19647",
              logLine: { event: "SPELL_CAST_SUCCESS", timestamp: 1 },
            },
          ] as never,
        }),
      )?.confirmed,
    ).toBe(false);
  });
});

describe("computeEnemyInterruptAvailability — seen & assumedReady tracking (GH #88, B8)", () => {
  it("marks interrupt as assumedReady: true and seen: false when enemy never cast it at/before atMs", () => {
    const warrior = unit(CombatUnitClass.Warrior, CombatUnitSpec.Warrior_Arms, {
      name: "Warrior",
    });
    const states = computeEnemyInterruptAvailability([warrior], 30_000);
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({
      enemyName: "Warrior",
      spellName: "Pummel",
      cdRemainingSeconds: 0,
      seen: false,
      assumedReady: true,
    });
  });

  it("marks interrupt as seen: true and assumedReady: false when on cooldown", () => {
    const warrior = unit(CombatUnitClass.Warrior, CombatUnitSpec.Warrior_Arms, {
      name: "Warrior",
      spellCastEvents: [
        {
          spellId: "6552", // Pummel (15s CD)
          logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: 25_000 },
        } as never,
      ],
    });
    const states = computeEnemyInterruptAvailability([warrior], 30_000); // 5s after cast -> 10s left
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({
      enemyName: "Warrior",
      spellName: "Pummel",
      cdRemainingSeconds: 10,
      seen: true,
      assumedReady: false,
    });
  });

  it("marks interrupt as seen: true and assumedReady: false when cast previously and ready again", () => {
    const warrior = unit(CombatUnitClass.Warrior, CombatUnitSpec.Warrior_Arms, {
      name: "Warrior",
      spellCastEvents: [
        {
          spellId: "6552", // Pummel (15s CD)
          logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: 10_000 },
        } as never,
      ],
    });
    const states = computeEnemyInterruptAvailability([warrior], 30_000); // 20s after cast -> ready
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({
      enemyName: "Warrior",
      spellName: "Pummel",
      cdRemainingSeconds: 0,
      seen: true,
      assumedReady: false,
    });
  });
});

describe("kickCastSpellId — a kick event's effect id resolves to its cast (range audit, 2026-09-26)", () => {
  it("Skull Bash / Solar Beam / Spell Lock effect ids → the castable same-named entry", () => {
    expect(kickCastSpellId("93985")).toBe("106839");
    expect(kickCastSpellId("97547")).toBe("78675");
    expect(kickCastSpellId("119910")).toBe("19647");
    expect(kickCastSpellId("132409")).toBe("19647");
  });

  it("a castable id, an effect-only id with no castable twin, or an unknown id is unchanged", () => {
    expect(kickCastSpellId("106839")).toBe("106839");
    expect(kickCastSpellId("347008")).toBe("347008"); // Axe Toss: no castable twin in the kit
    expect(kickCastSpellId("999999999")).toBe("999999999");
  });

  it("no effect-only entry has two castable twins (the resolver would have to guess)", () => {
    type Entry = {
      name: string;
      classBaseline: number[];
      specBaseline: number[];
      talent: Record<string, unknown>;
      pet: boolean;
    };
    const k = (kitRaw as unknown as { interrupts: Record<string, Entry> })
      .interrupts;
    const castable = (e: Entry) =>
      e.classBaseline.length > 0 ||
      e.specBaseline.length > 0 ||
      Object.keys(e.talent).length > 0 ||
      e.pet;
    for (const [id, e] of Object.entries(k)) {
      if (castable(e)) continue;
      const twins = Object.entries(k).filter(
        ([j, x]) => j !== id && x.name === e.name && castable(x),
      );
      expect(twins.length, `${id} ${e.name}`).toBeLessThanOrEqual(1);
    }
  });
});
