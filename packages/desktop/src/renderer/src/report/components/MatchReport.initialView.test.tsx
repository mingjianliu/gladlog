// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import fixture from "../../../../../test/fixtures/report-match.json";
import type { ReportSource } from "../derive/types";
import { MatchReport } from "./MatchReport";

const source = fixture as unknown as ReportSource;

beforeEach(() => {
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
});

describe("MatchReport initialView", () => {
  it("默认打开战报视图", () => {
    const { container } = render(<MatchReport source={source} matchId="m1" />);
    const tab = Array.from(
      container.querySelectorAll(".rpt-view-tabs button"),
    ).find((b) => b.textContent === "战报");
    expect(tab).toBeTruthy();
    expect(tab!.className.split(" ")).toContain("active");
  });

  it("initialView=replay 直接打开回放视图", () => {
    const { container } = render(
      <MatchReport source={source} matchId="m1" initialView="replay" />,
    );
    const replayTab = Array.from(
      container.querySelectorAll(".rpt-view-tabs button"),
    ).find((b) => b.textContent === "回放");
    const reportTab = Array.from(
      container.querySelectorAll(".rpt-view-tabs button"),
    ).find((b) => b.textContent === "战报");
    expect(replayTab).toBeTruthy();
    expect(replayTab!.className.split(" ")).toContain("active");
    expect(reportTab).toBeTruthy();
    expect(reportTab!.className.split(" ")).not.toContain("active");
  });

  it("回放视图的录像查询用 videoMatchId(shuffle 各轮共享 lobby 录像)", async () => {
    const getForMatch = vi.fn().mockResolvedValue(null);
    (window as any).__gladlogFixture.recorder = { getForMatch };
    render(
      <MatchReport
        source={source}
        matchId="round-2-id"
        videoMatchId="lobby-id"
        initialView="replay"
      />,
    );
    await vi.waitFor(() =>
      expect(getForMatch).toHaveBeenCalledWith("lobby-id"),
    );
  });

  it("无 videoMatchId 时录像查询回退 matchId(普通对局)", async () => {
    const getForMatch = vi.fn().mockResolvedValue(null);
    (window as any).__gladlogFixture.recorder = { getForMatch };
    render(<MatchReport source={source} matchId="m1" initialView="replay" />);
    await vi.waitFor(() => expect(getForMatch).toHaveBeenCalledWith("m1"));
  });

  it("有关联录像 → 出现「录像」tab,点开是全宽播放器", async () => {
    const getForMatch = vi.fn().mockResolvedValue({
      url: "vod://v/dG9rZW4",
      startedAt: 1,
      stoppedAt: 2,
    });
    (window as any).__gladlogFixture.recorder = { getForMatch };
    const { container, findByText } = render(
      <MatchReport source={source} matchId="m1" />,
    );
    const tab = await findByText("录像");
    tab.click();
    await vi.waitFor(() =>
      expect(container.querySelector(".rpt-video-tab video")).toBeTruthy(),
    );
  });

  it("无关联录像 → 不显示「录像」tab", async () => {
    const getForMatch = vi.fn().mockResolvedValue(null);
    (window as any).__gladlogFixture.recorder = { getForMatch };
    const { container } = render(<MatchReport source={source} matchId="m1" />);
    await vi.waitFor(() => expect(getForMatch).toHaveBeenCalled());
    const labels = Array.from(
      container.querySelectorAll(".rpt-view-tabs button"),
    ).map((b) => b.textContent);
    expect(labels).not.toContain("录像");
  });

  it("initialView=ai 直接打开 AI 视图", () => {
    const { container } = render(
      <MatchReport source={source} matchId="m1" initialView="ai" />,
    );
    const aiTab = Array.from(
      container.querySelectorAll(".rpt-view-tabs button"),
    ).find((b) => b.textContent === "AI 分析");
    expect(aiTab).toBeTruthy();
    expect(aiTab!.className.split(" ")).toContain("active");
  });
});
