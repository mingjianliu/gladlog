// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReplayView } from "../src/renderer/src/report/components/ReplayView";
import { FEED_OUT_MS } from "../src/renderer/src/report/components/VideoFeed";
import { VideoTab } from "../src/renderer/src/report/components/VideoTab";
import { MatchPageActiveContext } from "../src/renderer/src/report/pageActive";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

// The match page stays mounted, parked, while 「战绩」 / settings show
// (App.tsx). Parked, the replay must neither take that page's key presses nor
// keep playing (codex review of the parked page, 2026-11-14 #3).

afterEach(cleanup);
const playBtn = (c: HTMLElement) =>
  c.querySelector(".rpt-replay-play") as HTMLButtonElement;
const space = () =>
  act(() => {
    fireEvent.keyDown(window, { code: "Space", key: " " });
  });

describe("对局页停放时回放不抢键、不继续播", () => {
  it("在前台:空格开始播放", () => {
    const { container } = render(
      <ReplayView source={loadRealMatchFixture()} />,
    );
    expect(playBtn(container).textContent).toContain("播放");
    space();
    expect(playBtn(container).textContent).toContain("暂停");
  });

  it("停放时:空格不归回放;正在播的被停下", () => {
    const m = loadRealMatchFixture();
    const view = (active: boolean) => (
      <MatchPageActiveContext.Provider value={active}>
        <ReplayView source={m} />
      </MatchPageActiveContext.Provider>
    );
    const { container, rerender } = render(view(true));
    space();
    expect(playBtn(container).textContent).toContain("暂停");
    rerender(view(false));
    expect(playBtn(container).textContent).toContain("播放");
    space();
    expect(playBtn(container).textContent).toContain("播放");
  });
});

describe("对局页停放时录像页的 feed 心跳停下", () => {
  it("停放时不跑 400 ms 心跳(隐藏时量出的 0 高度不能去淘汰条目),回到前台再跑", () => {
    (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
      analysis: { getCached: async () => null, onDone: () => () => {} },
    };
    const m = loadRealMatchFixture();
    const spy = vi.spyOn(window, "setInterval");
    const beats = () =>
      spy.mock.calls.filter((c) => c[1] === FEED_OUT_MS).length;
    const view = (active: boolean) => (
      <MatchPageActiveContext.Provider value={active}>
        <VideoTab
          url="vod://x"
          startedAt={m.startTime}
          source={m}
          matchId="m1"
        />
      </MatchPageActiveContext.Provider>
    );
    try {
      const { rerender } = render(view(false));
      expect(beats()).toBe(0);
      rerender(view(true));
      expect(beats()).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});
