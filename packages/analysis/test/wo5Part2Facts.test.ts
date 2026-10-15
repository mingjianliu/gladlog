/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Work order 2026-10-15 Part 2 (user 2026-10-15: 「好」):
 *  - 2a: DR history and missed-cleanse's uncleansed windows read a CC
 *    re-APPLIED inside its official length as one application, and close a
 *    lost REMOVED at the official length;
 *  - 2b: the disarm pairing is the CC pairings' reading, and the owner's
 *    act window (`actWindowFor`) reads disarms for a named weapon spell;
 *  - 2d: kick-eaten's lock end reads every cast inside a lock longer than
 *    5 s.
 * 2c (KILL ATTEMPTS "popped" side test) and 2e (POSITIONING) are verified
 * on the 605 capture (eval-private fix-FT/wo5/PART2-PREVIEW.md).
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  actWindowFor,
  disarmIntervals,
} from "../src/utils/cannotCastIntervals";
import { analyzePlayerCCAndTrinket } from "../src/utils/ccTrinketAnalysis";
import { reconstructDispelSummary } from "../src/utils/dispelAnalysis";
import { buildCcCategoryHistory, getDRCategory } from "../src/utils/drAnalysis";
import {
  makeAuraEvent,
  makeInterruptEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const S = (sec: number) => T0 + sec * 1000;
const ev = (
  event: LogEvent,
  spellId: string,
  sec: number,
  src: string,
  dest: string,
) => ({
  ...makeAuraEvent(event, spellId, S(sec), src, dest),
  spellName: spellId,
  srcUnitName: src,
});

describe("2a — DR history: one application per re-send, a lost REMOVED capped", () => {
  const POLY = "118"; // 6 s
  const cat = () => getDRCategory(POLY);
  const of = (events: object[]) =>
    buildCcCategoryHistory(
      { id: "v", auraEvents: events } as unknown as ICombatUnit,
      cat(),
      new Set(["mage"]),
      T0,
    ).map((i) => [i.atSeconds, i.durationSeconds]);

  it("a re-APPLIED 2 s in is the same application (it used to be a second DR step)", () => {
    expect(
      of([
        ev(LogEvent.SPELL_AURA_APPLIED, POLY, 10, "mage", "v"),
        ev(LogEvent.SPELL_AURA_APPLIED, POLY, 12, "mage", "v"),
        ev(LogEvent.SPELL_AURA_REMOVED, POLY, 15, "mage", "v"),
      ]),
    ).toEqual([[10, 5]]);
  });

  it("a lost REMOVED closes at the official length, and a never-removed one is kept", () => {
    expect(
      of([
        ev(LogEvent.SPELL_AURA_APPLIED, POLY, 10, "mage", "v"),
        ev(LogEvent.SPELL_AURA_APPLIED, POLY, 60, "mage", "v"),
        ev(LogEvent.SPELL_AURA_REMOVED, POLY, 63, "mage", "v"),
        ev(LogEvent.SPELL_AURA_APPLIED, POLY, 100, "mage", "v"),
      ]),
    ).toEqual([
      [10, 6],
      [60, 3],
      [100, 6],
    ]);
  });

  it("agy 40-FT-94 #4: a re-APPLIED its source recast is a new DR step", () => {
    const mage = {
      id: "mage",
      spellCastEvents: [
        makeSpellCastEvent(POLY, S(12), "v", "v", "mage", "mage"),
      ],
    };
    const events = [
      ev(LogEvent.SPELL_AURA_APPLIED, POLY, 10, "mage", "v"),
      ev(LogEvent.SPELL_AURA_APPLIED, POLY, 12, "mage", "v"),
      ev(LogEvent.SPELL_AURA_REMOVED, POLY, 15, "mage", "v"),
    ];
    expect(
      buildCcCategoryHistory(
        { id: "v", auraEvents: events } as unknown as ICombatUnit,
        cat(),
        new Set(["mage"]),
        T0,
        new Map([["mage", mage as unknown as ICombatUnit]]),
      ).map((i) => [i.atSeconds, i.durationSeconds]),
    ).toEqual([
      [10, 2],
      [12, 3],
    ]);
  });
});

describe("2a — the uncleansed window: a re-send inside the length is one window", () => {
  const windows = (auraEvents: object[]) =>
    reconstructDispelSummary(
      [
        makeUnit("h", { name: "Healer", spec: CombatUnitSpec.Paladin_Holy }),
        makeUnit("m", {
          name: "Melee",
          spec: CombatUnitSpec.Warrior_Arms,
          auraEvents,
        }),
      ] as never,
      [makeUnit("enemy-1", { reaction: CombatUnitReaction.Hostile })] as never,
      { startTime: T0, endTime: S(300) } as never,
    ).missedCleanseWindows.map((w) => [
      w.timeSeconds,
      Math.round(w.durationSeconds * 10) / 10,
    ]);

  const windows2 = (auraEvents: object[]) =>
    reconstructDispelSummary(
      [
        makeUnit("h", { name: "Healer", spec: CombatUnitSpec.Paladin_Holy }),
        makeUnit("m", {
          name: "Melee",
          spec: CombatUnitSpec.Warrior_Arms,
          auraEvents,
        }),
      ] as never,
      [
        makeUnit("enemy-1", { reaction: CombatUnitReaction.Hostile }),
        makeUnit("enemy-2", { reaction: CombatUnitReaction.Hostile }),
        makeUnit("enemy-3", { reaction: CombatUnitReaction.Hostile }),
      ] as never,
      { startTime: T0, endTime: S(300) } as never,
      [],
      [
        makeUnit("enemy-pet", {
          reaction: CombatUnitReaction.Hostile,
          ownerId: "enemy-1",
        }),
      ] as never,
    )
      .missedCleanseWindows.map((w) => [
        w.timeSeconds,
        Math.round(w.durationSeconds * 10) / 10,
      ])
      .sort((a, b) => a[0]! - b[0]!);

  it("APPLIED, APPLIED 2 s later, REMOVED: one window from the first", () => {
    expect(
      windows([
        ev(LogEvent.SPELL_AURA_APPLIED, "118", 20, "enemy-1", "m"),
        ev(LogEvent.SPELL_AURA_APPLIED, "118", 22, "enemy-1", "m"),
        ev(LogEvent.SPELL_AURA_REMOVED, "118", 26, "enemy-1", "m"),
      ]),
    ).toEqual([[20, 6]]);
  });

  // Frost Nova (6 s; a root — no DR verdict skips the second)
  it("agy 40-FT-94 #2 / #3: two sources' same CC are two windows, each to its own removal", () => {
    expect(
      windows2([
        ev(LogEvent.SPELL_AURA_APPLIED, "122", 20, "enemy-1", "m"),
        ev(LogEvent.SPELL_AURA_APPLIED, "122", 22, "enemy-2", "m"),
        ev(LogEvent.SPELL_AURA_REMOVED, "122", 26, "enemy-1", "m"),
        ev(LogEvent.SPELL_AURA_REMOVED, "122", 28, "enemy-2", "m"),
      ]),
    ).toEqual([
      [20, 6],
      [22, 6],
    ]);
  });

  // agy 40-FT-95: a removal closes its source's open application, else the
  // earliest open one of the spell, and is consumed (`matchPendingCcKey`)
  it("agy 40-FT-95 #1: a BROKEN by a unit that casts the spell later still closes the open one", () => {
    expect(
      windows2([
        ev(LogEvent.SPELL_AURA_APPLIED, "122", 20, "enemy-1", "m"),
        ev(LogEvent.SPELL_AURA_BROKEN, "122", 24, "enemy-2", "m"),
        ev(LogEvent.SPELL_AURA_APPLIED, "122", 40, "enemy-2", "m"),
        ev(LogEvent.SPELL_AURA_REMOVED, "122", 46, "enemy-2", "m"),
      ]),
    ).toEqual([
      [20, 4],
      [40, 6],
    ]);
  });

  // raw.txt: a BROKEN_SPELL row names the breaker (Dragon's Breath broken by
  // a warrior's Champion's Spear logs the warrior)
  it("agy 40-FT-96: a CC an enemy PET broke is broken by damage, not uncleansed", () => {
    expect(
      windows2([
        ev(LogEvent.SPELL_AURA_APPLIED, "122", 20, "enemy-1", "m"),
        ev(LogEvent.SPELL_AURA_BROKEN_SPELL, "122", 24, "enemy-pet", "m"),
        ev(LogEvent.SPELL_AURA_REMOVED, "122", 24, "enemy-1", "m"),
        ev(LogEvent.SPELL_AURA_APPLIED, "122", 40, "enemy-1", "m"),
        ev(LogEvent.SPELL_AURA_BROKEN_SPELL, "122", 44, "enemy-pet", "m"),
      ]),
    ).toEqual([]);
  });

  it("agy 40-FT-95 #2: a breaker's removal closes one application, not two", () => {
    expect(
      windows2([
        ev(LogEvent.SPELL_AURA_APPLIED, "122", 20, "enemy-1", "m"),
        ev(LogEvent.SPELL_AURA_APPLIED, "122", 22, "enemy-2", "m"),
        ev(LogEvent.SPELL_AURA_BROKEN, "122", 24, "enemy-3", "m"),
        ev(LogEvent.SPELL_AURA_REMOVED, "122", 28, "enemy-2", "m"),
      ]),
    ).toEqual([
      [20, 4],
      [22, 6],
    ]);
  });
});

describe("2b — the disarm pairing and the act window", () => {
  const DISMANTLE = "207777"; // 5 s
  const victim = (events: object[]) =>
    ({
      id: "w",
      name: "Warrior",
      auraEvents: events,
      actionIn: [],
      deathRecords: [],
    }) as unknown as ICombatUnit;
  const enemies = new Set(["rogue"]);

  it("a BROKEN logged by another unit closes the disarm; a re-send inside 5 s is one interval", () => {
    expect(
      disarmIntervals(
        victim([
          ev(LogEvent.SPELL_AURA_APPLIED, DISMANTLE, 10, "rogue", "w"),
          ev(LogEvent.SPELL_AURA_APPLIED, DISMANTLE, 11, "rogue", "w"),
          ev(LogEvent.SPELL_AURA_BROKEN, DISMANTLE, 12.5, "mage", "w"),
        ]),
        enemies,
      ).map((i) => [i.from, i.to]),
    ).toEqual([[S(10), S(12.5)]]);
  });

  it("a lost REMOVED closes at 5 s", () => {
    expect(
      disarmIntervals(
        victim([ev(LogEvent.SPELL_AURA_APPLIED, DISMANTLE, 10, "rogue", "w")]),
        enemies,
      ).map((i) => [i.from, i.to]),
    ).toEqual([[S(10), S(15)]]);
  });

  it("actWindowFor: a disarmed holder of Die by the Sword (needs a weapon) cannot press it; an unasked reader is not stopped", () => {
    const w = actWindowFor(
      victim([
        ev(LogEvent.SPELL_AURA_APPLIED, DISMANTLE, 10, "rogue", "w"),
        ev(LogEvent.SPELL_AURA_REMOVED, DISMANTLE, 15, "rogue", "w"),
      ]),
      enemies,
      T0,
    );
    expect(w.couldRespond(10, 15, "118038")).toBe(false);
    expect(w.couldRespond(10, 15, undefined)).toBe(true);
  });
});

describe("2d — kick-eaten's lock end reads the whole lock", () => {
  it("a Holy SUCCESS 5.5 s into a 6 s Holy lock ends it (it was past the 5 s window)", () => {
    const player = makeUnit("player-1", {
      name: "Owner",
      spec: CombatUnitSpec.Paladin_Holy,
      reaction: CombatUnitReaction.Friendly,
      actionIn: [
        makeInterruptEvent(
          "2139",
          "Counterspell",
          "19750",
          "Flash of Light",
          S(10),
          "enemy-1",
        ),
      ],
      spellCastEvents: [
        // Physical — outside the Holy lock, so the window is not idle
        makeSpellCastEvent(
          "35395",
          S(11),
          "player-1",
          "Owner",
          "player-1",
          "Owner",
          0,
          "Crusader Strike",
        ),
        // Holy Shock, silenceable, inside the lock past 5 s
        makeSpellCastEvent(
          "20473",
          S(15.5),
          "player-1",
          "Owner",
          "player-1",
          "Owner",
          0,
          "Holy Shock",
        ),
      ],
    });
    const [k] = analyzePlayerCCAndTrinket(
      player,
      [makeUnit("enemy-1", { reaction: CombatUnitReaction.Hostile })],
      { startTime: T0, endTime: S(300), startInfo: { zoneId: "1672" } } as any,
    ).interruptInstances;
    expect(k!.lockoutDurationSeconds).toBeGreaterThan(5.5);
    expect(k!.lockEndedBySuccessS).toBeCloseTo(5.5, 5);
  });

  it("agy 40-FT-94 #1: an idle 5 s window still reads the lock end past it", () => {
    const player = makeUnit("player-1", {
      name: "Owner",
      spec: CombatUnitSpec.Paladin_Holy,
      reaction: CombatUnitReaction.Friendly,
      actionIn: [
        makeInterruptEvent(
          "2139",
          "Counterspell",
          "19750",
          "Flash of Light",
          S(10),
          "enemy-1",
        ),
      ],
      spellCastEvents: [
        makeSpellCastEvent(
          "20473",
          S(15.5),
          "player-1",
          "Owner",
          "player-1",
          "Owner",
          0,
          "Holy Shock",
        ),
      ],
    });
    const [k] = analyzePlayerCCAndTrinket(
      player,
      [makeUnit("enemy-1", { reaction: CombatUnitReaction.Hostile })],
      { startTime: T0, endTime: S(300), startInfo: { zoneId: "1672" } } as any,
    ).interruptInstances;
    expect(k!.postKick).toBe("idle");
    expect(k!.lockEndedBySuccessS).toBeCloseTo(5.5, 5);
    expect(k!.wentOutInLockS).toEqual({ "20473": 5.5 });
  });
});
