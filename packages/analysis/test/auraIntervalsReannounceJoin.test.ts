import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src";
import { buildAuraIntervals } from "../src/utils/auraIntervals";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

// GH #136.3 (triage enemy-def F-E12): a re-announced aura is one press for
// every reader of `buildAuraIntervals`, not only `[ENEMY DEF]` (f4eb8c87
// 2:47: one Divine Shield read as `0.9s` + `7.1s`).

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;
const DS = "642"; // Divine Shield, 8 s

function round(casts: number[], applied: number[], removed: number) {
  const pal = makeUnit("p1", {
    name: "Pal",
    reaction: CombatUnitReaction.Friendly,
    info: {},
    spellCastEvents: casts.map((s) =>
      makeSpellCastEvent(DS, at(s), "p1", "Pal", "p1", "Pal"),
    ),
    auraEvents: [
      ...applied.map((s) =>
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, DS, at(s), "p1", "p1"),
      ),
      makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, DS, at(removed), "p1", "p1"),
    ],
  });
  return {
    pal,
    combat: { startTime: T0, endTime: at(120), units: { p1: pal } },
  };
}

const shields = (r: { spellId: string; fromS: number; toS: number }[]) =>
  r.filter((i) => i.spellId === DS).map((i) => [i.fromS, i.toS]);

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("buildAuraIntervals joins a re-announced aura (GH #136.3)", () => {
  it("re-APPLIED 0.9 s after its one press: one interval", () => {
    const { pal, combat } = round([10], [10, 10.9], 18);
    expect(shields(buildAuraIntervals(pal, combat))).toEqual([[10, 18]]);
  });

  it("a source the round does not know stays split", () => {
    const { pal } = round([10], [10, 10.9], 18);
    const combat = { startTime: T0, endTime: at(120) };
    expect(shields(buildAuraIntervals(pal, combat))).toEqual([
      [10, 10.9],
      [10.9, 18],
    ]);
  });

  it("a press next to the second APPLIED and not the first is a new press", () => {
    const { pal, combat } = round([9.9], [2, 10], 18);
    expect(shields(buildAuraIntervals(pal, combat))).toEqual([
      [2, 10],
      [10, 18],
    ]);
  });

  it("two presses around the pieces stay two", () => {
    const { pal, combat } = round([10, 10.9], [10, 10.9], 18);
    expect(shields(buildAuraIntervals(pal, combat))).toHaveLength(2);
  });
});
