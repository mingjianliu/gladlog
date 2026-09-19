import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  buildCannotCastIntervals,
  coveredMsWithin,
} from "../src/utils/cannotCastIntervals";

describe("cannotCastIntervals — buildCannotCastIntervals", () => {
  const enemyIds = new Set(["Enemy-1"]);

  it("returns empty intervals when unit has no auraEvents or actionIn", () => {
    const unit = { id: "Player-1", auraEvents: [], actionIn: [] } as unknown as ICombatUnit;
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
    expect(coveredMsWithin([{ from: 5_000, to: 15_000 }], 10_000, 20_000)).toBe(5_000);

    // Interval: [18_000, 25_000] -> clipped to [18_000, 20_000] = 2_000 ms
    expect(coveredMsWithin([{ from: 18_000, to: 25_000 }], 10_000, 20_000)).toBe(2_000);

    // Interval completely outside window -> 0 ms
    expect(coveredMsWithin([{ from: 1_000, to: 5_000 }], 10_000, 20_000)).toBe(0);
  });

  it("correctly merges overlapping intervals without double-counting", () => {
    // Two overlapping intervals: [10_000, 14_000] and [12_000, 18_000] -> merged [10_000, 18_000] = 8_000 ms
    const intervals = [
      { from: 10_000, to: 14_000 },
      { from: 12_000, to: 18_000 },
    ];
    expect(coveredMsWithin(intervals, 5_000, 25_000)).toBe(8_000);
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
    expect(coveredMsWithin([{ from: 15_000, to: Infinity }], 10_000, 20_000)).toBe(5_000);
  });
});
