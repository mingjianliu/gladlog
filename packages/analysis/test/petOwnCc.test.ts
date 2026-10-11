/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A spell the unit's PET casts is stopped by a control or a lockout on the
 * PET, not on the owner (2026-10-11; corpus numbers on `petCastSpellIdsOf`:
 * fix-FT/scripts/t10_petHardCc.ts, 605 files — the pet casts inside the
 * owner's cast-blocking aura as often as outside one, and half as often when
 * the pet itself is under one).
 *
 * Shape: a Warlock in Hammer of Justice still commands Spell Lock / Devour
 * Magic; a stunned Felhunter does not cast them.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { kickPriorityDecisionPoints } from "../src/analysis/candidates/kickPriority";
import { ensureAnalysisData } from "../src/data/ensure";
import { spellSchoolMask } from "../src/data/spellSchools";
import {
  actWindowFor,
  buildCannotCastIntervals,
  cannotCastIntervalsForSpells,
  namedCannotCastIntervals,
  petCastersOf,
} from "../src/utils/cannotCastIntervals";
import { deathWindowFreedom } from "../src/utils/deathOutcomeAnalysis";
import {
  purgePriorityForTest,
  reconstructDispelSummary,
} from "../src/utils/dispelAnalysis";
import {
  makeAdvancedAction,
  makeAuraEvent,
  makeInterruptEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;
const HAMMER_OF_JUSTICE = "853"; // stun
const SPELL_LOCK = "19647"; // Shadow — the Felhunter's
const DEVOUR_MAGIC = "19505"; // Shadow — the Felhunter's
const SHADOWFURY = "30283"; // the Warlock's own
const COUNTERSPELL = "2139";
const FIREBALL = "133"; // Fire
const enemyIds = new Set(["e"]);

beforeAll(async () => {
  await ensureAnalysisData();
});

const stun = (onId: string, fromS: number, toS: number) => [
  makeAuraEvent(
    LogEvent.SPELL_AURA_APPLIED,
    HAMMER_OF_JUSTICE,
    at(fromS),
    "e",
    onId,
  ),
  makeAuraEvent(
    LogEvent.SPELL_AURA_REMOVED,
    HAMMER_OF_JUSTICE,
    at(toS),
    "e",
    onId,
  ),
];
const petCast = (spellId: string, atS: number, petId = "Pet-1") =>
  makeSpellCastEvent(spellId, at(atS), "e", "Enemy", petId, "Felhunter");

/** A Warlock ("w") and its Felhunter ("Pet-1"); the pet pressed Spell Lock and
 * Devour Magic earlier in the round, the Warlock Shadowfury. */
function pair(opts: {
  ownerStun?: [number, number];
  petStun?: [number, number];
  petCasts?: any[];
  ownerCasts?: any[];
  petActionIn?: any[];
  ownerDeathS?: number;
}) {
  const warlock = makeUnit("w", {
    name: "Warlock",
    spec: CombatUnitSpec.Warlock_Affliction,
    info: {},
    auraEvents: opts.ownerStun ? stun("w", ...opts.ownerStun) : [],
    spellCastEvents: opts.ownerCasts ?? [
      makeSpellCastEvent(SHADOWFURY, at(30), "e", "Enemy", "w", "Warlock"),
    ],
    petSpellCastEvents: opts.petCasts ?? [
      petCast(SPELL_LOCK, 20),
      petCast(DEVOUR_MAGIC, 25),
    ],
    deathRecords:
      opts.ownerDeathS === undefined
        ? []
        : [{ timestamp: at(opts.ownerDeathS) }],
  });
  const pet = makeUnit("Pet-1", {
    name: "Felhunter",
    ownerId: "w",
    auraEvents: opts.petStun ? stun("Pet-1", ...opts.petStun) : [],
    actionIn: opts.petActionIn ?? [],
  });
  return { warlock, pet, units: [warlock, pet] };
}
const spans = (ivs: ReadonlyArray<{ from: number; to: number }>) =>
  ivs.map((iv) => [(iv.from - T0) / 1000, (iv.to - T0) / 1000]);

describe("the one cannot-cast reading for a pet-cast spell", () => {
  it("the schools and the pet casters the cases stand on", () => {
    expect(spellSchoolMask(SPELL_LOCK)).toBe(32);
    expect(spellSchoolMask(DEVOUR_MAGIC)).toBe(32);
    expect(spellSchoolMask(FIREBALL)).toBe(4);
    const { warlock, pet, units } = pair({});
    expect(petCastersOf(warlock, units, SPELL_LOCK)).toEqual([pet]);
    expect(petCastersOf(warlock, units, SHADOWFURY)).toEqual([]);
    // no roster, or the caster not in it → not resolvable
    expect(petCastersOf(warlock, undefined, SPELL_LOCK)).toEqual([]);
    expect(petCastersOf(warlock, [warlock], SPELL_LOCK)).toEqual([]);
  });

  it("owner stunned, pet free → Spell Lock / Devour Magic are not stopped; the owner's own spell and the unasked reading are", () => {
    const { warlock, units } = pair({ ownerStun: [80, 84] });
    for (const id of [SPELL_LOCK, DEVOUR_MAGIC])
      expect(
        cannotCastIntervalsForSpells(warlock, enemyIds, [id], units),
      ).toEqual([]);
    expect(
      spans(
        cannotCastIntervalsForSpells(warlock, enemyIds, [SHADOWFURY], units),
      ),
    ).toEqual([[80, 84]]);
    // the generic list is the owner's, untouched
    for (const unasked of [undefined, []])
      expect(
        cannotCastIntervalsForSpells(warlock, enemyIds, unasked, units),
      ).toEqual(namedCannotCastIntervals(warlock, enemyIds));
    expect(spans(buildCannotCastIntervals(warlock, enemyIds))).toEqual([
      [80, 84],
    ]);
  });

  it("owner free, pet stunned → the pet's spells are stopped, and the pet's interval never enters the owner's list", () => {
    const { warlock, units } = pair({ petStun: [80, 84] });
    const forLock = cannotCastIntervalsForSpells(
      warlock,
      enemyIds,
      [SPELL_LOCK],
      units,
    );
    expect(spans(forLock)).toEqual([[80, 84]]);
    expect(forLock[0]).toMatchObject({
      spellId: HAMMER_OF_JUSTICE,
      lockout: false,
      onPetId: "Pet-1",
    });
    expect(
      spans(
        cannotCastIntervalsForSpells(warlock, enemyIds, [DEVOUR_MAGIC], units),
      ),
    ).toEqual([[80, 84]]);
    // "the owner could not act" readers: nothing
    expect(namedCannotCastIntervals(warlock, enemyIds)).toEqual([]);
    expect(buildCannotCastIntervals(warlock, enemyIds)).toEqual([]);
    expect(
      cannotCastIntervalsForSpells(warlock, enemyIds, undefined, units),
    ).toEqual([]);
    expect(
      cannotCastIntervalsForSpells(warlock, enemyIds, [SHADOWFURY], units),
    ).toEqual([]);
  });

  it("both stunned → stopped for the pet's stun, whatever the owner's", () => {
    const { warlock, units } = pair({
      ownerStun: [78, 90],
      petStun: [80, 84],
    });
    const forLock = cannotCastIntervalsForSpells(
      warlock,
      enemyIds,
      [SPELL_LOCK],
      units,
    );
    expect(spans(forLock)).toEqual([[80, 84]]);
    expect(forLock[0]!.onPetId).toBe("Pet-1");
    // unasked: the owner's own stun, as before
    expect(
      spans(cannotCastIntervalsForSpells(warlock, enemyIds, undefined, units)),
    ).toEqual([[78, 90]]);
  });

  it("observed, not listed: a pet spell never seen from the pet this round keeps the owner's reading", () => {
    const stunned = pair({
      ownerStun: [80, 84],
      petCasts: [petCast(SPELL_LOCK, 20)],
    });
    const forDevour = cannotCastIntervalsForSpells(
      stunned.warlock,
      enemyIds,
      [DEVOUR_MAGIC],
      stunned.units,
    );
    expect(spans(forDevour)).toEqual([[80, 84]]);
    expect(forDevour[0]!.onPetId).toBeUndefined();
    const petOnly = pair({
      petStun: [80, 84],
      petCasts: [petCast(SPELL_LOCK, 20)],
    });
    expect(
      cannotCastIntervalsForSpells(
        petOnly.warlock,
        enemyIds,
        [DEVOUR_MAGIC],
        petOnly.units,
      ),
    ).toEqual([]);
  });

  it("a spell both the unit and a pet cast is the unit's", () => {
    const both = {
      ownerCasts: [
        makeSpellCastEvent(SPELL_LOCK, at(40), "e", "Enemy", "w", "Warlock"),
      ],
    };
    const ownerStunned = pair({ ownerStun: [80, 84], ...both });
    expect(
      spans(
        cannotCastIntervalsForSpells(
          ownerStunned.warlock,
          enemyIds,
          [SPELL_LOCK],
          ownerStunned.units,
        ),
      ),
    ).toEqual([[80, 84]]);
    const petStunned = pair({ petStun: [80, 84], ...both });
    expect(
      cannotCastIntervalsForSpells(
        petStunned.warlock,
        enemyIds,
        [SPELL_LOCK],
        petStunned.units,
      ),
    ).toEqual([]);
  });

  it("without the round's units the spell stays on the owner's reading", () => {
    const { warlock } = pair({ ownerStun: [80, 84] });
    expect(
      spans(
        cannotCastIntervalsForSpells(
          warlock,
          enemyIds,
          [SPELL_LOCK],
          undefined,
        ),
      ),
    ).toEqual([[80, 84]]);
  });

  it("a kick lockout on the PET stops the pet's spell by school, like a player's", () => {
    const kickOnPet = (interrupted: string) => ({
      ...makeInterruptEvent(
        COUNTERSPELL,
        "Counterspell",
        interrupted,
        "x",
        at(80),
        "e",
      ),
      destUnitId: "Pet-1",
    });
    const shadowLocked = pair({ petActionIn: [kickOnPet(SPELL_LOCK)] });
    const lock = cannotCastIntervalsForSpells(
      shadowLocked.warlock,
      enemyIds,
      [DEVOUR_MAGIC],
      shadowLocked.units,
    );
    expect(lock).toHaveLength(1);
    expect(lock[0]).toMatchObject({
      lockout: true,
      lockedSchoolMask: 32,
      onPetId: "Pet-1",
    });
    const fireLocked = pair({ petActionIn: [kickOnPet(FIREBALL)] });
    expect(
      cannotCastIntervalsForSpells(
        fireLocked.warlock,
        enemyIds,
        [DEVOUR_MAGIC],
        fireLocked.units,
      ),
    ).toEqual([]);
  });

  it("quantifier: stopped only while EVERY caster asked about is — two pets that cast the spell, or an own spell next to the pet's", () => {
    // two pets cast Spell Lock this round
    const { warlock, pet } = pair({
      petStun: [80, 86],
      petCasts: [petCast(SPELL_LOCK, 20), petCast(SPELL_LOCK, 50, "Pet-2")],
    });
    const pet2Free = makeUnit("Pet-2", { name: "Felhunter", ownerId: "w" });
    expect(
      cannotCastIntervalsForSpells(
        warlock,
        enemyIds,
        [SPELL_LOCK],
        [warlock, pet, pet2Free],
      ),
    ).toEqual([]);
    const pet2Stunned = makeUnit("Pet-2", {
      name: "Felhunter",
      ownerId: "w",
      auraEvents: stun("Pet-2", 84, 90),
    });
    const bothPets = cannotCastIntervalsForSpells(
      warlock,
      enemyIds,
      [SPELL_LOCK],
      [warlock, pet, pet2Stunned],
    );
    expect(spans(bothPets)).toEqual([
      [84, 86],
      [84, 86],
    ]);
    expect(bothPets.map((iv) => iv.onPetId).sort()).toEqual(["Pet-1", "Pet-2"]);

    // an own spell and a pet's: the time neither can go off, each cause kept
    const mixed = pair({ ownerStun: [80, 84], petStun: [82, 86] });
    const set = cannotCastIntervalsForSpells(
      mixed.warlock,
      enemyIds,
      [SHADOWFURY, SPELL_LOCK],
      mixed.units,
    );
    expect(spans(set)).toEqual([
      [82, 84],
      [82, 84],
    ]);
    expect(set.map((iv) => iv.onPetId)).toEqual(
      expect.arrayContaining([undefined, "Pet-1"]),
    );
    // the pet free → the set is never fully stopped
    const petFree = pair({ ownerStun: [80, 84] });
    expect(
      cannotCastIntervalsForSpells(
        petFree.warlock,
        enemyIds,
        [SHADOWFURY, SPELL_LOCK],
        petFree.units,
      ),
    ).toEqual([]);
  });
});

describe("actWindowFor with the round's units", () => {
  it("couldRespond: the owner's stun stops its own spell and the unasked reading, not the pet's spell", () => {
    const { warlock, units } = pair({ ownerStun: [80, 90] });
    const act = actWindowFor(warlock, enemyIds, T0, Infinity, units);
    expect(act.couldRespond(81, 86)).toBe(false);
    expect(act.couldRespond(81, 86, SHADOWFURY)).toBe(false);
    expect(act.couldRespond(81, 86, SPELL_LOCK)).toBe(true);
    // no units → the owner's reading
    expect(
      actWindowFor(warlock, enemyIds, T0).couldRespond(81, 86, SPELL_LOCK),
    ).toBe(false);
  });

  it("couldRespond: the pet's stun stops the pet's spell only; the death cut stays the owner's", () => {
    const { warlock, units } = pair({ petStun: [80, 90] });
    const act = actWindowFor(warlock, enemyIds, T0, Infinity, units);
    expect(act.couldRespond(81, 86)).toBe(true);
    expect(act.couldRespond(81, 86, SHADOWFURY)).toBe(true);
    expect(act.couldRespond(81, 86, SPELL_LOCK)).toBe(false);
    const dead = pair({ ownerDeathS: 81 });
    expect(
      actWindowFor(
        dead.warlock,
        enemyIds,
        T0,
        Infinity,
        dead.units,
      ).couldRespond(81, 86, SPELL_LOCK),
    ).toBe(false);
  });

  it("stateIn: free time is the asked spells'; `blocks` names the owner's own intervals and never the pet's", () => {
    const ownerStunned = pair({ ownerStun: [80, 84] });
    const a = actWindowFor(
      ownerStunned.warlock,
      enemyIds,
      T0,
      Infinity,
      ownerStunned.units,
    );
    expect(a.stateIn(79, 85, 80)!.freeAfterS).toBeCloseTo(1, 5);
    expect(a.stateIn(79, 85, 80, [SHADOWFURY])!.freeAfterS).toBeCloseTo(1, 5);
    const forPet = a.stateIn(79, 85, 80, [SPELL_LOCK])!;
    expect(forPet.freeAfterS).toBeCloseTo(5, 5);
    expect(forPet.blocks.map((b) => b.spellId)).toEqual([HAMMER_OF_JUSTICE]);

    const petStunned = pair({ petStun: [80, 84] });
    const b = actWindowFor(
      petStunned.warlock,
      enemyIds,
      T0,
      Infinity,
      petStunned.units,
    );
    const st = b.stateIn(79, 85, 80, [SPELL_LOCK])!;
    expect(st.freeAfterS).toBeCloseTo(1, 5);
    expect(st.blocks).toEqual([]);
    // at least one of the asked spells: the owner's own is free throughout
    expect(
      b.stateIn(79, 85, 80, [SPELL_LOCK, SHADOWFURY])!.freeAfterS,
    ).toBeCloseTo(5, 5);
  });
});

describe("readers", () => {
  it("the death block's option tag: what held a pet-cast option through the death is marked as the pet's", () => {
    const { warlock, units } = pair({ petStun: [98, 104] });
    const f = deathWindowFreedom(
      warlock,
      enemyIds,
      T0,
      102,
      5,
      SPELL_LOCK,
      units,
    )!;
    expect(f.longestFreeS).toBeCloseTo(1, 5);
    expect(f.heldAtDeath).toMatchObject({ lockout: false, onPet: true });
    // the unasked tag and an own option: the owner was free
    expect(
      deathWindowFreedom(warlock, enemyIds, T0, 102)!.heldAtDeath,
    ).toBeUndefined();
    expect(
      deathWindowFreedom(warlock, enemyIds, T0, 102, 5, SHADOWFURY, units)!
        .heldAtDeath,
    ).toBeUndefined();
  });

  describe("missed-purge `purgersLockedOut` (Devour Magic is the Felhunter's)", () => {
    // a Critical Magic buff on the enemy 20–28 s, never purged
    const BUFF = "1022"; // Blessing of Protection
    const enemy = () =>
      makeUnit("e", {
        name: "EnemyPriest",
        spec: CombatUnitSpec.Priest_Shadow,
        reaction: CombatUnitReaction.Hostile,
        info: {},
        auraEvents: [
          makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            BUFF,
            at(20),
            "e",
            "e",
            "BUFF",
          ),
          makeAuraEvent(
            LogEvent.SPELL_AURA_REMOVED,
            BUFF,
            at(28),
            "e",
            "e",
            "BUFF",
          ),
        ],
      });
    const windowsFor = (opts: Parameters<typeof pair>[0]) => {
      const { warlock, pet, units } = pair({
        petCasts: [petCast(DEVOUR_MAGIC, 2)],
        ...opts,
      });
      const e = enemy();
      const ds = reconstructDispelSummary(
        [warlock] as any,
        [e] as any,
        {
          startTime: T0,
          endTime: at(120),
          units: Object.fromEntries([...units, e].map((u) => [u.id, u])),
        },
        [pet] as any,
      );
      return ds.missedPurgeWindows;
    };

    it("the buff the case stands on is one a cooldown-gated purger answers", () => {
      expect(purgePriorityForTest(BUFF)).toBe("Critical");
    });

    it("Warlock stunned for the whole buff, Felhunter free → a window, not locked", () => {
      const ws = windowsFor({ ownerStun: [19, 29] });
      expect(ws).toHaveLength(1);
      expect(ws[0]!.purgersLockedOut).toBe(false);
    });

    it("Felhunter stunned for the whole buff → no one could purge: no window", () => {
      expect(windowsFor({ petStun: [19, 29] })).toHaveLength(0);
      expect(
        windowsFor({ ownerStun: [19, 29], petStun: [19, 29] }),
      ).toHaveLength(0);
    });

    it("Felhunter stunned for most of the buff → the window stands, flagged locked", () => {
      const ws = windowsFor({ petStun: [19, 27] });
      expect(ws).toHaveLength(1);
      expect(ws[0]!.purgersLockedOut).toBe(true);
    });

    it("Devour Magic never seen from the pet this round → the owner's reading", () => {
      expect(
        windowsFor({ ownerStun: [19, 29], petCasts: [petCast(SPELL_LOCK, 2)] }),
      ).toHaveLength(0);
    });
  });

  describe("kick-priority `locked` (the castable stretch and the run budget's cannot-cast half)", () => {
    const FLASH_HEAL = "2061";
    const BARKSKIN = "22812";
    // a kill window on the Druid (Barkskin at 50 s, 20 % HP from 69.5 s) and
    // the enemy healer's Flash Heal 70–71.5 s — t12WindowBoundaries' shape
    const target = () =>
      makeUnit("e1", {
        name: "EnemyDruid",
        spec: CombatUnitSpec.Druid_Feral,
        reaction: CombatUnitReaction.Hostile,
        info: {},
        spellCastEvents: [
          makeSpellCastEvent(
            BARKSKIN,
            at(50),
            "e1",
            "EnemyDruid",
            "e1",
            "EnemyDruid",
          ),
        ],
        advancedActions: [makeAdvancedAction(at(69.5), 0, 0, 500_000, 100_000)],
      });
    const healer = () =>
      makeUnit("e", {
        name: "EnemyPriest",
        spec: CombatUnitSpec.Priest_Holy,
        reaction: CombatUnitReaction.Hostile,
        info: {},
        castStartEvents: [
          {
            ...makeSpellCastEvent(
              FLASH_HEAL,
              at(70),
              "",
              "",
              "e",
              "EnemyPriest",
            ),
            logLine: {
              event: LogEvent.SPELL_CAST_START,
              timestamp: at(70),
              parameters: [],
            },
          },
        ],
        spellCastEvents: [
          makeSpellCastEvent(FLASH_HEAL, at(71.5), "", "", "e", "EnemyPriest"),
        ],
        healOut: [
          {
            logLine: {
              event: LogEvent.SPELL_HEAL,
              timestamp: at(71.5),
              parameters: [],
            },
            timestamp: at(71.5),
            spellId: FLASH_HEAL,
            effectiveAmount: 100_000,
            destUnitId: "e1",
          },
        ],
      });
    const lockedFor = (opts: Parameters<typeof pair>[0]) => {
      const { warlock, units } = pair(opts);
      const enemies = [target(), healer()];
      const pts = kickPriorityDecisionPoints(
        [warlock],
        enemies,
        {
          startTime: T0,
          endTime: at(107),
          units: Object.fromEntries(
            [...units, ...enemies].map((u) => [u.id, u]),
          ),
        },
        { eligibility: "bootstrap" },
      );
      expect(pts).toHaveLength(1);
      const f = pts[0]!.friends.find((x) => x.id === "w");
      return f && { kick: f.kickSpellId, locked: f.locked };
    };

    it("the Warlock's interrupt is the Felhunter's Spell Lock (observed)", () => {
      expect(lockedFor({})).toEqual({ kick: SPELL_LOCK, locked: false });
    });

    it("Warlock stunned through the heal, Felhunter free → not locked", () => {
      expect(lockedFor({ ownerStun: [69, 73] })).toEqual({
        kick: SPELL_LOCK,
        locked: false,
      });
    });

    it("Felhunter stunned through the heal → locked, with or without the Warlock's stun", () => {
      expect(lockedFor({ petStun: [69, 73] })?.locked).toBe(true);
      expect(
        lockedFor({ ownerStun: [69, 73], petStun: [69, 73] })?.locked,
      ).toBe(true);
    });
  });
});
