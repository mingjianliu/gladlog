import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  buildCannotCastIntervals,
  castBlockingAuraIntervals,
  coveredMsWithin,
  enemySourceIds,
  silenceIntervals,
} from "../src/utils/cannotCastIntervals";

describe("cannotCastIntervals — buildCannotCastIntervals", () => {
  const enemyIds = new Set(["Enemy-1"]);

  it("returns empty intervals when unit has no auraEvents or actionIn", () => {
    const unit = {
      id: "Player-1",
      auraEvents: [],
      actionIn: [],
    } as unknown as ICombatUnit;
    expect(buildCannotCastIntervals(unit, enemyIds)).toEqual([]);
  });

  it("handles undefined auraEvents and actionIn gracefully", () => {
    const unit = { id: "Player-1" } as unknown as ICombatUnit;
    expect(buildCannotCastIntervals(unit, enemyIds)).toEqual([]);
  });

  it("ignores auras from friendly or non-enemy units", () => {
    const unit = {
      id: "Player-1",
      auraEvents: [
        {
          spellId: "118", // Polymorph (cc)
          srcUnitId: "Friend-1",
          timestamp: 10_000,
          logLine: { event: LogEvent.SPELL_AURA_APPLIED },
        },
      ],
      actionIn: [],
    } as unknown as ICombatUnit;
    expect(buildCannotCastIntervals(unit, enemyIds)).toEqual([]);
  });

  it("ignores non-cast-blocking auras (e.g. roots)", () => {
    const unit = {
      id: "Player-1",
      auraEvents: [
        {
          spellId: "339", // Entangling Roots (roots)
          srcUnitId: "Enemy-1",
          timestamp: 10_000,
          logLine: { event: LogEvent.SPELL_AURA_APPLIED },
        },
      ],
      actionIn: [],
    } as unknown as ICombatUnit;
    expect(buildCannotCastIntervals(unit, enemyIds)).toEqual([]);
  });

  it("pairs SPELL_AURA_APPLIED and SPELL_AURA_REMOVED for CC auras", () => {
    const unit = {
      id: "Player-1",
      auraEvents: [
        {
          spellId: "118", // Polymorph (cc)
          srcUnitId: "Enemy-1",
          timestamp: 10_000,
          logLine: { event: LogEvent.SPELL_AURA_APPLIED },
        },
        {
          spellId: "118",
          srcUnitId: "Enemy-1",
          timestamp: 16_000,
          logLine: { event: LogEvent.SPELL_AURA_REMOVED },
        },
      ],
      actionIn: [],
    } as unknown as ICombatUnit;

    const intervals = buildCannotCastIntervals(unit, enemyIds);
    expect(intervals).toEqual([{ from: 10_000, to: 16_000 }]);
  });

  it("treats unremoved CC auras as open-ended (to: Infinity)", () => {
    const unit = {
      id: "Player-1",
      auraEvents: [
        {
          spellId: "118", // Polymorph
          srcUnitId: "Enemy-1",
          timestamp: 10_000,
          logLine: { event: LogEvent.SPELL_AURA_APPLIED },
        },
      ],
      actionIn: [],
    } as unknown as ICombatUnit;

    const intervals = buildCannotCastIntervals(unit, enemyIds);
    expect(intervals).toEqual([{ from: 10_000, to: Infinity }]);
  });

  it("adds kick lockout intervals from enemy SPELL_INTERRUPT events", () => {
    const unit = {
      id: "Player-1",
      auraEvents: [],
      actionIn: [
        {
          spellId: "1766", // Kick (3s lockout)
          srcUnitId: "Enemy-1",
          timestamp: 20_000,
          logLine: { event: LogEvent.SPELL_INTERRUPT },
        },
        {
          spellId: "2139", // Counterspell (6s lockout per ruled override)
          srcUnitId: "Enemy-1",
          timestamp: 30_000,
          logLine: { event: LogEvent.SPELL_INTERRUPT },
        },
      ],
    } as unknown as ICombatUnit;

    const intervals = buildCannotCastIntervals(unit, enemyIds);
    expect(intervals).toEqual([
      { from: 20_000, to: 23_000 },
      { from: 30_000, to: 36_000 },
    ]);
  });
});

describe("cannotCastIntervals — coveredMsWithin", () => {
  it("returns 0 for empty intervals", () => {
    expect(coveredMsWithin([], 10_000, 20_000)).toBe(0);
  });

  it("clips interval to window boundaries", () => {
    // Window: [10_000, 20_000]
    // Interval: [5_000, 15_000] -> clipped to [10_000, 15_000] = 5_000 ms
    expect(coveredMsWithin([{ from: 5_000, to: 15_000 }], 10_000, 20_000)).toBe(
      5_000,
    );

    // Interval: [18_000, 25_000] -> clipped to [18_000, 20_000] = 2_000 ms
    expect(
      coveredMsWithin([{ from: 18_000, to: 25_000 }], 10_000, 20_000),
    ).toBe(2_000);

    // Interval completely outside window -> 0 ms
    expect(coveredMsWithin([{ from: 1_000, to: 5_000 }], 10_000, 20_000)).toBe(
      0,
    );
  });

  it("correctly merges overlapping intervals without double-counting", () => {
    // Two overlapping intervals: [10_000, 14_000] and [12_000, 18_000] -> merged [10_000, 18_000] = 8_000 ms
    const intervals = [
      { from: 10_000, to: 14_000 },
      { from: 12_000, to: 18_000 },
    ];
    expect(coveredMsWithin(intervals, 5_000, 25_000)).toBe(8_000);
  });

  it("correctly merges adjacent intervals touching at boundary", () => {
    // Two adjacent intervals: [0, 5_000] and [5_000, 10_000] touch at 5_000 ms.
    // In coveredMsWithin, `w.from <= cur.to` merges them into [0, 10_000] = 10_000 ms.
    const intervals = [
      { from: 0, to: 5_000 },
      { from: 5_000, to: 10_000 },
    ];
    expect(coveredMsWithin(intervals, 0, 10_000)).toBe(10_000);
    expect(coveredMsWithin(intervals, 0, 15_000)).toBe(10_000);
  });

  it("correctly sums disjoint intervals within the window", () => {
    const intervals = [
      { from: 10_000, to: 12_000 }, // 2_000 ms
      { from: 15_000, to: 19_000 }, // 4_000 ms
    ];
    expect(coveredMsWithin(intervals, 0, 30_000)).toBe(6_000);
  });

  it("handles infinite open-ended intervals clipped to window end", () => {
    // Interval: [15_000, Infinity], window [10_000, 20_000] -> clipped [15_000, 20_000] = 5_000 ms
    expect(
      coveredMsWithin([{ from: 15_000, to: Infinity }], 10_000, 20_000),
    ).toBe(5_000);
  });
});

describe("cannotCastIntervals — silenceIntervals (reliability round 2 W1b)", () => {
  const enemyIds = new Set(["Enemy-1"]);
  const aura = (
    spellId: string,
    spellName: string,
    ts: number,
    event: LogEvent,
  ) => ({
    spellId,
    spellName,
    srcUnitId: "Enemy-1",
    srcUnitName: "Rogue-Realm",
    timestamp: ts,
    logLine: { event },
  });

  it("returns the silence (Garrote - Silence) and not the hard CC (Polymorph), with its source and span", () => {
    const unit = {
      id: "Player-1",
      auraEvents: [
        aura("1330", "Garrote - Silence", 10_000, LogEvent.SPELL_AURA_APPLIED),
        aura("1330", "Garrote - Silence", 13_000, LogEvent.SPELL_AURA_REMOVED),
        aura("118", "Polymorph", 20_000, LogEvent.SPELL_AURA_APPLIED),
        aura("118", "Polymorph", 26_000, LogEvent.SPELL_AURA_REMOVED),
      ],
      actionIn: [],
    } as unknown as ICombatUnit;
    const s = silenceIntervals(unit, enemyIds);
    expect(s).toHaveLength(1);
    expect(s[0]).toEqual(
      expect.objectContaining({
        spellId: "1330",
        srcUnitName: "Rogue-Realm",
        from: 10_000,
        to: 13_000,
      }),
    );
  });

  it("a kick's lockout aura (Shambling Rush 91807, mechanic interrupt) locks casting but is not a silence", () => {
    const unit = {
      id: "Player-1",
      auraEvents: [
        aura("91807", "Shambling Rush", 5_000, LogEvent.SPELL_AURA_APPLIED),
        aura("91807", "Shambling Rush", 7_000, LogEvent.SPELL_AURA_REMOVED),
      ],
      actionIn: [],
    } as unknown as ICombatUnit;
    expect(buildCannotCastIntervals(unit, enemyIds)).toEqual([
      { from: 5_000, to: 7_000 },
    ]);
    expect(silenceIntervals(unit, enemyIds)).toEqual([]);
  });

  it("every silence interval is also a cannot-cast interval (one predicate)", () => {
    const unit = {
      id: "Player-1",
      auraEvents: [
        aura("47476", "Strangulate", 5_000, LogEvent.SPELL_AURA_APPLIED),
        aura("47476", "Strangulate", 7_000, LogEvent.SPELL_AURA_REMOVED),
      ],
      actionIn: [],
    } as unknown as ICombatUnit;
    const blocked = buildCannotCastIntervals(unit, enemyIds);
    const silences = silenceIntervals(unit, enemyIds);
    expect(silences).toHaveLength(1);
    for (const s of silences)
      expect(blocked).toContainEqual({ from: s.from, to: s.to });
  });
});

// triage 2026-09-29 H23 (e5b3534b round 0): Cyclone re-applied in the same
// millisecond as the previous Cyclone's REMOVED, then a Hunter pet's
// Intimidation — the owner read as free for the whole window.
describe("cannotCastIntervals — log-order pairing and pet sources (H23)", () => {
  const ev = (spellId: string, src: string, ts: number, event: LogEvent) => ({
    spellId,
    spellName: spellId,
    srcUnitId: src,
    srcUnitName: src,
    timestamp: ts,
    logLine: { event },
  });

  it("a same-millisecond re-application pairs with the NEXT removal, not the one logged before it", () => {
    const unit = {
      id: "Player-1",
      auraEvents: [
        ev("33786", "Enemy-1", 23_103, LogEvent.SPELL_AURA_APPLIED),
        ev("33786", "Enemy-1", 23_317, LogEvent.SPELL_AURA_REMOVED),
        ev("33786", "Enemy-1", 23_317, LogEvent.SPELL_AURA_APPLIED),
        ev("33786", "Enemy-1", 28_109, LogEvent.SPELL_AURA_REMOVED),
      ],
      actionIn: [],
    } as unknown as ICombatUnit;
    expect(buildCannotCastIntervals(unit, new Set(["Enemy-1"]))).toEqual([
      { from: 23_103, to: 23_317 },
      { from: 23_317, to: 28_109 },
    ]);
  });

  it("a removal closes ITS caster's application: a second caster's same-id stun runs to its own removal (ruling P-FU-H23)", () => {
    // 110-5-617's shape: Hammer of Justice from one paladin at 90.0 (5 s),
    // from the other at 95.1 — landing before the first one's REMOVED at
    // 95.5 — and removed at 98.1. Paired by spell alone, the second stun
    // ended at 95.5 and the unit read as free for 2.6 s of it.
    const unit = {
      id: "Player-1",
      auraEvents: [
        ev("853", "Enemy-1", 90_000, LogEvent.SPELL_AURA_APPLIED),
        ev("853", "Enemy-2", 95_100, LogEvent.SPELL_AURA_APPLIED),
        ev("853", "Enemy-1", 95_500, LogEvent.SPELL_AURA_REMOVED),
        ev("853", "Enemy-2", 98_100, LogEvent.SPELL_AURA_REMOVED),
      ],
      actionIn: [],
    } as unknown as ICombatUnit;
    const both = new Set(["Enemy-1", "Enemy-2"]);
    expect(buildCannotCastIntervals(unit, both)).toEqual([
      { from: 90_000, to: 95_500 },
      { from: 95_100, to: 98_100 },
    ]);
    expect(
      coveredMsWithin(buildCannotCastIntervals(unit, both), 90_000, 99_000),
    ).toBe(8_100);
    // each interval names its own caster
    expect(
      castBlockingAuraIntervals(unit, both).map((a) => [
        a.srcUnitId,
        a.from,
        a.to,
      ]),
    ).toEqual([
      ["Enemy-1", 90_000, 95_500],
      ["Enemy-2", 95_100, 98_100],
    ]);
  });

  it("a BROKEN line's source is the breaker: it closes the earliest pending application of the spell", () => {
    // Fear from the enemy warlock, broken by the enemy mage's damage — the
    // BROKEN_SPELL line carries the mage, and still ends the warlock's Fear.
    // No REMOVED line here on purpose: the break alone has to close it (with
    // the caster's REMOVED in the fixture the exact-key match would close the
    // interval at the same time and the fallback would go untested).
    const both = new Set(["Enemy-1", "Enemy-2"]);
    for (const breakEvent of [
      LogEvent.SPELL_AURA_BROKEN_SPELL,
      LogEvent.SPELL_AURA_BROKEN,
    ]) {
      const unit = {
        id: "Player-1",
        auraEvents: [
          ev("5782", "Enemy-1", 10_000, LogEvent.SPELL_AURA_APPLIED),
          ev("5782", "Enemy-2", 12_400, breakEvent),
        ],
        actionIn: [],
      } as unknown as ICombatUnit;
      expect(castBlockingAuraIntervals(unit, both)).toEqual([
        expect.objectContaining({
          srcUnitId: "Enemy-1",
          from: 10_000,
          to: 12_400,
        }),
      ]);
    }
  });

  it("the log's shape — BROKEN, then the caster's REMOVED: one interval ending at the REMOVED, which closes nothing else", () => {
    // the REMOVED arrives 300 ms after the break here so the two cannot be
    // told apart by luck; a later Fear from the same caster is its own
    // interval, not swallowed by the leftover REMOVED. FT-T08 (2026-10-09):
    // the aura is on the unit until its REMOVED — the interval ends there,
    // not at the BROKEN line (was 12_400).
    const unit = {
      id: "Player-1",
      auraEvents: [
        ev("5782", "Enemy-1", 10_000, LogEvent.SPELL_AURA_APPLIED),
        ev("5782", "Enemy-2", 12_400, LogEvent.SPELL_AURA_BROKEN_SPELL),
        ev("5782", "Enemy-1", 12_700, LogEvent.SPELL_AURA_REMOVED),
        ev("5782", "Enemy-1", 20_000, LogEvent.SPELL_AURA_APPLIED),
        ev("5782", "Enemy-1", 23_000, LogEvent.SPELL_AURA_REMOVED),
      ],
      actionIn: [],
    } as unknown as ICombatUnit;
    expect(
      buildCannotCastIntervals(unit, new Set(["Enemy-1", "Enemy-2"])),
    ).toEqual([
      { from: 10_000, to: 12_700 },
      { from: 20_000, to: 23_000 },
    ]);
  });

  it("one caster re-applying with no removal between keeps one interval from the first application", () => {
    const unit = {
      id: "Player-1",
      auraEvents: [
        ev("853", "Enemy-1", 10_000, LogEvent.SPELL_AURA_APPLIED),
        ev("853", "Enemy-1", 11_000, LogEvent.SPELL_AURA_APPLIED),
        ev("853", "Enemy-1", 14_000, LogEvent.SPELL_AURA_REMOVED),
      ],
      actionIn: [],
    } as unknown as ICombatUnit;
    expect(buildCannotCastIntervals(unit, new Set(["Enemy-1"]))).toEqual([
      { from: 10_000, to: 14_000 },
    ]);
  });

  it("a pet's stun counts once the pet is in the source set (enemySourceIds)", () => {
    const unit = {
      id: "Player-1",
      auraEvents: [
        ev("24394", "Pet-1", 28_231, LogEvent.SPELL_AURA_APPLIED),
        ev("24394", "Pet-1", 29_596, LogEvent.SPELL_AURA_REMOVED),
      ],
      actionIn: [],
    } as unknown as ICombatUnit;
    const players = [{ id: "Enemy-1" }];
    const units = [
      { id: "Enemy-1" },
      { id: "Pet-1", ownerId: "Enemy-1" },
      { id: "Pet-2", ownerId: "Friend-1" },
    ];
    expect(buildCannotCastIntervals(unit, new Set(["Enemy-1"]))).toEqual([]);
    const src = enemySourceIds(players, units);
    expect([...src].sort()).toEqual(["Enemy-1", "Pet-1"]);
    expect(buildCannotCastIntervals(unit, src)).toEqual([
      { from: 28_231, to: 29_596 },
    ]);
  });
});
