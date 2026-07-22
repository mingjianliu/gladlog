/* eslint-disable @typescript-eslint/no-explicit-any */
// Mock the data first
vi.mock("../../src/data/spellIdLists", () => ({
  default: {
    externalOrBigDefensiveSpellIds: ["33206"], // Pain Suppression
    externalDefensiveSpellIds: ["33206"],
    bigDefensiveSpellIds: [],
  },
}));

vi.mock("../../src/data/spellEffectData", () => ({
  spellEffectData: {
    "33206": {
      spellId: "33206",
      name: "Pain Suppression",
      cooldownSeconds: 180,
      charges: { charges: 2, chargeCooldownSeconds: 180 },
    },
    "45438": {
      spellId: "45438",
      name: "Ice Block",
      cooldownSeconds: 240,
    },
  },
}));

import { CombatUnitSpec } from "@gladlog/parser-compat";

import {
  analyzeKillWindowTargetSelection,
  formatKillWindowTargetSelectionForContext,
  getHpPercentAtTime,
  getLowestHpPercentInWindow,
} from "../../src/utils/killWindowTargetSelection";
import {
  makeAdvancedAction,
  makeSpellCastEvent,
  makeUnit,
} from "./testHelpers";

const MATCH_START = 1_000_000;

describe("killWindowTargetSelection — HP helpers", () => {
  it("getHpPercentAtTime returns null when no advanced actions", () => {
    const unit = makeUnit("u1");
    expect(getHpPercentAtTime(unit, 10, MATCH_START)).toBeNull();
  });

  it("getHpPercentAtTime returns the nearest sample within the shared ±3s radius (B4 fix)", () => {
    const unit = makeUnit("u1", {
      advancedActions: [
        makeAdvancedAction(MATCH_START + 5000, 0, 0, 100, 50), // 50%
        makeAdvancedAction(MATCH_START + 10000, 0, 0, 100, 80), // 80%
      ],
    });
    // t=8s: nearest is the 10s sample (2s away) — two-sided nearest, same basis as [STATE]
    expect(getHpPercentAtTime(unit, 8, MATCH_START)).toBe(80);
    expect(getHpPercentAtTime(unit, 12, MATCH_START)).toBe(80);
    // t=2s: the 5s sample is exactly 3s away — inside the radius
    expect(getHpPercentAtTime(unit, 2, MATCH_START)).toBe(50);
    // t=15s: nearest sample (10s) is 5s away — beyond the radius, render nothing
    expect(getHpPercentAtTime(unit, 15, MATCH_START)).toBeNull();
  });

  it("getLowestHpPercentInWindow scans correctly", () => {
    const unit = makeUnit("u1", {
      advancedActions: [
        makeAdvancedAction(MATCH_START + 5000, 0, 0, 100, 50),
        makeAdvancedAction(MATCH_START + 10000, 0, 0, 100, 20), // lowest
        makeAdvancedAction(MATCH_START + 15000, 0, 0, 100, 40),
        makeAdvancedAction(MATCH_START + 25000, 0, 0, 100, 10), // out of window
      ],
    });
    expect(getLowestHpPercentInWindow(unit, 6, 20, MATCH_START)).toBe(20);
  });

  it("handles units with zero max HP", () => {
    const unit = makeUnit("u1", {
      advancedActions: [makeAdvancedAction(MATCH_START, 0, 0, 0, 100)],
    });
    expect(getHpPercentAtTime(unit, 0, MATCH_START)).toBeNull();
    expect(getLowestHpPercentInWindow(unit, 0, 10, MATCH_START)).toBeNull();
  });
});

describe("killWindowTargetSelection — main analysis", () => {
  function makeCombat() {
    return { startTime: MATCH_START } as any;
  }

  it("returns empty when less than 2 enemies", () => {
    const windows = [
      {
        fromSeconds: 10,
        toSeconds: 20,
        targetUnitId: "e1",
        durationSeconds: 10,
      },
    ] as any;
    const enemy = makeUnit("e1");
    expect(
      analyzeKillWindowTargetSelection(windows, [enemy], makeCombat()),
    ).toHaveLength(0);
  });

  it("filters out short windows", () => {
    const windows = [
      { fromSeconds: 10, toSeconds: 12, durationSeconds: 2 },
    ] as any;
    expect(
      analyzeKillWindowTargetSelection(
        windows,
        [makeUnit("e1"), makeUnit("e2")],
        makeCombat(),
      ),
    ).toHaveLength(0);
  });

  it("no trinket use detected → available(开局重置推断,2026-07-22 拍板)(B41)", () => {
    const enemy = makeUnit("e1", { name: "E1", spellCastEvents: [] });
    const enemy2 = makeUnit("e2", { name: "E2" });
    const windows = [
      {
        fromSeconds: 10,
        toSeconds: 20,
        targetUnitId: "e2",
        durationSeconds: 10,
      },
    ] as any;
    const result = analyzeKillWindowTargetSelection(
      windows,
      [enemy, enemy2],
      makeCombat(),
    );
    expect(result[0].otherTargets[0].trinketAvailable).toBe(true);
  });

  it("handles no defensives tracked formatting (B42)", () => {
    const evalResult: any = {
      windowFromSeconds: 10,
      windowToSeconds: 20,
      focusedTarget: {
        playerName: "NoDefP",
        playerSpec: "Warrior",
        hpPercent: 100,
        defensivesAvailable: [],
        defensivesUnavailable: [],
        trinketAvailable: true,
        softnessScore: 10,
      },
      otherTargets: [],
      betterTargetExists: false,
    };
    const lines = formatKillWindowTargetSelectionForContext([evalResult]);
    expect(lines.join("\n")).toContain("no defensives tracked");
  });

  it("covers softness comparison branches", () => {
    const e1 = makeUnit("e1", {
      advancedActions: [makeAdvancedAction(MATCH_START, 0, 0, 100, 50)],
    });
    const e2 = makeUnit("e2", {
      advancedActions: [makeAdvancedAction(MATCH_START, 0, 0, 100, 60)],
    });
    const e3 = makeUnit("e3", {
      advancedActions: [makeAdvancedAction(MATCH_START, 0, 0, 100, 70)],
    });

    const windows = [
      { fromSeconds: 1, toSeconds: 10, targetUnitId: "e1", durationSeconds: 9 },
    ] as any;
    const result = analyzeKillWindowTargetSelection(
      windows,
      [e1, e2, e3],
      makeCombat(),
    );
    expect(result).toHaveLength(1);
    expect(result[0].betterTargetExists).toBe(false);
  });

  it("detects a better target based on softness score (B39)", () => {
    // Focused target: full HP, has defensives
    const e1 = makeUnit("e1", {
      name: "Warrior",
      spec: CombatUnitSpec.Warrior_Arms,
      advancedActions: [makeAdvancedAction(MATCH_START, 0, 0, 100, 100)],
    });
    // Alternative target: low HP, no defensives
    const e2 = makeUnit("e2", {
      name: "Mage",
      spec: CombatUnitSpec.Mage_Frost,
      advancedActions: [makeAdvancedAction(MATCH_START, 0, 0, 100, 30)],
    });

    const windows = [
      { fromSeconds: 1, toSeconds: 10, targetUnitId: "e1", durationSeconds: 9 },
    ] as any;
    const result = analyzeKillWindowTargetSelection(
      windows,
      [e1, e2],
      makeCombat(),
    );

    expect(result).toHaveLength(1);
    expect(result[0].betterTargetExists).toBe(true);
    expect(result[0].betterTargetName).toBe("Mage");
  });

  it("simulates charge regeneration for defensives (B40)", () => {
    // Pain Suppression (33206) - 2 charges, 180s CD, 8s duration
    // Cast 1 at 0s, Cast 2 at 10s.
    // At 20s, both charges should be spent.
    const enemy = makeUnit("e1", {
      name: "Priest",
      spec: CombatUnitSpec.Priest_Discipline,
      spellCastEvents: [
        makeSpellCastEvent(
          "33206",
          MATCH_START + 0,
          "e1",
          "Self",
          "e1",
          "Priest",
        ),
        makeSpellCastEvent(
          "33206",
          MATCH_START + 10_000,
          "e1",
          "Self",
          "e1",
          "Priest",
        ),
      ],
    });
    const enemy2 = makeUnit("e2");
    const windows = [
      {
        fromSeconds: 20,
        toSeconds: 30,
        targetUnitId: "e2",
        durationSeconds: 10,
      },
    ] as any;

    const result = analyzeKillWindowTargetSelection(
      windows,
      [enemy, enemy2],
      makeCombat(),
    );
    const snapshot = result[0].otherTargets[0];

    expect(snapshot.defensivesUnavailable).toContain("Pain Suppression");
    expect(snapshot.defensivesAvailable).not.toContain("Pain Suppression");
  });

  it("correctly identifies available defensives and handles trinket cast after window start (B43)", () => {
    const enemy = makeUnit("e1", {
      name: "Priest",
      spec: CombatUnitSpec.Priest_Discipline,
      spellCastEvents: [
        // Pain Suppression cast long ago (CD finished)
        makeSpellCastEvent(
          "33206",
          MATCH_START - 500_000,
          "e1",
          "Self",
          "e1",
          "Priest",
        ),
        // Trinket used long ago
        makeSpellCastEvent(
          "336126",
          MATCH_START - 500_000,
          "e1",
          "Self",
          "e1",
          "Priest",
        ),
        // Trinket used AFTER window start
        makeSpellCastEvent(
          "336126",
          MATCH_START + 50_000,
          "e1",
          "Self",
          "e1",
          "Priest",
        ),
      ],
    });
    const enemy2 = makeUnit("e2");
    const windows = [
      {
        fromSeconds: 20,
        toSeconds: 30,
        targetUnitId: "e2",
        durationSeconds: 10,
      },
    ] as any;

    const result = analyzeKillWindowTargetSelection(
      windows,
      [enemy, enemy2],
      makeCombat(),
    );
    const snapshot = result[0].otherTargets[0];

    expect(snapshot.defensivesAvailable).toContain("Pain Suppression");
    expect(snapshot.trinketAvailable).toBe(true);
  });
});

describe("formatKillWindowTargetSelectionForContext", () => {
  it("formats correctly with a better target available", () => {
    const evalResult: any = {
      windowFromSeconds: 10,
      windowToSeconds: 20,
      focusedTarget: {
        playerName: "FocusedP",
        playerSpec: "Warrior",
        hpPercent: 100,
        defensivesAvailable: ["Wall"],
        defensivesUnavailable: [],
        trinketAvailable: true,
        softnessScore: 10,
      },
      otherTargets: [
        {
          playerName: "BetterP",
          playerSpec: "Mage",
          hpPercent: 20,
          defensivesAvailable: [],
          defensivesUnavailable: ["Block"],
          trinketAvailable: false,
          softnessScore: 90,
        },
      ],
      betterTargetExists: true,
      betterTargetName: "BetterP",
      betterTargetSpec: "Mage",
    };

    const lines = formatKillWindowTargetSelectionForContext([evalResult]);
    expect(lines.join("\n")).toContain(
      "⚠ Better target available: Mage (BetterP)",
    );
    expect(lines.join("\n")).toContain("trinket on CD");
  });

  it("formats correctly when focused target was correct", () => {
    const evalResult: any = {
      windowFromSeconds: 10,
      windowToSeconds: 20,
      focusedTarget: {
        playerName: "FocusedP",
        playerSpec: "Mage",
        hpPercent: 20,
        defensivesAvailable: [],
        defensivesUnavailable: ["Block"],
        trinketAvailable: false,
        softnessScore: 90,
      },
      otherTargets: [
        {
          playerName: "OtherP",
          playerSpec: "Warrior",
          hpPercent: 100,
          defensivesAvailable: ["Wall"],
          defensivesUnavailable: [],
          trinketAvailable: true,
          softnessScore: 10,
        },
      ],
      betterTargetExists: false,
    };

    const lines = formatKillWindowTargetSelectionForContext([evalResult]);
    expect(lines.join("\n")).toContain(
      "✓ Focused target was the correct or equivalent choice",
    );
  });
});
