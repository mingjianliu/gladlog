// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";

import { ensureAnalysisData } from "@gladlog/analysis";

import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import { UncoveredHighlightsCard } from "../src/renderer/src/report/components/UncoveredHighlightsCard";
import { loadRealMatchFixtureWithUncoveredWindow } from "./fixtures/loadFixture";

// The loader strips the enemy buffs whose missed-purge anchors would otherwise
// cover all 9 sweep windows (see its comment: PW:S / Ice Barrier since
// 2026-08-13, Prayer of Mending since e027c06c on 2026-08-17). Without that,
// this file's click-path tests would have no card to click at all — the
// uncovered-highlight assertions below say "80–90s survives dedup", which is a
// property of that stripped fixture, not of every real match.
const m = loadRealMatchFixtureWithUncoveredWindow();

beforeAll(async () => {
  // Pack-building precondition: spell names in the prompt must not degrade
  // (same as windowAnalysis.test.tsx)
  await ensureAnalysisData();
});

function installFixtureBridge(analyzeWindow = vi.fn()) {
  (window as any).__gladlogFixture = {
    settings: {
      get: vi.fn().mockResolvedValue({ aiLanguage: "zh" }),
      save: vi.fn().mockResolvedValue({}),
    },
    analysis: {
      // cached:null and running:false → StructuredAnalysisPanel sits idle and
      // produces no findings — so the dedup anchor for uncovered highlights
      // comes only from mistakesAll (a global derive with no network/model
      // dependency), which keeps this click-path test deterministic.
      getState: vi.fn().mockResolvedValue({ cached: null, running: false }),
      getCached: vi.fn().mockResolvedValue(null),
      getFlags: vi.fn().mockResolvedValue({}),
      aggregate: vi.fn().mockResolvedValue([]),
      run: vi.fn(),
      cancel: vi.fn(),
      onDone: () => () => {},
      onError: () => () => {},
      analyzeWindow,
    },
    compare: {
      getCached: vi.fn().mockResolvedValue(null),
      run: vi.fn(),
      cancel: vi.fn(),
      onDelta: () => () => {},
      onDone: () => () => {},
      onError: () => () => {},
    },
  };
  return analyzeWindow;
}

beforeEach(() => {
  installFixtureBridge();
});

describe("UncoveredHighlightsCard 点击链路(BACKLOG #13)", () => {
  it("AI 视图挂载即出现未覆盖亮点卡(真实 fixture:0–30s 与 80–90s 未被 mistakesAll 覆盖)", async () => {
    const { findByTestId } = render(
      <MatchReport source={m} matchId="uh-1" initialView="ai" />,
    );
    const btn = await findByTestId("uncovered-highlight-btn-0");
    expect(btn.textContent).toContain("AI 分析此段");
  });

  it("点击【AI 分析此段】=设窗 + 触发 #16 runWindowAi:analyzeWindow 收到该亮点的 fromS/toS,就地出结果卡(不用切战报 tab)", async () => {
    const analyzeWindow = installFixtureBridge(
      vi.fn().mockResolvedValue({
        status: "ok",
        entries: [{ title: null, text: "这段的可教信号是……", chips: [] }],
        fromCache: false,
      }),
    );
    const { findByTestId } = render(
      <MatchReport source={m} matchId="uh-2" initialView="ai" />,
    );
    const btn = await findByTestId("uncovered-highlight-btn-0");
    fireEvent.click(btn);

    await waitFor(() => expect(analyzeWindow).toHaveBeenCalledTimes(1));
    const call = analyzeWindow.mock.calls[0]![0];
    // btn-0 is the first highlight, 0–30 s since GH #96's 60 % coverage door
    // (see uncoveredHighlights.test.ts).
    expect(call.fromS).toBe(0);
    expect(call.toS).toBe(30);
    expect(call.matchId).toBe("uh-2");

    // The result card appears in place in the AI view (no need to switch to
    // the report tab).
    const card = await findByTestId("window-ai-card");
    expect(card.textContent).toContain("这段的可教信号是……");
  });

  it("零亮点(零噪音):UncoveredHighlightsCard 收到空数组时不渲染任何 DOM(干净局/已被充分覆盖的局不该看到空卡)", () => {
    const { container } = render(
      <UncoveredHighlightsCard highlights={[]} onAnalyze={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
