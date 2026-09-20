import type { IPlayerCCTrinketSummary } from "@gladlog/analysis";
import { describe, expect, it } from "vitest";

// #10 T2: the cc KeyMoment used to receive ICCInstance.drInfo and throw it all
// away — CC cut down to 50%/25%/Immune by DR looked identical on the moment
// axis to a full-duration one, so it could never teach "this CC was actually
// shortened by DR". We mock analyzePlayerCCAndTrinket to drive drInfo directly
// instead of scraping a DR chain out of the real corpus (the existing fixture's
// 90s trimmed window contains no natural DR hit).
const state = vi.hoisted(() => ({
  summary: null as IPlayerCCTrinketSummary | null,
}));

const emptySummary: IPlayerCCTrinketSummary = {
  playerName: "",
  playerSpec: "",
  trinketType: "Unknown",
  trinketCooldownSeconds: 0,
  ccInstances: [],
  trinketUseTimes: [],
  missedTrinketWindows: [],
  rootInstances: [],
  disarmInstances: [],
  interruptInstances: [],
  ccAvoidedInstances: [],
};

vi.mock("@gladlog/analysis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@gladlog/analysis")>();
  return {
    ...actual,
    analyzePlayerCCAndTrinket: () => state.summary ?? emptySummary,
  };
});

import { DR_LEVEL_LABEL } from "@gladlog/analysis";

import { deriveKeyMoments } from "../src/renderer/src/report/derive/keyMoments";
import type { ReportSource } from "../src/renderer/src/report/derive/types";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const base = loadRealMatchFixture();

function ccInstance(
  overrides: Partial<IPlayerCCTrinketSummary["ccInstances"][number]>,
): IPlayerCCTrinketSummary["ccInstances"][number] {
  return {
    atSeconds: 10,
    durationSeconds: 4,
    spellId: "1",
    spellName: "Test Stun",
    sourceName: "Enemy1-Test",
    sourceId: "Player-Enemy1",
    sourceSpec: "",
    damageTakenDuring: 0,
    trinketState: "available_unused",
    drInfo: null,
    distanceYards: null,
    losBlocked: null,
    ...overrides,
  };
}

describe("deriveKeyMoments — cc 时刻 DR 档位标注(#10 T2)", () => {
  it("drInfo 非 Full 时 detail 附带 DR_LEVEL_LABEL 实际文案", () => {
    state.summary = {
      ...emptySummary,
      ccInstances: [
        ccInstance({
          drInfo: { category: "Stun", level: "50%", sequenceIndex: 1 },
        }),
      ],
    };
    const ms = deriveKeyMoments(base as unknown as ReportSource);
    const cc = ms.find((m) => m.kind === "cc");
    expect(cc).toBeTruthy();
    expect(cc!.detail).toContain(`DR:${DR_LEVEL_LABEL["50%"]}`);
  });

  it("drInfo.level === Full 时不加噪声(不出现 DR: 前缀)", () => {
    state.summary = {
      ...emptySummary,
      ccInstances: [
        ccInstance({
          drInfo: { category: "Stun", level: "Full", sequenceIndex: 0 },
        }),
      ],
    };
    const ms = deriveKeyMoments(base as unknown as ReportSource);
    const cc = ms.find((m) => m.kind === "cc");
    expect(cc).toBeTruthy();
    expect(cc!.detail).not.toContain("DR:");
  });

  it("drInfo 为 null(非 DR 类控制)时不加 DR 文案", () => {
    state.summary = {
      ...emptySummary,
      ccInstances: [ccInstance({ drInfo: null })],
    };
    const ms = deriveKeyMoments(base as unknown as ReportSource);
    const cc = ms.find((m) => m.kind === "cc");
    expect(cc).toBeTruthy();
    expect(cc!.detail).not.toContain("DR:");
  });
});
