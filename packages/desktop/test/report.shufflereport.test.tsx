// @vitest-environment jsdom
import { ensureAnalysisData } from "@gladlog/analysis";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ShuffleReport } from "../src/renderer/src/report/components/ShuffleReport";
import type { StoredShuffle } from "../src/renderer/src/report/derive/types";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const m = loadRealMatchFixture();

beforeAll(async () => {
  // Build-time contract: spell names in the prompt must never degrade (same as
  // windowAnalysis.test.tsx).
  await ensureAnalysisData();
});

function installFixtureBridge(recorder?: {
  getForMatch: ReturnType<typeof vi.fn>;
}) {
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
      // Left pending on purpose: this file only tests whether UI state is
      // reset or preserved across a round switch, not the response race (that
      // is covered by the matchId guard test in windowAnalysis.test.tsx).
      analyzeWindow: vi.fn(() => new Promise(() => {})),
    },
    compare: {
      getCached: vi.fn().mockResolvedValue(null),
      run: vi.fn(),
      cancel: vi.fn(),
      onDelta: () => () => {},
      onDone: () => () => {},
      onError: () => () => {},
    },
    recorder,
  };
}

beforeEach(() => {
  installFixtureBridge();
});

/** A two-round Solo Shuffle whose content is cloned from the same real match
 * (event timestamps are not shifted, so rendering stays stable) but with
 * distinct ids — in reality each shuffle round's matchId is a hash of that
 * round's content and can never collide (see the comment in ShuffleReport.tsx).
 * The older loadFixture.buildSyntheticShuffle did not distinguish the ids, so
 * this fixture is built separately to cover the "reset on match change"
 * defence. */
function buildTwoRoundShuffle(): StoredShuffle {
  const round0 = {
    ...m,
    kind: "shuffleRound" as const,
    id: `${m.id}-r0`,
    sequenceNumber: 0,
    winningTeamId: 0,
  };
  const round1 = {
    ...m,
    kind: "shuffleRound" as const,
    id: `${m.id}-r1`,
    sequenceNumber: 1,
    winningTeamId: 1,
  };
  return {
    kind: "shuffle",
    rounds: [round0, round1],
    startTime: m.startTime,
    endTime: m.endTime,
    result: m.result,
  };
}

describe("ShuffleReport 换回合(fix:审计 Critical——round-switch 渲染混窗)", () => {
  it("切换回合会清掉上一轮的时间窗/选段 AI 状态(不靠整组件重挂载)", async () => {
    const shuffle = buildTwoRoundShuffle();
    render(<ShuffleReport shuffle={shuffle} />);

    // Round 1: pick a window from the phase dropdown, then click "analyze this
    // window with AI" → the loading card appears.
    const select = screen
      .getByTestId("time-range-bar")
      .querySelector("select")!;
    fireEvent.change(select, { target: { value: "0" } });
    expect(screen.getByTestId("time-range-chip")).toBeTruthy();
    fireEvent.click(screen.getByTestId("window-ai-btn"));
    expect(await screen.findByTestId("window-ai-card")).toBeTruthy();

    // Switch to Round 2 (the second tab).
    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBe(2);
    fireEvent.click(tabs[1]!);

    // MatchReport clears timeRange/winAi on its own whenever matchId changes —
    // neither must survive into the Round 2 page. (Reverting that cleanup
    // effect makes this assertion fail.)
    expect(screen.queryByTestId("time-range-chip")).toBeNull();
    expect(screen.queryByTestId("window-ai-card")).toBeNull();
  });

  it("切换回合不重挂载 MatchReport:当前视图 tab 与共享录像 <video> 原样保留", async () => {
    const shuffle = buildTwoRoundShuffle();
    const getForMatch = vi.fn().mockResolvedValue({
      url: "vod://shared-lobby-recording",
      startedAt: m.startTime,
      stoppedAt: m.endTime,
    });
    installFixtureBridge({ getForMatch });

    render(<ShuffleReport shuffle={shuffle} videoMatchId="lobby-id" />);

    // All 6 rounds share one lobby recording: both rounds must query the same
    // videoMatchId, not their own round.id — an existing convention, checked
    // here in passing to confirm this change did not break it.
    await screen.findByText("录像");
    expect(getForMatch).toHaveBeenCalledWith("lobby-id");

    fireEvent.click(screen.getByText("录像"));
    // The .rpt-video-tab video selector follows the precedent in
    // MatchReport.initialView.test.tsx.
    await vi.waitFor(() =>
      expect(document.querySelector(".rpt-video-tab video")).toBeTruthy(),
    );
    const videoEl = document.querySelector(".rpt-video-tab video");

    // Switch to Round 2.
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[1]!);

    // (a) The view did not jump back to the default report — the recording tab
    // is still active.
    const videoTabBtn = screen.getByText("录像").closest("button")!;
    expect(videoTabBtn.className).toContain("active");

    // (b) The <video> is the very same DOM node (reference equality) — the
    // component was not unmounted and remounted; videoMatchId is unchanged and
    // the existing offsetS effect merely re-seeks, so the whole clip must not
    // reload or flicker. If ShuffleReport ever brings back key={round.id},
    // querySelector returns a brand-new node and this !== check fails.
    const videoElAfter = document.querySelector(".rpt-video-tab video");
    expect(videoElAfter).toBe(videoEl);
  });
});
