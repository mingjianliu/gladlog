import { CombatUnitSpec, ICombatUnit, LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  buildCannotCastIntervals,
  castBlockingAuraIntervals,
  coveredMsWithin,
  deathLockChain,
  enemySourceIds,
  healerLockIntervals,
  silenceIntervals,
} from "../src/utils/cannotCastIntervals";
import { unitCooldownOf } from "../src/utils/cooldowns";

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

  it("closes an unremoved CC aura at its official length (work order 2026-10-14d #13; it used to run open-ended)", () => {
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
    // Polymorph's official 6 s (`ccFullDurationSeconds`)
    expect(intervals).toEqual([{ from: 10_000, to: 16_000 }]);
  });

  it("a second APPLIED with no REMOVED between: the same application inside the official length, a new one past it (work order 2026-10-14d #13)", () => {
    const ev = (event: LogEvent, ms: number) => ({
      spellId: "118",
      srcUnitId: "Enemy-1",
      timestamp: ms,
      logLine: { event },
    });
    const of = (auraEvents: object[]) =>
      buildCannotCastIntervals(
        { id: "Player-1", auraEvents, actionIn: [] } as unknown as ICombatUnit,
        enemyIds,
      );
    // a re-send 2 s in: one interval to the REMOVED
    expect(
      of([
        ev(LogEvent.SPELL_AURA_APPLIED, 10_000),
        ev(LogEvent.SPELL_AURA_APPLIED, 12_000),
        ev(LogEvent.SPELL_AURA_REMOVED, 15_000),
      ]),
    ).toEqual([{ from: 10_000, to: 15_000 }]);
    // a lost REMOVED, the next application 50 s later: the first closes at
    // its official end, never at the later REMOVED
    expect(
      of([
        ev(LogEvent.SPELL_AURA_APPLIED, 10_000),
        ev(LogEvent.SPELL_AURA_APPLIED, 60_000),
        ev(LogEvent.SPELL_AURA_REMOVED, 63_000),
      ]),
    ).toEqual([
      { from: 10_000, to: 16_000 },
      { from: 60_000, to: 63_000 },
    ]);
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

  // fact9 D10 (2026-11-02): 91807 is DB2's root (aura 26, ROOT_AURA_SPELL_IDS)
  // and 1d6eee5f 0:54.760 cast Frost Nova under it — the kick's school
  // lockout is the SPELL_INTERRUPT's, not this aura's
  it("Shambling Rush's aura 91807 is a root: no cannot-cast interval and no silence", () => {
    const unit = {
      id: "Player-1",
      auraEvents: [
        aura("91807", "Shambling Rush", 5_000, LogEvent.SPELL_AURA_APPLIED),
        aura("91807", "Shambling Rush", 7_000, LogEvent.SPELL_AURA_REMOVED),
      ],
      actionIn: [],
    } as unknown as ICombatUnit;
    expect(buildCannotCastIntervals(unit, enemyIds)).toEqual([]);
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

  it("a same-millisecond REMOVED → APPLIED is one Cyclone re-broadcast: one interval from the landing (H23; work order 2026-10-14b fix 8)", () => {
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
      { from: 23_103, to: 28_109 },
    ]);
  });

  it("the unit's own Deep Breath flight is a cannot-cast interval (user ruling 2026-10-14)", () => {
    // b12bfef4's shape: Deep Breath 108.771 → 110.321 on the Evoker itself
    const unit = {
      id: "Player-1",
      auraEvents: [
        ev("357210", "Player-1", 108_771, LogEvent.SPELL_AURA_APPLIED),
        ev("357210", "Player-1", 110_321, LogEvent.SPELL_AURA_REMOVED),
        // another unit's flight on this unit's records is not this unit's
        ev("357210", "Player-9", 120_000, LogEvent.SPELL_AURA_APPLIED),
        ev("357210", "Player-9", 122_000, LogEvent.SPELL_AURA_REMOVED),
      ],
      actionIn: [],
    } as unknown as ICombatUnit;
    expect(buildCannotCastIntervals(unit, new Set(["Enemy-1"]))).toEqual([
      { from: 108_771, to: 110_321 },
    ]);
  });

  it("flights pair per id and are never left open (agy 40-FT-85)", () => {
    const unit = {
      id: "Player-1",
      auraEvents: [
        // no REMOVED before the next APPLIED: closed at its 6 s length
        ev("357210", "Player-1", 30_000, LogEvent.SPELL_AURA_APPLIED),
        ev("357210", "Player-1", 90_000, LogEvent.SPELL_AURA_APPLIED),
        ev("357210", "Player-1", 92_000, LogEvent.SPELL_AURA_REMOVED),
        // two ids overlapping: each its own piece
        ev("357210", "Player-1", 100_000, LogEvent.SPELL_AURA_APPLIED),
        ev("433874", "Player-1", 100_500, LogEvent.SPELL_AURA_APPLIED),
        ev("357210", "Player-1", 102_000, LogEvent.SPELL_AURA_REMOVED),
        ev("433874", "Player-1", 103_000, LogEvent.SPELL_AURA_REMOVED),
        // never removed: closed at its 3.75 s length
        ev("433874", "Player-1", 150_000, LogEvent.SPELL_AURA_APPLIED),
      ],
      actionIn: [],
    } as unknown as ICombatUnit;
    expect(
      buildCannotCastIntervals(unit, new Set(["Enemy-1"])).sort(
        (a, b) => a.from - b.from,
      ),
    ).toEqual([
      { from: 30_000, to: 36_000 },
      { from: 90_000, to: 92_000 },
      { from: 100_000, to: 102_000 },
      { from: 100_500, to: 103_000 },
      { from: 150_000, to: 153_750 },
    ]);
  });

  it("a death's lock chain counts the flight's time but does not name it as a CC (agy 40-FT-85)", () => {
    const named = [
      {
        from: 10_000,
        to: 12_000,
        spellId: "357210",
        lockout: false,
        self: true as const,
      },
      { from: 12_000, to: 15_000, spellId: "853", lockout: false },
    ];
    const chain = deathLockChain(named, 15_000, 12_000);
    expect(chain.links.map((l) => l.spellId)).toEqual(["853"]);
    expect(chain.lockedMs).toBe(5_000);
  });

  it("a 1 ms gap is not filled: the covered time stays what the log shows (codex 40-FT-83)", () => {
    const unit = {
      id: "Player-1",
      auraEvents: [
        ev("33786", "Enemy-1", 0, LogEvent.SPELL_AURA_APPLIED),
        ev("33786", "Enemy-1", 2_000, LogEvent.SPELL_AURA_REMOVED),
        ev("33786", "Enemy-1", 2_001, LogEvent.SPELL_AURA_APPLIED),
        ev("33786", "Enemy-1", 4_001, LogEvent.SPELL_AURA_REMOVED),
      ],
      actionIn: [],
    } as unknown as ICombatUnit;
    expect(buildCannotCastIntervals(unit, new Set(["Enemy-1"]))).toEqual([
      { from: 0, to: 2_000 },
      { from: 2_001, to: 4_001 },
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

describe("fact7 D1: a lockout that leaves a heal is no lock on the healer", () => {
  const SHADOW = 32;
  const HOLY = 2;
  const priest = (castId: string, healId: string): any => ({
    spellCastEvents: [
      {
        spellId: castId,
        logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: 1 },
      },
    ],
    id: "priest",
    healOut: [{ spellId: healId, destUnitId: "mate" }],
    absorbsOut: [],
  });
  const lock = (mask: number) => ({
    from: 0,
    to: 5_000,
    spellId: "19244",
    lockout: true,
    lockedSchoolMask: mask,
  });
  const stun = { from: 0, to: 3_000, spellId: "853", lockout: false };

  it("Shadow locked, Penance (47540, heals as 47750) still castable: the lockout drops, a stun stays", () => {
    const u = priest("47540", "47750");
    expect(healerLockIntervals(u, [lock(SHADOW), stun])).toEqual([stun]);
  });
  it("the heals' own school locked: it stays", () => {
    const u = priest("47540", "47750");
    expect(healerLockIntervals(u, [lock(HOLY)])).toHaveLength(1);
  });
  it("no heal pressed this round: nothing says it left one", () => {
    expect(
      healerLockIntervals(priest("589", "47750"), [lock(SHADOW)]),
    ).toHaveLength(1);
  });

  const NATURE = 8;
  const press = (spellId: string, timestamp: number) => ({
    spellId,
    logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp },
  });
  const healer = (
    casts: ReadonlyArray<[string, number]>,
    healOut: ReadonlyArray<{ spellId: string; destUnitId: string }>,
  ): any => ({
    id: "healer",
    spellCastEvents: casts.map(([id, t]) => press(id, t)),
    healOut,
    absorbsOut: [],
  });
  const lockAt = (mask: number, from: number, to: number) => ({
    from,
    to,
    spellId: "1766",
    lockout: true,
    lockedSchoolMask: mask,
  });

  it("Healthstone on the druid is no heal the Nature lock left it (codex 01-2)", () => {
    const u = healer(
      [
        ["6262", 1_000],
        ["8936", 2_000],
      ],
      [
        { spellId: "6262", destUnitId: "healer" },
        { spellId: "8936", destUnitId: "mate" },
      ],
    );
    expect(
      healerLockIntervals(u, [lockAt(NATURE, 10_000, 14_000)]),
    ).toHaveLength(1);
  });
  it("a heal on cooldown reads the unit's own cooldown, not the base (codex 20-F21-07)", () => {
    const u = {
      ...healer(
        [
          ["467307", 1_000],
          ["116670", 2_000],
        ],
        [
          { spellId: "467307", destUnitId: "mate" },
          { spellId: "116670", destUnitId: "mate" },
        ],
      ),
      spec: CombatUnitSpec.Monk_Mistweaver,
    };
    expect(unitCooldownOf(u, "467307")?.cooldownSeconds).toBeGreaterThan(10.5);
    expect(
      healerLockIntervals(u, [lockAt(NATURE, 9_000, 12_000)]),
    ).toHaveLength(1);
  });
  it("Frenzied Regeneration only ever on the druid: the lock stays", () => {
    const u = healer(
      [
        ["22842", 1_000],
        ["8936", 2_000],
      ],
      [
        { spellId: "22842", destUnitId: "healer" },
        { spellId: "8936", destUnitId: "mate" },
      ],
    );
    expect(
      healerLockIntervals(u, [lockAt(NATURE, 100_000, 104_000)]),
    ).toHaveLength(1);
  });
  it("Divine Hymn's tick row 64844 is no press: a Holy lock stays (555 lockouts of the 605 raw logs)", () => {
    const u = healer(
      [
        ["2061", 1_000],
        ["64843", 2_000],
        ["64844", 2_100],
      ],
      [
        { spellId: "2061", destUnitId: "mate" },
        { spellId: "64844", destUnitId: "mate" },
      ],
    );
    expect(healerLockIntervals(u, [lockAt(HOLY, 50_000, 54_000)])).toHaveLength(
      1,
    );
  });
  it("a heal DB2 exempts from a lockout (Emerald Communion, PreventionType 0), with a cooldown of its own, is a press: it leaves a heal while it is ready", () => {
    const u = healer(
      [["370960", 1_000]],
      [{ spellId: "370960", destUnitId: "mate" }],
    );
    expect(
      healerLockIntervals(u, [lockAt(NATURE, 200_000, 204_000)]),
    ).toHaveLength(0);
  });
  it("... and is spent across a lockout inside its cooldown: the lock stays", () => {
    const u = healer(
      [["370960", 1_000]],
      [{ spellId: "370960", destUnitId: "mate" }],
    );
    expect(healerLockIntervals(u, [lockAt(NATURE, 2_000, 6_000)])).toHaveLength(
      1,
    );
  });
  it("a press inside the lockout proves the heal was there, whatever the cooldown says", () => {
    const u = healer(
      [
        ["370960", 1_000],
        ["370960", 4_000],
      ],
      [{ spellId: "370960", destUnitId: "mate" }],
    );
    expect(healerLockIntervals(u, [lockAt(NATURE, 2_000, 6_000)])).toHaveLength(
      0,
    );
  });
  it("T46: a pacify-only heal of the locked school is stopped — Rushing Wind Kick leaves no heal under a Nature lock", () => {
    const u = healer(
      [["467307", 1_000]],
      [{ spellId: "467307", destUnitId: "mate" }],
    );
    expect(
      healerLockIntervals(u, [lockAt(NATURE, 100_000, 104_000)]),
    ).toHaveLength(1);
    // …and is free under a lock of another school (Holy)
    expect(healerLockIntervals(u, [lockAt(2, 100_000, 104_000)])).toHaveLength(
      0,
    );
  });
});
