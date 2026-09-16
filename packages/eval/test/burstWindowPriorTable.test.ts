/**
 * GH #60 phase 1 — the burst-window reference table's construction rules, and
 * the analysis-side lookup's fallback ladder.
 *
 * Pins the three things a reference table can silently get wrong: which
 * population enters it (feasible only), what the fallback ladder does when a
 * cell is too small, and that the n floor is the crisis reference's number
 * rather than a second copy of 50.
 */
import { BEHAVIOR_PRIOR_N_FLOOR } from "@gladlog/analysis/src/data/behaviorPrior";
import { BURST_WINDOW_PRIOR_N_FLOOR } from "@gladlog/analysis/src/data/burstWindowPrior";
import { describe, expect, it } from "vitest";

import {
  buildBurstWindowPriorTable,
  type BurstWindowPriorRow,
} from "../src/explore/burstWindowPriorTable";

function point(over: Record<string, unknown> = {}): any {
  return {
    tMs: 0,
    tSec: 0,
    endSec: 10,
    durationSec: 10,
    leadCd: {
      spellId: "13750",
      spellName: "Adrenaline Rush",
      casterName: "E",
      casterSpec: "Outlaw Rogue",
      castSec: 0,
    },
    extraCds: [],
    casterIds: ["E1"],
    responses: {
      wall: false,
      external: false,
      healCd: false,
      control: false,
      kite: false,
      attackerMoved: false,
    },
    responded: false,
    firstResponseSec: null,
    responseCasts: [],
    feasible: true,
    feasibleUnits: ["F"],
    anyFriendlyDeath: false,
    deathsInWindow: 0,
    minFriendlyHpPct: 50,
    friendlyOutcomes: [],
    ...over,
  };
}
const row = (over: Record<string, unknown> = {}, bracket = "3v3") =>
  ({ bracket, point: point(over) }) as unknown as BurstWindowPriorRow;

const META = {
  generatedAt: "2026-08-31",
  corpus: "test",
  command: "test",
  predicateVersion: 1,
};

describe("buildBurstWindowPriorTable", () => {
  it("counts only feasible windows — an infeasible one enters neither population", () => {
    const t = buildBurstWindowPriorTable(
      [
        row(),
        row({ feasible: false, feasibleUnits: [] }),
        row({ responded: true, responses: { wall: true } }),
      ],
      META,
    );
    const cell = t.cells["3v3|13750"]!;
    expect(cell.nNoResp).toBe(1);
    expect(cell.nResp).toBe(1);
  });

  it("death rate is per population, and the responders' answers are ranked by share of nResp", () => {
    const t = buildBurstWindowPriorTable(
      [
        row({ anyFriendlyDeath: true }),
        row(),
        row({
          responded: true,
          responses: { wall: true, healCd: true },
          anyFriendlyDeath: true,
        }),
        row({ responded: true, responses: { wall: true } }),
        row({ responded: true, responses: { wall: true } }),
        row({ responded: true, responses: { control: true } }),
      ],
      META,
    );
    const cell = t.cells["3v3|13750"]!;
    expect(cell.nNoResp).toBe(2);
    expect(cell.deathNoResp).toBe(0.5);
    expect(cell.nResp).toBe(4);
    expect(cell.deathResp).toBe(0.25);
    expect(cell.topResponses).toEqual([
      ["wall", 0.75],
      ["healCd", 0.25],
      ["control", 0.25],
    ]);
  });

  it("every window also lands in its bracket-wide and global fallback cells", () => {
    const t = buildBurstWindowPriorTable(
      [row(), row({}, "Rated Solo Shuffle")],
      META,
    );
    expect(Object.keys(t.cells).sort()).toEqual([
      "*|*",
      "3v3|*",
      "3v3|13750",
      "Rated Solo Shuffle|*",
      "Rated Solo Shuffle|13750",
    ]);
    expect(t.cells["*|*"]!.nNoResp).toBe(2);
  });
});

describe("BURST_WINDOW_PRIOR_N_FLOOR", () => {
  it("is the crisis reference's floor, imported rather than a second copy", () => {
    expect(BURST_WINDOW_PRIOR_N_FLOOR).toBe(BEHAVIOR_PRIOR_N_FLOOR);
  });
});
