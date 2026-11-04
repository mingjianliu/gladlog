/**
 * fact10 (F25) class 3 — duration pricing, D20: a length that moves with
 * haste whose end the round did not log runs as long as the unit's own
 * completed run of it (46eb2199 1:21: Bladestorm 446035 pressed 1:19.85, its
 * REMOVED 0.2 s past the round's end; the round's first one ran 5.07 s of the
 * official 6). D14 / D17 are pinned in talentDurationTooltips.test.ts; the
 * corpus check is `packages/eval/scripts/scan5/fact10.ts`
 * resHastedLeftUnclosed.
 */
import {
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  ownCompletedRunSeconds,
  reconstructEnemyCDTimeline,
} from "../src/utils/enemyCDs";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const BLADESTORM = "446035";
const row = (event: LogEvent, s: number) => ({
  spellId: BLADESTORM,
  spellName: "Bladestorm",
  srcUnitId: "w",
  destUnitId: "w",
  timestamp: T0 + s * 1000,
  logLine: { event, timestamp: T0 + s * 1000 },
});
const warrior = (firstRun: boolean) => ({
  id: "w",
  name: "Warrior",
  type: 1,
  class: CombatUnitClass.Warrior,
  spec: CombatUnitSpec.Warrior_Arms,
  spellCastEvents: [
    ...(firstRun ? [row(LogEvent.SPELL_CAST_SUCCESS, 10)] : []),
    row(LogEvent.SPELL_CAST_SUCCESS, 79.85),
  ],
  auraEvents: [
    ...(firstRun
      ? [
          row(LogEvent.SPELL_AURA_APPLIED, 10),
          row(LogEvent.SPELL_AURA_REMOVED, 15.07),
        ]
      : []),
    row(LogEvent.SPELL_AURA_APPLIED, 79.85),
    // past the round's end
    row(LogEvent.SPELL_AURA_REMOVED, 84.907),
  ],
  damageIn: [],
  damageOut: [],
  healOut: [],
  healIn: [],
  absorbsIn: [],
  absorbsOut: [],
  actionIn: [],
  actionOut: [],
  deathRecords: [],
});
const combatOf = (u: unknown) =>
  ({
    startTime: T0,
    endTime: T0 + 84_710,
    units: { w: u },
  }) as never;
const secondEnd = (firstRun: boolean): number | undefined => {
  const u = warrior(firstRun);
  const tl = reconstructEnemyCDTimeline([u as never], combatOf(u));
  return tl.players[0]?.offensiveCDs.find((c) => c.castTimeSeconds > 70)
    ?.buffEndSeconds;
};

describe("fact10 D20 — a hasted length the round did not close", () => {
  it("the unit's own completed run is read, the run past the round's end is not", () => {
    const u = warrior(true);
    expect(
      ownCompletedRunSeconds(u as never, BLADESTORM, T0 + 79_850, combatOf(u)),
    ).toBeCloseTo(5.07, 6);
    expect(
      ownCompletedRunSeconds(u as never, BLADESTORM, T0 + 200_000, combatOf(u)),
    ).toBeCloseTo(5.07, 6);
  });
  it("46eb2199 1:21: the second Bladestorm's window ends at 79.85 + 5.07, not at the official 6 s", () => {
    const end = secondEnd(true);
    expect(end).toBeDefined();
    expect(end!).toBeCloseTo(79.85 + 5.07, 6);
  });
  it("with no completed run in the round, the official length stands", () => {
    const end = secondEnd(false);
    expect(end).toBeDefined();
    expect(end! - 79.85).toBeGreaterThan(5.5);
  });
});
