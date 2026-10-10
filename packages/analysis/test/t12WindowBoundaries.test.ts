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
import { ensureAnalysisData } from "../src/data/ensure";
import { computeOffensiveWindows } from "../src/utils/offensiveWindows";
import {
  makeAdvancedAction,
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
