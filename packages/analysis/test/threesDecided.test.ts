import { CombatUnitReaction } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  candidateAnchorEndS,
  extractCandidateFindings,
  playableEndMs,
  threesDecidedMs,
} from "../src/analysis/candidateFindings";

/**
 * User ruling 2026-09-30: in 3v3 the match is decided at the first friendly
 * player death — nothing after it is coached (the user's own losses, seen on
 * video: surrendering, typing in party chat).
 */
const START = 1_000_000;
const friendly = (id: string, deathAtS?: number) => ({
  id,
  name: `${id}-R`,
  info: {},
  reaction: CombatUnitReaction.Friendly,
  deathRecords:
    deathAtS === undefined ? [] : [{ timestamp: START + deathAtS * 1000 }],
});
const enemy = (id: string, deathAtS?: number) => ({
  ...friendly(id, deathAtS),
  reaction: CombatUnitReaction.Hostile,
});

describe("threesDecidedMs / playableEndMs", () => {
  const threes = { startInfo: { bracket: "3v3" } };

  it("is the first FRIENDLY player death in 3v3", () => {
    const units = [
      enemy("e1", 30), // an enemy death does not decide it
      friendly("f1", 82),
      friendly("f2", 92),
      { deathRecords: [{ timestamp: START + 10_000 }] }, // a pet: ignored
    ];
    expect(threesDecidedMs(threes, units)).toBe(START + 82_000);
    expect(playableEndMs(threes, units)).toBe(START + 82_000);
  });

  it("does nothing outside 3v3, or with no friendly death", () => {
    const units = [friendly("f1", 82)];
    expect(threesDecidedMs({ startInfo: { bracket: "2v2" } }, units)).toBe(
      undefined,
    );
    expect(threesDecidedMs(threes, [friendly("f1"), enemy("e1", 50)])).toBe(
      undefined,
    );
  });

  it("Solo Shuffle keeps its own round end (any player's death)", () => {
    const shuffle = { startInfo: { bracket: "Rated Solo Shuffle" } };
    expect(playableEndMs(shuffle, [enemy("e1", 40), friendly("f1", 60)])).toBe(
      START + 40_000,
    );
  });
});

describe("candidateAnchorEndS", () => {
  it("reads a later death a death-setup names", () => {
    expect(
      candidateAnchorEndS({
        id: "x",
        type: "death-setup",
        t: 80,
        unitNames: [],
        facts: { t: "80", deathT: "91.4" },
      }),
    ).toBe(91.4);
    expect(
      candidateAnchorEndS({
        id: "y",
        type: "cd-hoarded",
        t: 70,
        unitNames: [],
        facts: { t: "70" },
      }),
    ).toBe(70);
  });
});

describe("extractCandidateFindings — 3v3 menu stops at the deciding death", () => {
  const combat = (bracket: string) => ({
    startTime: START,
    endTime: START + 100_000,
    startInfo: { bracket },
    units: {
      f1: friendly("f1", 82),
      f2: friendly("f2", 92),
      f3: friendly("f3"),
    },
  });

  it("keeps the deciding death, drops the later one", () => {
    const deaths = extractCandidateFindings(combat("3v3"))
      .filter((e) => e.type === "death")
      .map((e) => e.unitNames[0]);
    expect(deaths).toEqual(["f1-R"]);
  });

  it("Solo Shuffle's own cut still keeps later deaths (unchanged)", () => {
    const deaths = extractCandidateFindings(combat("Rated Solo Shuffle")).filter(
      (e) => e.type === "death",
    );
    expect(deaths).toHaveLength(2);
  });
});
