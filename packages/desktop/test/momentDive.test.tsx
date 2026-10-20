// @vitest-environment jsdom
import { ensureAnalysisData, fmtTime } from "@gladlog/analysis";
import { fireEvent, render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import { ReplayView } from "../src/renderer/src/report/components/ReplayView";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const m = loadRealMatchFixture();

beforeAll(async () => {
  // Precondition contract for building the pack: prompt spell names must
  // never degrade (same as windowAnalysis.test.tsx / analysisInput.test.ts).
  await ensureAnalysisData();
});

function installFixtureBridge(analyzeWindow = vi.fn()) {
  (window as any).__gladlogFixture = {
    settings: {
      get: vi.fn().mockResolvedValue({ aiLanguage: "zh" }),
      save: vi.fn().mockResolvedValue({}),
    },
    analysis: {
      getState: vi.fn().mockResolvedValue({ cached: null, running: false }),
      getCached: vi.fn().mockResolvedValue(null),
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

describe("ReplayView「深挖此刻」按钮(SDD 2026-08-05 Task 6)", () => {
  it("按钮存在;点击按当前回放时钟(绝对 ms)换算的相对秒调用 onMomentDive", () => {
    const onMomentDive = vi.fn();
    const { getByTestId, container } = render(
      <ReplayView source={m} onMomentDive={onMomentDive} />,
    );
    const btn = getByTestId("moment-dive");
    expect(btn).toBeTruthy();

    // Drag the scrub bar to a known absolute-ms instant (37s into the match) —
    // the same input the replay clock itself uses (ReplayView's local `t`
    // state, never lifted, see the desktop-dev skill).
    const scrub =
      container.querySelector<HTMLInputElement>(".rpt-replay-scrub")!;
    const targetT = m.startTime + 37_000;
    fireEvent.change(scrub, { target: { value: String(targetT) } });
    fireEvent.click(btn);

    expect(onMomentDive).toHaveBeenCalledTimes(1);
    expect(onMomentDive.mock.calls[0]![0]).toBeCloseTo(37, 5);
  });

  it("未传 onMomentDive 时点击不抛(可选 prop,optional chaining)", () => {
    const { getByTestId } = render(<ReplayView source={m} />);
    expect(() => fireEvent.click(getByTestId("moment-dive"))).not.toThrow();
  });
});

describe("MatchReport「深挖此刻」接线(Task 6)", () => {
  it("回放里点「深挖此刻」→ 切到战报视图、窗口设为 [floor(t)-10, floor(t)+10]、触发 runWindowAi", async () => {
    const analyzeWindow = installFixtureBridge(vi.fn());
    const { getByTestId, container, findByTestId } = render(
      <MatchReport source={m} matchId="moment-1" initialView="replay" />,
    );
    expect(
      container.querySelector("[data-testid='rpt-replay-field']"),
    ).toBeTruthy();

    const scrub =
      container.querySelector<HTMLInputElement>(".rpt-replay-scrub")!;
    const targetT = m.startTime + 52_000; // 52s in — floor(52)-10=42, +10=62
    fireEvent.change(scrub, { target: { value: String(targetT) } });
    fireEvent.click(getByTestId("moment-dive"));

    // Switched to the report view: replay unmounts, the report toolbar (with
    // the manual "AI 分析此段" button) appears, driven by the same timeRange.
    expect(
      container.querySelector("[data-testid='rpt-replay-field']"),
    ).toBeNull();
    expect(getByTestId("window-ai-btn")).toBeTruthy();

    // runWindowAi ran with the computed ±10s window — the terminal-state card
    // (whichever phase it lands on) always titles itself with the range that
    // was actually requested (evidenceRange falls back to the caller's raw
    // range when the gate returns null, see MatchReport.tsx's runWindowAi).
    const card = await findByTestId("window-ai-card");
    expect(card.textContent).toContain(`${fmtTime(42)}–${fmtTime(62)}`);
    void analyzeWindow;
  });

});
