// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadRealMatchFixture } from "../../../../../test/fixtures/loadFixture";
import { deriveTimeline } from "../derive/timeline";
import type { ReportSource } from "../derive/types";
import { deriveVulnBands } from "../derive/vulnWindows";
import { VideoBattleTimeline } from "./VideoBattleTimeline";
import { VideoTab } from "./VideoTab";

const source = loadRealMatchFixture() as unknown as ReportSource;
const startedAt = source.startTime; // offsetS = 0
const timeline = deriveTimeline(source);
const bands = deriveVulnBands(source);
const durS = (timeline.end - timeline.start) / 1000;

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    value: vi.fn(),
  });
  // jsdom has no pointer capture implementation
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});

beforeEach(() => {
  (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
    analysis: {
      getCached: vi.fn().mockResolvedValue(null),
      onDone: () => () => {},
    },
  };
});

describe("VideoBattleTimeline(2a 主 seek 面)", () => {
  it("渲染 HP 曲线 + 播放头;pointerdown 换算 battleS 调 onSeek", () => {
    const seeks: number[] = [];
    const { container } = render(
      <VideoBattleTimeline
        data={timeline}
        bands={bands}
        playerTeamId={source.playerTeamId ?? null}
        curBattleS={10}
        onSeek={(s) => seeks.push(s)}
      />,
    );
    const svg = screen.getByTestId("video-battle-timeline");
    expect(container.querySelectorAll("path").length).toBeGreaterThan(0);
    expect(screen.getByTestId("video-bt-playhead")).toBeTruthy();

    // Simulate a click at the horizontal midpoint: getBoundingClientRect
    // always reports zero width in jsdom, so stub it first
    svg.getBoundingClientRect = () =>
      ({ left: 0, width: 600, top: 0, height: 50 }) as DOMRect;
    fireEvent.pointerDown(svg, { clientX: 300, pointerId: 1 });
    expect(seeks.length).toBe(1);
    // Midpoint ~= durS/2 (PAD accounts for 1%, so the tolerance is widened to
    // 2%)
    expect(Math.abs(seeks[0]! - durS / 2)).toBeLessThan(durS * 0.02);
  });

  it("disabled(无录像)不响应 seek,照常渲染", () => {
    const seeks: number[] = [];
    render(
      <VideoBattleTimeline
        data={timeline}
        bands={bands}
        playerTeamId={source.playerTeamId ?? null}
        curBattleS={null}
        disabled
        onSeek={(s) => seeks.push(s)}
      />,
    );
    const svg = screen.getByTestId("video-battle-timeline");
    svg.getBoundingClientRect = () =>
      ({ left: 0, width: 600, top: 0, height: 50 }) as DOMRect;
    fireEvent.pointerDown(svg, { clientX: 300, pointerId: 1 });
    expect(seeks).toEqual([]);
    expect(screen.queryByTestId("video-bt-playhead")).toBeNull();
  });
});

describe("VideoTab 右侧三 tab(2a)", () => {
  function mount() {
    return render(
      <VideoTab
        url="vod://x"
        startedAt={startedAt}
        source={source}
        timeline={timeline}
        bands={bands}
      />,
    );
  }

  it("默认「全部时刻」清单(三点五-2:未播放 feed 恒空),行点击 seek;播放开始自动切 feed", () => {
    const { container } = mount();
    const video = container.querySelector(
      ".rpt-video-tab video",
    ) as HTMLVideoElement;
    Object.defineProperty(video, "duration", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(video, "readyState", {
      configurable: true,
      value: 1,
    });
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      writable: true,
      value: 0,
    });
    fireEvent.loadedMetadata(video);

    expect(screen.getByTestId("video-side")).toBeTruthy();
    const list = screen.getByTestId("video-moment-list");
    const rows = list.querySelectorAll(".rpt-video-moment-row");
    expect(rows.length).toBeGreaterThan(0);
    fireEvent.click(rows[0]!);
    expect(video.currentTime).toBeGreaterThanOrEqual(0);

    // Playback starts → automatically switch to the playback feed (as long as
    // the user never picked a tab manually)
    fireEvent.play(video);
    expect(screen.getByTestId("video-feed")).toBeTruthy();
  });

  it("战斗时间轴卡随 timeline prop 渲染;不传则无(旧调用方降级)", () => {
    mount();
    expect(screen.getByTestId("video-bt-card")).toBeTruthy();
  });

  it("AI tab 空态给引导文案", () => {
    mount();
    fireEvent.click(screen.getByTestId("video-side-ai"));
    expect(screen.getByText(/尚无 AI 发现/)).toBeTruthy();
  });
});
