/**
 * T12 ① "window boundaries" (user ruling 2026-10-10): windows, damage spikes
 * and kill-attempt lines do not run past the target's death or the round's
 * end. One describe per producer; the fixtures are shaped on the real rounds
 * the evidence pack names.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { kickPriorityDecisionPoints } from "../src/analysis/candidates/kickPriority";
import { emitDmgSpikeEntries } from "../src/context/matchTimelineSections";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  computePressureWindows,
  isSpikeHealedThrough,
} from "../src/utils/cooldowns";
import { computeOffensiveWindows } from "../src/utils/offensiveWindows";
import {
  makeAdvancedAction,
  makeDamageEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("① a — a kill window ends at its target's death (computeOffensiveWindows)", () => {
  const BARKSKIN = "22812";

  const druid = (
    castS: number,
    deathS?: number,
    advancedActions: ReturnType<typeof makeAdvancedAction>[] = [],
  ) =>
    makeUnit("e1", {
      name: "EnemyDruid",
      spec: CombatUnitSpec.Druid_Feral,
      reaction: CombatUnitReaction.Hostile,
      info: {},
      spellCastEvents: [
        makeSpellCastEvent(
          BARKSKIN,
          at(castS),
          "e1",
          "EnemyDruid",
          "e1",
          "EnemyDruid",
        ),
      ],
      deathRecords: deathS === undefined ? [] : [{ timestamp: at(deathS) }],
      advancedActions,
    });

  // 65-1 (3v3): the kill target died at 77.08 s, the round ran to 107 s.
  const combat = { startTime: T0, endTime: at(107), units: {} } as never;

  it("the span that ran to the round's end stops at the death", () => {
    const alive = computeOffensiveWindows([druid(50)] as never, [], combat);
    expect(alive).toHaveLength(1);
    expect(alive[0]!.toSeconds).toBeGreaterThan(100);

    const died = computeOffensiveWindows(
      [druid(50, 77.08)] as never,
      [],
      combat,
    );
    expect(died).toHaveLength(1);
    expect(died[0]!.fromSeconds).toBe(alive[0]!.fromSeconds);
    expect(died[0]!.toSeconds).toBeCloseTo(77.08, 6);
    expect(died[0]!.durationSeconds).toBeCloseTo(
      77.08 - alive[0]!.fromSeconds,
      6,
    );
  });

  // 1bad0a5c: the wall's nominal end fell after the death at 95.797 s — the
  // prompt read `[VULNERABLE] 1:38–1:50` on a shaman dead at 1:35.
  it("a span that would start at or after the death does not exist", () => {
    const alive = computeOffensiveWindows([druid(90)] as never, [], {
      startTime: T0,
      endTime: at(120),
      units: {},
    } as never);
    expect(alive).toHaveLength(1);
    const died = computeOffensiveWindows([druid(90, 95.797)] as never, [], {
      startTime: T0,
      endTime: at(120),
      units: {},
    } as never);
    expect(died).toEqual([]);
    // dying exactly when the span opens: still no span
    const onTheEdge = computeOffensiveWindows(
      [druid(90, alive[0]!.fromSeconds)] as never,
      [],
      { startTime: T0, endTime: at(120), units: {} } as never,
    );
    expect(onTheEdge).toEqual([]);
  });

  it("a span the death leaves shorter than the minimum is dropped", () => {
    const alive = computeOffensiveWindows([druid(50)] as never, [], combat);
    const from = alive[0]!.fromSeconds;
    expect(
      computeOffensiveWindows([druid(50, from + 4.9)] as never, [], combat),
    ).toEqual([]);
    expect(
      computeOffensiveWindows([druid(50, from + 5)] as never, [], combat),
    ).toHaveLength(1);
  });

  // D1: `kick-priority` read "the kill target at 0 %" off a span that ran
  // past the death — 65-1's Shadow Mend started at 79.4 s, 2.3 s after it.
  describe("kick-priority does not point at a target already dead (D1)", () => {
    const FLASH_HEAL = "2061";
    const healerWithCast = (startS: number) =>
      makeUnit("e2", {
        name: "EnemyPriest",
        spec: CombatUnitSpec.Priest_Holy,
        reaction: CombatUnitReaction.Hostile,
        info: {},
        castStartEvents: [
          {
            ...makeSpellCastEvent(
              FLASH_HEAL,
              at(startS),
              "",
              "",
              "e2",
              "EnemyPriest",
            ),
            logLine: {
              event: LogEvent.SPELL_CAST_START,
              timestamp: at(startS),
              parameters: [],
            },
          },
        ],
        spellCastEvents: [
          makeSpellCastEvent(
            FLASH_HEAL,
            at(startS + 1.5),
            "",
            "",
            "e2",
            "EnemyPriest",
          ),
        ],
        healOut: [
          {
            logLine: {
              event: LogEvent.SPELL_HEAL,
              timestamp: at(startS + 1.5),
              parameters: [],
            },
            timestamp: at(startS + 1.5),
            spellId: FLASH_HEAL,
            effectiveAmount: 100_000,
            destUnitId: "e3",
          },
        ],
      });
    const friend = makeUnit("p1", {
      name: "Rogue",
      spec: CombatUnitSpec.Rogue_Subtlety,
      info: {},
    });
    // HP 20 % while alive, 0 at the death — the reading the candidate took
    const hp = [
      makeAdvancedAction(at(69.5), 0, 0, 500_000, 100_000),
      makeAdvancedAction(at(77.08), 0, 0, 500_000, 0),
    ];
    const points = (startS: number) => {
      const enemies = [druid(50, 77.08, hp), healerWithCast(startS)];
      return kickPriorityDecisionPoints(
        [friend],
        enemies,
        {
          startTime: T0,
          endTime: at(107),
          units: Object.fromEntries([friend, ...enemies].map((u) => [u.id, u])),
        },
        { eligibility: "bootstrap" },
      );
    };

    it("a heal started while the target lived is a decision point, and its span ends at the death", () => {
      const pts = points(70);
      expect(pts).toHaveLength(1);
      expect(pts[0]!.targetId).toBe("e1");
      expect(pts[0]!.targetHpPct).toBe(20);
      expect(pts[0]!.windowToS).toBeCloseTo(77.08, 6);
    });

    it("a heal started 2.3 s after the target's death is not", () => {
      expect(points(79.4)).toEqual([]);
    });
  });
});

describe("① c — a [DMG SPIKE] bucket closes at its victim's death / the round's end", () => {
  // 121-5-690 (Duration 0:47, the unit dead at 0:45): the line read
  // `0:39–0:49 … 0.60M in 10s (60k DPS) (33% -> 100% HP, +7%/s, low 17% @0:44)`
  const hits = (seconds: number[], amount = 100_000) =>
    seconds.map((s) => makeDamageEvent(at(s), amount, "f1"));
  const victim = (opts: {
    hitsAt: number[];
    deathS?: number;
    hp?: Array<[number, number]>;
  }) =>
    makeUnit("f1", {
      name: "Victim-Realm",
      spec: CombatUnitSpec.Warlock_Affliction,
      info: {},
      damageIn: hits(opts.hitsAt),
      deathRecords:
        opts.deathS === undefined ? [] : [{ timestamp: at(opts.deathS) }],
      advancedActions: (opts.hp ?? []).map(([s, pct]) =>
        makeAdvancedAction(at(s), 0, 0, 100, pct),
      ),
    });
  const combatOf = (
    endS: number,
    units: ReturnType<typeof makeUnit>[],
    bracket = "3v3",
  ) =>
    ({
      startTime: T0,
      endTime: at(endS),
      startInfo: { bracket },
      units: Object.fromEntries(units.map((u) => [u.id, u])),
    }) as never;
  const render = (
    unit: ReturnType<typeof makeUnit>,
    combat: Parameters<typeof computePressureWindows>[1],
  ) => {
    const out: string[] = [];
    emitDmgSpikeEntries({
      pressureWindows: computePressureWindows([unit], combat),
      friends: [unit],
      matchStartMs: T0,
      pid: (n) => n.split("-")[0]!,
      addEntry: (_t, ...ls) => out.push(...ls),
    });
    return out;
  };

  it("the bucket ends at the death, the damage is unchanged, the selection is unchanged", () => {
    const hitsAt = [39.2, 40.5, 41.7, 42.9, 44.1, 45.2];
    const alive = victim({ hitsAt });
    const before = computePressureWindows([alive], combatOf(300, [alive]));
    expect(before[0]).toMatchObject({
      fromSeconds: 39.2,
      toSeconds: 49.2,
      totalDamage: 600_000,
    });

    const dead = victim({ hitsAt, deathS: 45.2 });
    const after = computePressureWindows([dead], combatOf(47, [dead]));
    expect(after).toHaveLength(before.length);
    expect(after[0]).toMatchObject({
      fromSeconds: 39.2,
      toSeconds: 45.2,
      totalDamage: 600_000,
    });
    for (const b of after) {
      expect(b.toSeconds).toBeLessThanOrEqual(45.2);
      expect(b.toSeconds).toBeGreaterThanOrEqual(b.fromSeconds);
    }
  });

  it("the line prints the closed bucket: its end second, its width, 0 % at the death — and never `healed through`", () => {
    const dead = victim({
      hitsAt: [39.2, 40.5, 41.7, 42.9, 44.1, 45.2],
      deathS: 45.2,
      // 33 % at the start; the sample nearest the end second is one logged
      // after the death (100 % — what the sampler alone would print)
      hp: [
        [39, 33],
        [43, 17],
        [45.9, 100],
      ],
    });
    const lines = render(dead, combatOf(47, [dead]));
    expect(lines[0]).toContain("0:39–0:45  [DMG SPIKE]");
    expect(lines[0]).toContain("0.60M in 6s (100k DPS)");
    expect(lines[0]).toContain("(33% -> 0% HP, -6%/s)");
    expect(lines.join("\n")).not.toContain("healed through");
    expect(lines.join("\n")).not.toContain("100% HP");
  });

  it("a full bucket still reads `in 10s` with endpoints 10 apart", () => {
    const alive = victim({
      hitsAt: [39.2, 40.5, 41.7, 42.9, 44.1, 45.2],
      hp: [
        [39, 80],
        [49, 60],
      ],
    });
    const lines = render(alive, combatOf(300, [alive]));
    expect(lines[0]).toContain("0:39–0:49  [DMG SPIKE]");
    expect(lines[0]).toContain("0.60M in 10s (60k DPS)");
    expect(lines[0]).toContain("(80% -> 60% HP, -2%/s)");
  });

  it("a bucket does not run past ARENA_MATCH_END", () => {
    const alive = victim({ hitsAt: [39.2, 40.5, 41.7, 42.9, 44.1, 45.2] });
    const w = computePressureWindows([alive], combatOf(47, [alive]));
    expect(w[0]).toMatchObject({ fromSeconds: 39.2, toSeconds: 47 });
  });

  it("a Solo Shuffle round ends at its first player death: later hits are not summed, no bucket starts after it", () => {
    const survivor = victim({ hitsAt: [39.2, 40.5, 41.7, 44.5, 45.2, 46] });
    const other = makeUnit("f2", {
      name: "Other-Realm",
      info: {},
      deathRecords: [{ timestamp: at(43) }],
    });
    const w = computePressureWindows(
      [survivor],
      combatOf(47, [survivor, other], "Rated Solo Shuffle"),
    );
    expect(w[0]).toMatchObject({
      fromSeconds: 39.2,
      toSeconds: 43,
      totalDamage: 300_000,
    });
    for (const b of w) expect(b.fromSeconds).toBeLessThanOrEqual(43);
  });

  it("isSpikeHealedThrough: equal-or-higher HP, no trough, and alive at the end", () => {
    expect(isSpikeHealedThrough(62, 71, false)).toBe(true);
    expect(isSpikeHealedThrough(50, 50, false)).toBe(true);
    expect(isSpikeHealedThrough(71, 38, false)).toBe(false);
    expect(isSpikeHealedThrough(81, 87, true)).toBe(false);
    // a bucket opened in the death second: 0 % -> 0 % is a death
    expect(isSpikeHealedThrough(0, 0, false)).toBe(false);
  });

  it("a bucket opened in the death second reads 0 % at its end and carries no outcome word", () => {
    const dead = victim({
      hitsAt: [45.2],
      deathS: 45.2,
      hp: [[45.2, 0]],
    });
    const out: string[] = [];
    emitDmgSpikeEntries({
      pressureWindows: [
        {
          fromSeconds: 45.2,
          toSeconds: 45.2,
          totalDamage: 600_000,
          targetName: "Victim-Realm",
          targetSpec: "Affliction Warlock",
        },
      ],
      friends: [dead],
      matchStartMs: T0,
      pid: (n) => n.split("-")[0]!,
      addEntry: (_t, ...ls) => out.push(...ls),
    });
    expect(out[0]).toContain("(0% -> 0% HP");
    expect(out[0]).not.toContain("healed through");
  });
});
