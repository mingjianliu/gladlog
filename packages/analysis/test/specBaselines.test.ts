import { describe, expect, it } from "vitest";

import { IMajorCooldownInfo } from "../src/utils/cooldowns";
import {
  benchmarks,
  formatDTPSBaselines,
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
    expect(lines[0]).toBe("SPEC BASELINES — Arms Warrior at ≥2100 MMR (n=150):");
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
    expect(lines).toEqual(["SPEC BASELINES — Fire Mage at ≥2100 MMR (n=50):"]);
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
      "INCOMING DAMAGE BASELINES (per 10s window, ≥2100 MMR):",
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
