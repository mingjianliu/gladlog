import { describe, expect, it, vi } from "vitest";

// #10 T4: the three-way position-kind filter — STAYED_IN with
// stayedInHadRealCost() / MISSED_PUSH / CD_OUT_OF_RANGE make it onto the
// timeline; KITED and "cost-free" STAYED_IN do not (the predicate is
// single-source with deep-dive's hasCoachableSignal; see stayedInHadRealCost
// in packages/analysis/src/utils/positionAnalysis.ts). Real geometry
// (advancedActions) is out of scope for this file — only the return value of
// computeOwnerPositionEvents is mocked; the other analysis functions consume
// the real fixture.
vi.mock("@gladlog/analysis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@gladlog/analysis")>();
  return {
    ...actual,
    computeOwnerPositionEvents: vi.fn(() => [
      // Real cost: 100% → 30%, stayedInHadRealCost(30) = true → should
      // make the timeline (2026-08-20 GH #16 接地:门收紧为 hpMin<35,fixture
      // 从 40 收到 30)
      {
        type: "STAYED_IN",
        atSeconds: 5,
        toSeconds: 10,
        startDistanceYards: 3,
        endDistanceYards: 4,
        nearestEnemyName: "PlayerA-Test",
        dangerLabel: "High",
        ownerHpStartPct: 100,
        ownerHpMinPct: 30,
      },
      // No cost: 100% → 95%(hpMin ≥ 35)→ stayedInHadRealCost = false →
      // should NOT make the timeline
      {
        type: "STAYED_IN",
        atSeconds: 20,
        toSeconds: 25,
        startDistanceYards: 3,
        endDistanceYards: 4,
        nearestEnemyName: "PlayerA-Test",
        dangerLabel: "Low",
        ownerHpStartPct: 100,
        ownerHpMinPct: 95,
      },
      // KITED: not in the three-type whitelist → should NOT make the timeline
      {
        type: "KITED",
        atSeconds: 30,
        toSeconds: 35,
        startDistanceYards: 3,
        endDistanceYards: 20,
        nearestEnemyName: "PlayerA-Test",
        dangerLabel: "High",
      },
      {
        type: "MISSED_PUSH",
        atSeconds: 40,
        toSeconds: 55,
        startDistanceYards: 30,
      },
      {
        type: "CD_OUT_OF_RANGE",
        atSeconds: 60,
        startDistanceYards: 25,
        nearestEnemyName: "PlayerA-Test",
        spellName: "Wild Charge",
      },
      // SPLIT_PUSH/HEALER_TRAINED: not in the whitelist → should NOT make the
      // timeline (coverage strengthened during review: previously only KITED
      // was tested as an exclusion case).
      {
        type: "SPLIT_PUSH",
        atSeconds: 70,
        toSeconds: 80,
        nearestEnemyName: "PlayerA-Test",
        playersInvolved: ["PlayerD-Test"],
      },
      {
        type: "HEALER_TRAINED",
        atSeconds: 90,
        toSeconds: 100,
        nearestEnemyName: "PlayerA-Test",
        startDistanceYards: 4,
        playersInvolved: ["PlayerD-Test"],
      },
    ]),
  };
});

import { POSITION_MISTAKES, type PositionEventType } from "@gladlog/analysis";

import fixture from "../../../../../test/fixtures/report-match.json";
import { deriveKeyMoments } from "./keyMoments";
import type { ReportSource } from "./types";

const source = fixture as unknown as ReportSource;

// keyMoments.ts assigns each of the three POSITION_MISTAKES types its own
// unique title string. This reverse lookup table exists only for this test: it
// maps a title that made the timeline back to the PositionEventType that
// produced it, so we can ask the real single-source whitelist
// (POSITION_MISTAKES) whether it counts.
const TITLE_TO_TYPE: Record<string, PositionEventType> = {
  顶着爆发硬扛: "STAYED_IN",
  该压没压: "MISSED_PUSH",
  "CD 距离外": "CD_OUT_OF_RANGE",
};

describe("deriveKeyMoments — position kind (#10 T4)", () => {
  it("STAYED_IN(有代价)/MISSED_PUSH/CD_OUT_OF_RANGE 进轴,KITED/SPLIT_PUSH/HEALER_TRAINED/无代价 STAYED_IN 不进", () => {
    const moments = deriveKeyMoments(source);
    const positions = moments.filter((m) => m.kind === "position");
    expect(positions.map((m) => m.t).sort((a, b) => a - b)).toEqual([
      5, 40, 60,
    ]);
    expect(positions.every((m) => m.weight === "minor")).toBe(true);
    expect(positions.every((m) => m.side === "friendly")).toBe(true);
    expect(positions.every((m) => m.jumpT === m.t)).toBe(true);
  });

  it("复核修复(等价保护):keyMoments 实际接受的类型集合 ⊆ POSITION_MISTAKES(单源白名单)", () => {
    const moments = deriveKeyMoments(source);
    const positions = moments.filter((m) => m.kind === "position");
    // guard that the assertion itself hasn't degenerated into a no-op
    expect(positions.length).toBeGreaterThan(0);
    for (const m of positions) {
      const type = TITLE_TO_TYPE[m.title];
      // every entry on the timeline maps back to a known type
      expect(type).toBeDefined();
      expect(POSITION_MISTAKES.has(type!)).toBe(true);
    }
  });
});
