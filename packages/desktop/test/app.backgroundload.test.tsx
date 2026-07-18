// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";

import type { StoredMatchMeta } from "../src/main/matchStore";
import App from "../src/renderer/src/App";
import { StatsDashboard } from "../src/renderer/src/components/StatsDashboard";

const NOW = Date.now();
const H = 3600_000;

const meta = (i: number, over?: Partial<StoredMatchMeta>): StoredMatchMeta => ({
  id: `m${i}`,
  kind: "match",
  bracket: "3v3",
  zoneId: "1505",
  startTime: NOW - i * H,
  endTime: NOW - i * H + 300_000,
  result: "win",
  storedAt: 1,
  durationS: 300,
  // 各场评分错开:RatingCurve 以 [min,max] 作网格线 key,全同值会撞 key 告警
  avgRating: 2300 + i,
  playerRating: 2300 + i,
  teams: [[{ specId: 105, classId: 11 }], [{ specId: 64, classId: 8 }]],
  ...over,
});

describe("后台补载(backlog #12)", () => {
  it("App:首屏一页后自动逐页拉满索引,无需滚动;补完隐藏「加载更早…」", async () => {
    const all = Array.from({ length: 250 }, (_, i) => meta(i));
    const pageCalls: unknown[] = [];
    (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
      matches: {
        page: async (opts: { before?: number; limit: number }) => {
          pageCalls.push(opts);
          const before = opts.before ?? Infinity;
          return all.filter((m) => m.startTime < before).slice(0, opts.limit);
        },
        get: async () => null,
        list: async () => all,
      },
      logs: { onMatchStored: () => () => {} },
      settings: { get: async () => ({ wowDirectory: null }) },
    };
    render(<App />);
    const list = await screen.findByTestId("match-list");
    await waitFor(
      () => {
        expect(list.querySelectorAll("li:not(.loading-more)").length).toBe(250);
      },
      { timeout: 4000 },
    );
    expect(list.querySelector(".loading-more")).toBeNull();
    // 首屏 1 页 + 后台 2 页(100+100+50)
    expect(pageCalls.length).toBe(3);
  });

  it("StatsDashboard:matchStored 后防抖重取,场次随入库更新", async () => {
    const arr = [meta(1), meta(2)];
    let storedCb: ((m: StoredMatchMeta) => void) | null = null;
    (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
      matches: { list: async () => [...arr] },
      logs: {
        onMatchStored: (cb: (m: StoredMatchMeta) => void) => {
          storedCb = cb;
          return () => {};
        },
      },
    };
    render(<StatsDashboard />);
    await screen.findByText("场次");
    await waitFor(() => {
      expect(screen.getByText("2")).toBeTruthy();
    });
    const extra = meta(3);
    arr.push(extra);
    act(() => storedCb!(extra));
    await waitFor(
      () => {
        expect(screen.getByText("3")).toBeTruthy();
      },
      { timeout: 2000 },
    );
  });
});
