import { CombatUnitSpec } from "@gladlog/parser-compat";
import { describe, expect,it } from "vitest";

import { buildMatchArc } from "../src/context/matchNarrative";
import { IMajorCooldownInfo } from "../src/utils/cooldowns";
import { IEnemyCDTimeline } from "../src/utils/enemyCDs";
import { makeUnit } from "./ported/testHelpers";

describe("buildMatchArc", () => {
  // Helpers to construct mock inputs
  function createMockBurst(
    from: number,
    to: number,
    label = "High",
    cdNames: string[] = ["Combustion"],
  ) {
    return {
      fromSeconds: from,
      toSeconds: to,
      activeCDs: cdNames.map((name) => ({ spellName: name })),
      dangerLabel: label,
    };
  }

  function createMockCD(
    spellName: string,
    casts: number[],
    tag: "Defensive" | "Offensive" = "Defensive",
  ): IMajorCooldownInfo {
    return {
      spellId: "12345",
      spellName,
      tag,
      cooldownSeconds: 60,
      maxChargesDetected: 1,
      casts: casts.map((t) => ({ timeSeconds: t })),
      availableWindows: [],
      neverUsed: casts.length === 0,
    } as IMajorCooldownInfo;
  }

  // 1. No burst, no deaths
  it("无 burst 无死亡 -> 输出仍有基本骨架", () => {
    const enemyCDTimeline = {
      players: [],
      alignedBurstWindows: [],
    } as unknown as IEnemyCDTimeline;

    const allTeamCooldownsWithPlayer: Array<{
      player: any;
      cd: IMajorCooldownInfo;
    }> = [];
    const friendlyDeaths: Array<{ spec: string; atSeconds: number }> = [];

    const result = buildMatchArc(
      enemyCDTimeline,
      allTeamCooldownsWithPlayer,
      friendlyDeaths,
      120, // durationSeconds
      "3v3",
    );

    expect(result).toEqual([
      "MATCH ARC:",
      "  Early (0:00–1:00): No coordinated burst; match opened with sustained pressure and no defensive CDs committed.",
      "  Mid (1:00–1:30): No major defensive CDs committed; match progressed through sustained pressure.",
      "  Late (1:30–2:00): Match concluded — no friendly deaths; pressure neutralized.",
    ]);
  });

  // 2. Single burst + an owner defensive CD trade
  it("单 burst + owner 防御 CD trade -> 因果顺序: Early/burst 先于 Mid/post-trade", () => {
    // Enemy burst: 10s to 40s
    const burst = createMockBurst(10, 40, "High", ["Combustion"]);
    const enemyCDTimeline = {
      players: [],
      alignedBurstWindows: [burst],
    } as unknown as IEnemyCDTimeline;

    // Team defensive: cast at 20s
    const player = makeUnit("Player1", {
      spec: CombatUnitSpec.Druid_Restoration,
    });
    const cd = createMockCD("Ironbark", [20], "Defensive");
    const allTeamCooldownsWithPlayer = [{ player, cd }];

    const friendlyDeaths: Array<{ spec: string; atSeconds: number }> = [];

    const result = buildMatchArc(
      enemyCDTimeline,
      allTeamCooldownsWithPlayer,
      friendlyDeaths,
      120,
      "3v3",
    );

    // Assert causal order: early end is at 20s (first defensive).
    // Early phase (0:00-0:20) should contain the burst starting at 10s.
    // Mid phase (0:20-0:40) should contain the trade.
    // Late phase (0:40-2:00) should be the resolution.
    expect(result[0]).toBe("MATCH ARC:");
    expect(result[1]).toBe(
      "  Early (0:00–0:20): Enemy aligned burst established pressure (High — Combustion); no major defensives spent.",
    );
    expect(result[2]).toBe(
      "  Mid (0:20–0:40): Restoration Druid's Ironbark committed — limited major CD coverage remaining.",
    );
    expect(result[3]).toBe(
      "  Late (0:40–2:00): Match concluded — no friendly deaths; pressure neutralized.",
    );
  });

  // 3. Burst followed by a friendly death
  it("burst 后随友方死亡 -> 死亡行归入对应 burst 段落", () => {
    // First defensive at 30s
    const player = makeUnit("Player1", {
      spec: CombatUnitSpec.Druid_Restoration,
    });
    const cd = createMockCD("Ironbark", [30], "Defensive");
    const allTeamCooldownsWithPlayer = [{ player, cd }];

    // Burst 1: 40s to 50s. Burst 2: 70s to 80s (Late phase)
    const burst1 = createMockBurst(40, 50, "High", ["Combustion"]);
    const burst2 = createMockBurst(70, 80, "High", ["Avatar"]);
    const enemyCDTimeline = {
      players: [],
      alignedBurstWindows: [burst1, burst2],
    } as unknown as IEnemyCDTimeline;

    // Death at 75s (during burst)
    const friendlyDeaths = [{ spec: "Restoration Druid", atSeconds: 75 }];

    const result = buildMatchArc(
      enemyCDTimeline,
      allTeamCooldownsWithPlayer,
      friendlyDeaths,
      120,
      "3v3",
    );

    // earlyEnd = 30
    // firstBurstResolved = 50 (from Burst 1)
    // midEnd = min(75, 50) = 50
    // lateStart = max(30, 50) = 50
    // Early phase (0:00-0:30)
    // Mid phase (0:30-0:50)
    // Late phase (0:50-1:15)
    expect(result[3]).toBe(
      "  Late (0:50–2:00): Second burst (High) aligned with limited defensive options → Restoration Druid died at 1:15.",
    );
  });

  // 4. Multiple bursts (two or more non-overlapping windows) -> phases sorted by
  // time
  it("多 burst -> 段落按时间排序", () => {
    const burst1 = createMockBurst(40, 50, "High", ["Combustion"]);
    const burst2 = createMockBurst(70, 80, "High", ["Avatar"]);
    const enemyCDTimeline = {
      players: [],
      alignedBurstWindows: [burst2, burst1], // passed out of order to test sorting
    } as unknown as IEnemyCDTimeline;

    const player = makeUnit("Player1", {
      spec: CombatUnitSpec.Druid_Restoration,
    });
    const cd = createMockCD("Ironbark", [30], "Defensive");
    const allTeamCooldownsWithPlayer = [{ player, cd }];
    const friendlyDeaths = [{ spec: "Restoration Druid", atSeconds: 90 }];

    const result = buildMatchArc(
      enemyCDTimeline,
      allTeamCooldownsWithPlayer,
      friendlyDeaths,
      120,
      "3v3",
    );

    expect(result[1]).toContain("Early (0:00–0:30)");
    expect(result[2]).toContain("Mid (0:30–0:50)");
    expect(result[3]).toContain("Late (0:50–2:00)");
  });

  // 5. Conditional branch coverage
  describe("条件分支覆盖", () => {
    it("短对局 (duration < 90) 且有死亡", () => {
      const enemyCDTimeline = {
        players: [],
        alignedBurstWindows: [],
      } as unknown as IEnemyCDTimeline;
      const friendlyDeaths = [{ spec: "Restoration Druid", atSeconds: 45 }];
      const result = buildMatchArc(
        enemyCDTimeline,
        [],
        friendlyDeaths,
        60,
        "3v3",
      );
      expect(result).toEqual([
        "MATCH ARC:",
        "  Pressure (0:00–0:30): Early pressure established — no recovery window.",
        "  Death (0:30–1:00): Restoration Druid died at 0:45 — speed kill.",
      ]);
    });

    it("短对局 (duration < 90) 且无死亡", () => {
      const enemyCDTimeline = {
        players: [],
        alignedBurstWindows: [],
      } as unknown as IEnemyCDTimeline;
      const result = buildMatchArc(enemyCDTimeline, [], [], 60, "3v3");
      expect(result).toEqual([
        "MATCH ARC:",
        "  Pressure (0:00–0:30): Early pressure established — no recovery window.",
        "  Resolution (0:30–1:00): Match resolved quickly — no friendly deaths.",
      ]);
    });

    it("长对局 - Early phase: earlyBursts.length > 0", () => {
      const burst = createMockBurst(15, 25, "Medium", ["Vendetta"]);
      const enemyCDTimeline = {
        players: [],
        alignedBurstWindows: [burst],
      } as unknown as IEnemyCDTimeline;
      const player = makeUnit("Player1", {
        spec: CombatUnitSpec.Druid_Restoration,
      });
      const cd = createMockCD("Ironbark", [30], "Defensive");
      const result = buildMatchArc(
        enemyCDTimeline,
        [{ player, cd }],
        [],
        120,
        "3v3",
      );

      expect(result[1]).toBe(
        "  Early (0:00–0:30): Enemy aligned burst established pressure (Medium — Vendetta); no major defensives spent.",
      );
    });

    it("长对局 - Mid phase: firstDefensiveSeconds === Infinity", () => {
      const burst = createMockBurst(90, 110, "Low", ["Vendetta"]);
      const enemyCDTimeline = {
        players: [],
        alignedBurstWindows: [burst],
      } as unknown as IEnemyCDTimeline;
      const result = buildMatchArc(
        enemyCDTimeline,
        [],
        [{ spec: "Restoration Druid", atSeconds: 100 }],
        120,
        "3v3",
      );

      expect(result[2]).toBe(
        "  Mid (1:00–1:40): No major defensive CDs committed; match progressed through sustained pressure.",
      );
    });

    it("长对局 - Mid phase: earlyEnd >= lateStart (Mid phase skipped)", () => {
      const burst = createMockBurst(10, 20, "High", ["Combustion"]);
      const enemyCDTimeline = {
        players: [],
        alignedBurstWindows: [burst],
      } as unknown as IEnemyCDTimeline;
      const player = makeUnit("Player1", {
        spec: CombatUnitSpec.Druid_Restoration,
      });
      const cd = createMockCD("Ironbark", [30], "Defensive");
      const result = buildMatchArc(
        enemyCDTimeline,
        [{ player, cd }],
        [],
        120,
        "3v3",
      );

      expect(result.some((line) => line.includes("Mid ("))).toBe(false);
    });

    it("长对局 - Late phase: bracket === 3v3 and duration > 180 and no deaths (Dampening)", () => {
      const enemyCDTimeline = {
        players: [],
        alignedBurstWindows: [],
      } as unknown as IEnemyCDTimeline;
      const result = buildMatchArc(enemyCDTimeline, [], [], 200, "3v3");
      expect(result[result.length - 1]).toBe(
        "  Late (2:30–3:20): Dampening reached — healing reduced; match extended to kill window.",
      );
    });
  });
});
