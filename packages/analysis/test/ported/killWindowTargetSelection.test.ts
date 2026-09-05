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
    // Barkskin: in the REAL WALL_IN_HAND_MIT_IDS (mitigationData is not
    // mocked); mocked here only for its cooldown.
    "22812": {
      spellId: "22812",
      name: "Barkskin",
      cooldownSeconds: 60,
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
        tier: "locked",
        wallsInHand: [],
      },
      otherTargets: [],
      betterTargetExists: false,
    };
    const lines = formatKillWindowTargetSelectionForContext([evalResult]);
    expect(lines.join("\n")).toContain("no defensives tracked");
  });

  it("all enemies locked (trinkets up) → no accusation regardless of HP", () => {
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

  it("detects a better target on tier: focused locked, alternative prime (B39, 2026-08-18 tier model)", () => {
    // Focused target: trinket still up (never cast) → locked
    const e1 = makeUnit("e1", {
      name: "Warrior",
      spec: CombatUnitSpec.Warrior_Arms,
      advancedActions: [makeAdvancedAction(MATCH_START, 0, 0, 100, 100)],
    });
    // Alternative: trinket burned before the window, nothing stun-usable in
    // hand → prime
    const e2 = makeUnit("e2", {
      name: "Mage",
      spec: CombatUnitSpec.Mage_Frost,
      advancedActions: [makeAdvancedAction(MATCH_START, 0, 0, 100, 30)],
      spellCastEvents: [
        makeSpellCastEvent("336126", MATCH_START + 500, "e2"),
      ],
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
    expect(result[0].focusedTarget.tier).toBe("locked");
    expect(result[0].otherTargets[0].tier).toBe("prime");
    expect(result[0].betterTargetExists).toBe(true);
    expect(result[0].betterTargetName).toBe("Mage");
  });

  it("gated: trinket burned but Barkskin in hand (kit evidence + off CD) → no prime claim", () => {
    const e1 = makeUnit("e1", { name: "Warrior" });
    // Trinket burned at 0.5s; Barkskin cast at 1s (kit evidence), 60s CD →
    // ready again at 61s. Window at 70s: stun-usable mit IN HAND → gated.
    const e2 = makeUnit("e2", {
      name: "Druid",
      spec: CombatUnitSpec.Druid_Feral,
      spellCastEvents: [
        makeSpellCastEvent("336126", MATCH_START + 500, "e2"),
        makeSpellCastEvent("22812", MATCH_START + 1000, "e2"),
      ],
    });
    const windows = [
      {
        fromSeconds: 70,
        toSeconds: 80,
        targetUnitId: "e1",
        durationSeconds: 10,
      },
    ] as any;
    const result = analyzeKillWindowTargetSelection(
      windows,
      [e1, e2],
      makeCombat(),
    );
    expect(result[0].otherTargets[0].tier).toBe("gated");
    expect(result[0].otherTargets[0].wallsInHand).toContain("Barkskin");
    // gated is NOT flagged as a better target — the validated claim is
    // prime-vs-rest only.
    expect(result[0].betterTargetExists).toBe(false);
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

  it("过量施放后按施放重锚计时器 —— 与 chargesAvailableAt 同判据(2026-08-18 统一)", () => {
    // 这条用例的存在理由:统一之前这里手写了一份串行充能模拟,和
    // cooldowns.ts → chargesAvailableAt 是同一件事,但两者在「日志显示模型
    // 认为没层了却仍有施放」这一点上**不一致** —— 手写版让已在跑的计时器
    // 原样继续,共享谓词按该次施放重锚。原有用例一条都区分不出这个差异,
    // 所以统一本身是不可验证的;这条把差异钉住。
    //
    // 剧痛压制 2 层 / 180s:施放于 0s、10s、20s(第三次时模型认为手里是 0
    // 层)。窗口起于 185s:
    //   旧写法 —— 计时器停在 180,185s 时回了 1 层 → 判「可用」
    //   共享谓词 —— 计时器重锚到 20+180=200,185s 时仍是 0 层 → 判「不可用」
    const enemy = makeUnit("e1", {
      name: "Priest",
      spec: CombatUnitSpec.Priest_Discipline,
      spellCastEvents: [0, 10_000, 20_000].map((offset) =>
        makeSpellCastEvent(
          "33206",
          MATCH_START + offset,
          "e1",
          "Self",
          "e1",
          "Priest",
        ),
      ),
    });
    const enemy2 = makeUnit("e2");
    const windows = [
      {
        fromSeconds: 185,
        toSeconds: 195,
        targetUnitId: "e2",
        durationSeconds: 10,
      },
    ] as any;

    const snapshot = analyzeKillWindowTargetSelection(
      windows,
      [enemy, enemy2],
      makeCombat(),
    )[0].otherTargets[0];

    // buff 早已过期(20s + 8s < 185s),所以判定完全由充能数决定。
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
        tier: "locked",
        wallsInHand: [],
      },
      otherTargets: [
        {
          playerName: "BetterP",
          playerSpec: "Mage",
          hpPercent: 20,
          defensivesAvailable: [],
          defensivesUnavailable: ["Block"],
          trinketAvailable: false,
          tier: "prime",
          wallsInHand: [],
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
    expect(lines.join("\n")).toContain("kill-opportunity: PRIME");
  });

  it("no flag → facts only, no certificate line (2026-08-18: the old ✓ line came from the same unvalidated score as the accusation)", () => {
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
        tier: "gated",
        wallsInHand: ["Ice Barrier"],
      },
      otherTargets: [
        {
          playerName: "OtherP",
          playerSpec: "Warrior",
          hpPercent: 100,
          defensivesAvailable: ["Wall"],
          defensivesUnavailable: [],
          trinketAvailable: true,
          tier: "locked",
          wallsInHand: [],
        },
      ],
      betterTargetExists: false,
    };

    const lines = formatKillWindowTargetSelectionForContext([evalResult]);
    const text = lines.join("\n");
    expect(text).not.toContain("✓");
    expect(text).not.toContain("correct or equivalent");
    // 档位注记照常渲染:gated 要点名能逼的那张牌
    expect(text).toContain("gated — Ice Barrier in hand");
    expect(text).toContain("locked — trinket up");
  });
});

