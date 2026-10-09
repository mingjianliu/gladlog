import { describe, expect, it } from "vitest";

import { IMajorCooldownInfo } from "../src/utils/cooldowns";
import {
  benchmarks,
  formatDTPSBaselines,
  INCOMING_BASELINE_DEFINITION_NOTE,
  formatLobbyMmrFact,
  formatSpecBaselines,
  IBenchmarkData,
} from "../src/utils/specBaselines";

describe("specBaselines — formatSpecBaselines", () => {
  const mockData: IBenchmarkData = {
    bySpec: {
      "Arms Warrior": {
        sampleCount: 150,
        defensiveTiming: {
          optimalPct: 45.2,
          earlyPct: 20.1,
          latePct: 15.4,
          reactivePct: 10.3,
          unknownPct: 9.0,
        },
        cdUsage: {
          "Die by the Sword": {
            neverUsedRate: 0.15,
            medianFirstUseSeconds: 35,
            p75FirstUseSeconds: 65,
          },
          "Rallying Cry": {
            neverUsedRate: 0.40,
            medianFirstUseSeconds: null,
            p75FirstUseSeconds: null,
          },
        },
      },
    },
  };

  it("returns empty array for unknown spec", () => {
    const lines = formatSpecBaselines("Unknown Spec", [], mockData);
    expect(lines).toEqual([]);
  });

  it("formats defensive timing and CD reference lines correctly", () => {
    const ownerCDs = [
      { spellName: "Die by the Sword" } as IMajorCooldownInfo,
      { spellName: "Rallying Cry" } as IMajorCooldownInfo,
      { spellName: "Shield Wall" } as IMajorCooldownInfo, // not in cdUsage
    ];

    const lines = formatSpecBaselines("Arms Warrior", ownerCDs, mockData);

    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe("SPEC BASELINES — Arms Warrior at ≥2100 personal rating (n=150):");
    expect(lines[1]).toBe("  Defensive timing: Optimal 45% | Early 20% | Late 15% | Reactive 10% | Unknown 9%");
    expect(lines[2]).toBe("  CD reference (% of matches used | median first use | p75 first use):");
    expect(lines[3]).toBe("    Die by the Sword: 85% used | 0:35 median | 1:05 p75");
    expect(lines[4]).toBe("    Rallying Cry: 60% used | — median | — p75");
    // Rallying Cry has null median/p75 -> formats with "—"
  });

  it("formats em dash '—' when median or p75 first use is null", () => {
    const ownerCDs = [
      { spellName: "Rallying Cry" } as IMajorCooldownInfo,
    ];

    const lines = formatSpecBaselines("Arms Warrior", ownerCDs, mockData);
    expect(lines).toContain("    Rallying Cry: 60% used | — median | — p75");
  });

  it("omits defensive timing if defensiveTiming field is null", () => {
    const noTimingData: IBenchmarkData = {
      bySpec: {
        "Fire Mage": {
          sampleCount: 50,
          defensiveTiming: null,
          cdUsage: {},
        },
      },
    };

    const lines = formatSpecBaselines("Fire Mage", [], noTimingData);
    expect(lines).toEqual(["SPEC BASELINES — Fire Mage at ≥2100 personal rating (n=50):"]);
  });
});

describe("specBaselines — formatDTPSBaselines", () => {
  const mockData: IBenchmarkData = {
    bySpec: {
      "Arms Warrior": {
        sampleCount: 150,
        defensiveTiming: null,
        cdUsage: {},
        pressureWindows: {
          p50: 120_450,
          p75: 180_000,
          p90: 250_800,
          p95: 310_000,
        },
      },
      "Holy Paladin": {
        sampleCount: 200,
        defensiveTiming: null,
        cdUsage: {},
        pressureWindows: {
          p50: 95_200,
          p75: 140_000,
          p90: 190_100,
          p95: 230_000,
        },
      },
      "No Pressure Spec": {
        sampleCount: 10,
        defensiveTiming: null,
        cdUsage: {},
      },
    },
  };

  it("returns empty array when none of the friendly specs have pressure windows", () => {
    expect(formatDTPSBaselines(["No Pressure Spec", "Nonexistent Spec"], mockData)).toEqual([]);
    expect(formatDTPSBaselines([], mockData)).toEqual([]);
  });

  it("formats DTPS baselines for matching specs in thousands (k)", () => {
    const lines = formatDTPSBaselines(["Arms Warrior", "Holy Paladin", "No Pressure Spec"], mockData);

    expect(lines).toEqual([
      "INCOMING DAMAGE BASELINES (per 10s window, ≥2100 personal rating):",
      INCOMING_BASELINE_DEFINITION_NOTE,
      "  Arms Warrior (n=150): p50 120k | p90 251k",
      "  Holy Paladin (n=200): p50 95k | p90 190k",
    ]);
  });
});

describe("specBaselines — production benchmarks json", () => {
  it("exports valid benchmark data with known specs", () => {
    expect(benchmarks).toBeDefined();
    expect(benchmarks.bySpec).toBeDefined();
    expect(Object.keys(benchmarks.bySpec).length).toBeGreaterThan(0);
  });
});

describe("formatLobbyMmrFact (B21a: the lobby's MMR as its own fact)", () => {
  const TAIL =
    " — the lobby's rating, not your personal rating; the reference rates below are filtered on personal rating, never on this";
  it("3v3 / 2v2: your team and the enemy team, by the owner's team id", () => {
    // e10c6bea: ARENA_MATCH_END,1,234,1548,1725 with the owner on team 1
    expect(
      formatLobbyMmrFact({
        teamMmr: { team0: 1548, team1: 1725 },
        playerTeamId: "1",
        startInfo: { bracket: "3v3" },
      }),
    ).toEqual([
      `  Lobby matchmaking rating (MMR): your team 1725 | enemy team 1548${TAIL}`,
    ]);
    expect(
      formatLobbyMmrFact({
        teamMmr: { team0: 2596, team1: 2584 },
        playerTeamId: "0",
        startInfo: { bracket: "2v2" },
      })[0],
    ).toContain("your team 2596 | enemy team 2584");
  });

  it("Solo Shuffle, or an unknown own team: the two numbers without sides", () => {
    expect(
      formatLobbyMmrFact({
        teamMmr: { team0: 2247, team1: 2253 },
        playerTeamId: "1",
        startInfo: { bracket: "Rated Solo Shuffle" },
      }),
    ).toEqual([`  Lobby matchmaking rating (MMR): 2247 / 2253${TAIL}`]);
    expect(
      formatLobbyMmrFact({
        teamMmr: { team0: 1548, team1: 1725 },
        playerTeamId: null,
        startInfo: { bracket: "3v3" },
      })[0],
    ).toContain("(MMR): 1548 / 1725 —");
  });

  it("nothing when the log did not say: null, absent (an older document), zero", () => {
    expect(formatLobbyMmrFact({ teamMmr: null, playerTeamId: "0" })).toEqual(
      [],
    );
    expect(formatLobbyMmrFact({ playerTeamId: "0" })).toEqual([]);
    expect(
      formatLobbyMmrFact({
        teamMmr: { team0: 0, team1: 1725 },
        playerTeamId: "0",
      }),
    ).toEqual([]);
  });

  it("the personal-rating comparison does not read it", () => {
    const data = {
      bySpec: { "Holy Paladin": { sampleCount: 298, cdUsage: {} } },
    } as unknown as IBenchmarkData;
    // personal rating 192 in a 1725-MMR lobby: still "below the reference bracket"
    expect(formatSpecBaselines("Holy Paladin", [], data, 192)[0]).toContain(
      "your personal rating in this bracket is 192, below the reference bracket",
    );
  });
});
