import { CombatUnitSpec } from "@gladlog/parser-compat";
import { describe, expect,it } from "vitest";

import {
  buildMatchArc,
  buildMatchArcStructured,
  IMatchArcPhase,
} from "../src/context/matchNarrative";
import { IMajorCooldownInfo } from "../src/utils/cooldowns";
import { IEnemyCDTimeline } from "../src/utils/enemyCDs";
import { makeUnit } from "./ported/testHelpers";

// #10 T1: buildMatchArcStructured single-source structured output + barrel +
// dead-code cleanup.
// Iron rule: buildMatchArc's prose output must be byte-for-byte identical
// before and after the refactor — the existing context.matchNarrative.test.ts
// is the anti-rot net; this file additionally covers ① structured assertions,
// ② consistency assertions against an inlined snapshot of the old
// implementation, ③ a positive barrel-import case, ④ a negative case for the
// barrel's export surface.

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

describe("buildMatchArcStructured", () => {
  // ① Synthetic input: hand-computed phase boundaries + turningPoint
  it("burst 后随友方死亡 -> 相位边界与 turningPoint 与手算一致", () => {
    const player = makeUnit("Player1", {
      spec: CombatUnitSpec.Druid_Restoration,
    });
    const cd = createMockCD("Ironbark", [30], "Defensive");
    const allTeamCooldownsWithPlayer = [{ player, cd }];

    const burst1 = createMockBurst(40, 50, "High", ["Combustion"]);
    const burst2 = createMockBurst(70, 80, "High", ["Avatar"]);
    const enemyCDTimeline = {
      players: [],
      alignedBurstWindows: [burst1, burst2],
    } as unknown as IEnemyCDTimeline;

    const friendlyDeaths = [{ spec: "Restoration Druid", atSeconds: 75 }];

    // By hand: earlyEnd=30 (first defensive CD); firstBurstResolved=50 (burst1.toSeconds);
    // firstFriendlyDeathSeconds=75; midEnd=min(75,50)=50; lateStart=max(30,50)=50.
    const phases = buildMatchArcStructured(
      enemyCDTimeline,
      allTeamCooldownsWithPlayer,
      friendlyDeaths,
      120,
      "3v3",
    );

    const expected: IMatchArcPhase[] = [
      {
        phase: "early",
        fromS: 0,
        toS: 30,
        prose:
          "No coordinated enemy burst in opening phase; sustained/DoT pressure building.",
        turningPoint: { tS: 30, label: "Restoration Druid's Ironbark" },
      },
      {
        phase: "mid",
        fromS: 30,
        toS: 50,
        prose:
          "Restoration Druid's Ironbark committed in response to High burst at 0:40 — limited major CD coverage remaining.",
        turningPoint: { tS: 50, label: "burst window resolved" },
      },
      {
        phase: "late",
        fromS: 50,
        toS: 120,
        prose:
          "Second burst (High) aligned with limited defensive options → Restoration Druid died at 1:15.",
      },
    ];

    expect(phases).toEqual(expected);
  });

  // ① Second synthetic input: with no deaths, the mid turningPoint falls on the
  // "first burst window resolved" branch
  it("单 burst + owner 防御 CD trade,无死亡 -> mid turningPoint = 首爆发窗解决", () => {
    const player = makeUnit("Player1", {
      spec: CombatUnitSpec.Druid_Restoration,
    });
    const cd = createMockCD("Ironbark", [20], "Defensive");
    const allTeamCooldownsWithPlayer = [{ player, cd }];
    const burst = createMockBurst(10, 40, "High", ["Combustion"]);
    const enemyCDTimeline = {
      players: [],
      alignedBurstWindows: [burst],
    } as unknown as IEnemyCDTimeline;

    const phases = buildMatchArcStructured(
      enemyCDTimeline,
      allTeamCooldownsWithPlayer,
      [],
      120,
      "3v3",
    );

    expect(phases[0]).toEqual({
      phase: "early",
      fromS: 0,
      toS: 20,
      prose:
        "Enemy aligned burst established pressure (High — Combustion); no major defensives spent.",
      turningPoint: { tS: 20, label: "Restoration Druid's Ironbark" },
    });
    expect(phases[1]).toEqual({
      phase: "mid",
      fromS: 20,
      toS: 40,
      prose:
        "Restoration Druid's Ironbark committed — limited major CD coverage remaining.",
      turningPoint: { tS: 40, label: "burst window resolved" },
    });
    expect(phases[2].phase).toBe("late");
    expect(phases[2].turningPoint).toBeUndefined();
  });

  // Short matches (<90s) collapse into two phases, same branch as the prose
  // version
  it("短对局 (duration < 90) 且有死亡 -> 两相位 early/late,无 mid", () => {
    const enemyCDTimeline = {
      players: [],
      alignedBurstWindows: [],
    } as unknown as IEnemyCDTimeline;
    const friendlyDeaths = [{ spec: "Restoration Druid", atSeconds: 45 }];

    const phases = buildMatchArcStructured(
      enemyCDTimeline,
      [],
      friendlyDeaths,
      60,
      "3v3",
    );

    expect(phases).toEqual([
      {
        phase: "early",
        fromS: 0,
        toS: 30,
        prose: "Early pressure established — no recovery window.",
      },
      {
        phase: "late",
        fromS: 30,
        toS: 60,
        prose: "Restoration Druid died at 0:45 — speed kill.",
      },
    ]);
  });

  // Mid-phase skip case: when earlyEnd >= lateStart the structured array must
  // contain no mid phase either
  it("长对局 - earlyEnd >= lateStart -> structured 数组无 mid 相位", () => {
    const burst = createMockBurst(10, 20, "High", ["Combustion"]);
    const enemyCDTimeline = {
      players: [],
      alignedBurstWindows: [burst],
    } as unknown as IEnemyCDTimeline;
    const player = makeUnit("Player1", {
      spec: CombatUnitSpec.Druid_Restoration,
    });
    const cd = createMockCD("Ironbark", [30], "Defensive");

    const phases = buildMatchArcStructured(
      enemyCDTimeline,
      [{ player, cd }],
      [],
      120,
      "3v3",
    );

    expect(phases.map((p) => p.phase)).toEqual(["early", "late"]);
  });
});

describe("buildMatchArc 一致性断言 (重构前后逐字节不变)", () => {
  // Inlined snapshots of the old implementation's expected output (same source
  // as cases 1/3/5a in context.matchNarrative.test.ts, transcribed separately
  // so a shared fixture cannot mask a regression).

  it("无 burst 无死亡 -> 旧实现快照仍匹配", () => {
    const enemyCDTimeline = {
      players: [],
      alignedBurstWindows: [],
    } as unknown as IEnemyCDTimeline;

    const result = buildMatchArc(enemyCDTimeline, [], [], 120, "3v3");

    expect(result).toEqual([
      "MATCH ARC:",
      "  Early (0:00–1:00): No coordinated burst; match opened with sustained pressure and no defensive CDs committed.",
      "  Mid (1:00–1:30): No major defensive CDs committed; match progressed through sustained pressure.",
      "  Late (1:30–2:00): Match concluded — no friendly deaths; pressure neutralized.",
    ]);
  });

  it("burst 后随友方死亡 -> 旧实现快照仍匹配", () => {
    const player = makeUnit("Player1", {
      spec: CombatUnitSpec.Druid_Restoration,
    });
    const cd = createMockCD("Ironbark", [30], "Defensive");
    const allTeamCooldownsWithPlayer = [{ player, cd }];

    const burst1 = createMockBurst(40, 50, "High", ["Combustion"]);
    const burst2 = createMockBurst(70, 80, "High", ["Avatar"]);
    const enemyCDTimeline = {
      players: [],
      alignedBurstWindows: [burst1, burst2],
    } as unknown as IEnemyCDTimeline;

    const friendlyDeaths = [{ spec: "Restoration Druid", atSeconds: 75 }];

    const result = buildMatchArc(
      enemyCDTimeline,
      allTeamCooldownsWithPlayer,
      friendlyDeaths,
      120,
      "3v3",
    );

    expect(result).toEqual([
      "MATCH ARC:",
      "  Early (0:00–0:30): No coordinated enemy burst in opening phase; sustained/DoT pressure building.",
      "  Mid (0:30–0:50): Restoration Druid's Ironbark committed in response to High burst at 0:40 — limited major CD coverage remaining.",
      "  Late (0:50–2:00): Second burst (High) aligned with limited defensive options → Restoration Druid died at 1:15.",
    ]);
  });

  it("短对局 (duration < 90) 且有死亡 -> 旧实现快照仍匹配", () => {
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
});

describe("packages/analysis barrel (#10 T1)", () => {
  it("③ positionAnalysis 入 barrel -> computeOwnerPositionEvents 编译且可调用", async () => {
    const { computeOwnerPositionEvents } = await import("../src/index");
    expect(typeof computeOwnerPositionEvents).toBe("function");
  });

  it("④ CD 重叠死码四符号已从 index 导出面移除", async () => {
    const barrel = (await import("../src/index")) as Record<string, unknown>;
    expect(barrel.detectFriendlyCDOverlaps).toBeUndefined();
    expect(barrel.formatFriendlyCDOverlapsForContext).toBeUndefined();
  });
});

// ④ (continued) Interfaces live purely at the type level and leave no runtime
// trace — so the directive below asserts "importing these two type names from
// the barrel fails to compile". If the dead-code cleanup were rolled back
// (types re-exported), those two lines would become unused-directive compile
// errors and typecheck would go red.
// (Careful when rewrapping this paragraph: a prose line must never begin with
// the directive name, or TS reads it as a real directive — TS2578.)
// @ts-expect-error IOverlapCast was removed from index's public export surface (dead-code cleanup, #10 T1)
import type { IOverlapCast } from "../src/index";
// @ts-expect-error IFriendlyCDOverlapGroup was removed from index's public export surface (dead-code cleanup, #10 T1)
import type { IFriendlyCDOverlapGroup } from "../src/index";

// Referenced once to avoid "declared but never used" noise (a type-position
// reference, producing no runtime code).
type _UnusedTypeRefs = [IOverlapCast, IFriendlyCDOverlapGroup];
