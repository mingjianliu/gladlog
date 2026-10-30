/**
 * Triage 2026-09-29, group G4 — who counts as a kicker:
 *  - kick-eaten F-K5c: a kick thrown in the cast-start millisecond was in hand
 *    when the cast began (5e8b11c1 r4, Mind Freeze and Healing Wave both at
 *    157.283);
 *  - res-readiness F-C5: a dead enemy has no interrupt (141470d0 7:21);
 *  - res-readiness F-C5b (ruling A′16): "enemy interrupts UP" = usable at
 *    that instant — a kicker inside a cast-blocking CC is not (b12bfef4 0:53).
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { analyzePlayerCCAndTrinket } from "../src/utils/ccTrinketAnalysis";
import {
  computeEnemyInterruptAvailability,
  interruptCooldownRemainingMs,
  isInterruptUsable,
} from "../src/utils/enemyInterrupts";
import {
  makeAuraEvent,
  makeInterruptEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const START = 1_000_000;
const combat = {
  startTime: START,
  endTime: START + 300_000,
  startInfo: { zoneId: "1672" },
};
const at = (ms: number, x: number, y: number) =>
  [
    { timestamp: ms, advancedActorPositionX: x, advancedActorPositionY: y },
  ] as never;

describe("kick-eaten F-K5c — a kick in the cast-start millisecond was ready at cast start", () => {
  const CAST_START = START + 157_283;
  /** The owner starts Healing Wave at 157.283; the Rogue 2 yd away
   * Kicks in that same millisecond (`kickAtMs`), having last kicked at
   * `previousKickMs`; a Warrior with Pummel stands 5.2 yd away (out of its
   * 5 yd). */
  const scene = (o: { kickAtMs: number; previousKickMs?: number }) => {
    const owner = makeUnit("player-1", {
      actionIn: [
        makeInterruptEvent(
          "1766",
          "Kick",
          "77472",
          "Healing Wave",
          o.kickAtMs,
          "enemy-1",
          "Rogue",
        ),
      ],
      castStartEvents: [
        {
          spellId: "77472",
          logLine: { event: LogEvent.SPELL_CAST_START, timestamp: CAST_START },
        },
      ] as never,
      advancedActions: at(CAST_START, 0, 0),
    });
    const kick = (ms: number) =>
      makeSpellCastEvent(
        "1766",
        ms,
        "player-1",
        "Owner",
        "enemy-1",
        "Rogue",
        0,
        "Kick",
      );
    const rogue = makeUnit("enemy-1", {
      name: "Rogue",
      reaction: CombatUnitReaction.Hostile,
      class: CombatUnitClass.Rogue,
      spec: CombatUnitSpec.Rogue_Assassination,
      advancedActions: at(CAST_START, 0, 2),
      spellCastEvents: [
        ...(o.previousKickMs === undefined ? [] : [kick(o.previousKickMs)]),
        kick(o.kickAtMs),
      ],
    });
    const warrior = makeUnit("enemy-2", {
      name: "Warrior",
      reaction: CombatUnitReaction.Hostile,
      class: CombatUnitClass.Warrior,
      spec: CombatUnitSpec.Warrior_Arms,
      advancedActions: at(CAST_START, 0, 5.2),
    });
    return {
      rogue,
      inst: analyzePlayerCCAndTrinket(owner, [rogue, warrior], combat)
        .interruptInstances[0]!,
    };
  };

  it("5e8b11c1 r4: the kicker whose kick shares the cast-start ms is in range (the match's Death Knight; a baseline Kick here, the fixture has no talent list)", () => {
    const { inst } = scene({
      kickAtMs: CAST_START,
      previousKickMs: START + 130_494,
    });
    expect(inst.kickersInRange).toBe(1);
    expect(inst.nearestKickerName).toBe("Rogue");
    expect(inst.nearestKickerDistYd).toBe(2);
    expect(inst.maxKickRangeYd).toBe(5);
  });

  it("control: a kick still cooling from a press strictly BEFORE the cast start is not ready", () => {
    // previous Kick 5 s before the cast start (15 s cooldown): the
    // kick that lands in the cast-start ms cannot be this unit's own ready
    // kick, so the fact stays as it was
    const { inst } = scene({
      kickAtMs: CAST_START,
      previousKickMs: CAST_START - 5_000,
    });
    expect(inst.kickersInRange).toBe(0);
    expect(inst.nearestKickerName).toBe("Warrior");
  });

  it("the general helper keeps its `<=`: a kick logged at t is spent at t", () => {
    const { rogue } = scene({ kickAtMs: CAST_START });
    expect(interruptCooldownRemainingMs(rogue, "1766", CAST_START)).toBe(
      15_000,
    );
    expect(interruptCooldownRemainingMs(rogue, "1766", CAST_START - 1)).toBe(0);
  });
});

describe("res-readiness F-C5 / F-C5b — a dead or crowd-controlled kicker is not UP", () => {
  const T = START + 53_119;
  const friend = makeUnit("friend-1", {
    name: "Friend",
    info: {} as never,
  });
  const stun = (dest: string, fromMs: number, toMs: number, spellId = "408") =>
    [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        spellId,
        fromMs,
        "friend-1",
        dest,
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        spellId,
        toMs,
        "friend-1",
        dest,
      ),
    ].map((a) => ({ ...a, spellName: spellId }));
  const enemy = (
    id: string,
    cls: CombatUnitClass,
    spec: CombatUnitSpec,
    extra: Parameters<typeof makeUnit>[1] = {},
  ) =>
    makeUnit(id, {
      name: id,
      reaction: CombatUnitReaction.Hostile,
      class: cls,
      spec,
      info: {} as never,
      ...extra,
    });
  const usable = (enemies: ICombatUnit[], units?: ICombatUnit[]) =>
    computeEnemyInterruptAvailability(enemies, T, units)
      .filter(isInterruptUsable)
      .map((s) => s.enemyName);

  it("F-C5: an enemy dead before the instant is not listed at all", () => {
    const dead = enemy(
      "Druid",
      CombatUnitClass.Druid,
      CombatUnitSpec.Druid_Balance,
      { deathRecords: [{ timestamp: START + 40_000 }] },
    );
    const alive = enemy(
      "Shaman",
      CombatUnitClass.Shaman,
      CombatUnitSpec.Shaman_Restoration,
    );
    const states = computeEnemyInterruptAvailability([dead, alive], T);
    expect(states.map((s) => s.enemyName)).toEqual(["Shaman"]);
    // alive at the instant, dead later → still listed
    const later = enemy(
      "Druid",
      CombatUnitClass.Druid,
      CombatUnitSpec.Druid_Balance,
      { deathRecords: [{ timestamp: T + 1 }] },
    );
    expect(
      computeEnemyInterruptAvailability([later], T).map((s) => s.enemyName),
    ).toEqual(["Druid"]);
  });

  it("F-C5b: a kicker stunned at the instant is off cooldown but not usable (b12bfef4 0:53)", () => {
    const shaman = enemy(
      "Shaman",
      CombatUnitClass.Shaman,
      CombatUnitSpec.Shaman_Restoration,
      { auraEvents: stun("Shaman", START + 49_757, START + 54_771) },
    );
    const units = [friend, shaman];
    const [state] = computeEnemyInterruptAvailability([shaman], T, units);
    expect(state!.cdRemainingSeconds).toBe(0);
    expect(state!.ccd).toBe(true);
    expect(usable([shaman], units)).toEqual([]);
    // the stun over → usable again
    expect(
      computeEnemyInterruptAvailability([shaman], START + 54_771, units)[0]!
        .ccd,
    ).toBe(false);
  });

  it("without the round's units nothing is `ccd` — unknown is never blocked", () => {
    const shaman = enemy(
      "Shaman",
      CombatUnitClass.Shaman,
      CombatUnitSpec.Shaman_Restoration,
      { auraEvents: stun("Shaman", START + 49_757, START + 54_771) },
    );
    expect(usable([shaman])).toEqual(["Shaman"]);
  });

  it("a silence stops a silenceable kick (Wind Shear), not a physical one (Pummel)", () => {
    // Garrote - Silence 1330
    const silence = (dest: string) =>
      stun(dest, START + 50_000, START + 56_000, "1330");
    const shaman = enemy(
      "Shaman",
      CombatUnitClass.Shaman,
      CombatUnitSpec.Shaman_Restoration,
      { auraEvents: silence("Shaman") },
    );
    const warrior = enemy(
      "Warrior",
      CombatUnitClass.Warrior,
      CombatUnitSpec.Warrior_Arms,
      { auraEvents: silence("Warrior") },
    );
    expect(usable([shaman, warrior], [friend, shaman, warrior])).toEqual([
      "Warrior",
    ]);
  });

  it("an aura from the kicker's own side is not a CC on it", () => {
    const mate = enemy(
      "Mate",
      CombatUnitClass.Priest,
      CombatUnitSpec.Priest_Holy,
    );
    const shaman = enemy(
      "Shaman",
      CombatUnitClass.Shaman,
      CombatUnitSpec.Shaman_Restoration,
      {
        auraEvents: [
          makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            "408",
            START + 50_000,
            "Mate",
            "Shaman",
          ),
        ],
      },
    );
    expect(usable([shaman, mate], [friend, shaman, mate])).toEqual(["Shaman"]);
  });

  it("a pet kick is asked of the pet that casts it: the Warlock stunned, the Felhunter free → usable", () => {
    const spellLock = makeSpellCastEvent(
      "19647",
      START + 10_000,
      "friend-1",
      "Friend",
      "pet-1",
      "Felhunter",
      0,
      "Spell Lock",
    );
    const lock = enemy(
      "Lock",
      CombatUnitClass.Warlock,
      CombatUnitSpec.Warlock_Affliction,
      {
        auraEvents: stun("Lock", START + 50_000, START + 56_000),
        petSpellCastEvents: [spellLock],
      },
    );
    const pet = makeUnit("pet-1", {
      name: "Felhunter",
      reaction: CombatUnitReaction.Hostile,
      ownerId: "Lock",
    });
    const freePet = usable([lock], [friend, lock, pet]);
    expect(freePet).toEqual(["Lock"]);
    // the pet itself stunned → not usable
    const stunnedPet = makeUnit("pet-1", {
      name: "Felhunter",
      reaction: CombatUnitReaction.Hostile,
      ownerId: "Lock",
      auraEvents: stun("pet-1", START + 50_000, START + 56_000),
    });
    expect(usable([lock], [friend, lock, stunnedPet])).toEqual([]);
    // a replacement pet summoned later (first seen at 80 s) does not make the
    // stunned active one read free (codex review)
    const laterPet = makeUnit("pet-2", {
      name: "Felhunter",
      reaction: CombatUnitReaction.Hostile,
      ownerId: "Lock",
      spellCastEvents: [
        {
          ...spellLock,
          srcUnitId: "pet-2",
          timestamp: START + 80_000,
          logLine: { ...spellLock.logLine, timestamp: START + 80_000 },
        },
      ] as never,
    });
    const lock2 = enemy(
      "Lock",
      CombatUnitClass.Warlock,
      CombatUnitSpec.Warlock_Affliction,
      {
        auraEvents: stun("Lock", START + 50_000, START + 56_000),
        petSpellCastEvents: [spellLock, { ...spellLock, srcUnitId: "pet-2" }],
      },
    );
    expect(usable([lock2], [friend, lock2, stunnedPet, laterPet])).toEqual([]);
  });
});
