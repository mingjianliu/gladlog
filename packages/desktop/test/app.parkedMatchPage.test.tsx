// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { StoredMatchMeta } from "../src/main/matchStore";
import App from "../src/renderer/src/App";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const NOW = Date.now();
const H = 3600_000;

const meta = (i: number): StoredMatchMeta => ({
  id: `m${i}`,
  kind: "match",
  bracket: "3v3",
  zoneId: "1505",
  startTime: NOW - i * H,
  endTime: NOW - i * H + 300_000,
  result: "win",
  storedAt: 1,
  durationS: 300,
  avgRating: 2300 + i,
  playerRating: 2300 + i,
  teams: [[{ specId: 105, classId: 11 }], [{ specId: 64, classId: 8 }]],
});

// Windows field run 2026-11-14: coming back to 「对局」 from another top tab
// took 530-640 ms, because the match page had been unmounted and rebuilt its
// whole list (1,978 rows) and the open report.
describe("对局页切走后停放,不卸载", () => {
  it("切到战绩再切回:列表还是同一批 DOM 节点;停放时容器不带 .app-layout", async () => {
    const all = Array.from({ length: 30 }, (_, i) => meta(i));
    (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
      matches: {
        page: async (opts: { before?: number; limit: number }) => {
          const before = opts.before ?? Infinity;
          return all.filter((m) => m.startTime < before).slice(0, opts.limit);
        },
        get: async () => null,
        list: async () => all,
      },
      logs: { onMatchStored: () => () => {} },
      settings: { get: async () => ({ wowDirectory: null }) },
    };
    const { container } = render(<App />);
    const list = await screen.findByTestId("match-list");
    const firstRow = list.querySelector("li:not(.mlr-group)");
    expect(firstRow).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "战绩" }));
    // parked, not removed; and not an .app-layout, or the container's
    // `:has(.app-layout)` flex rule would narrow the stats page
    expect(screen.getByTestId("match-list")).toBe(list);
    expect(container.querySelector(".app-layout")).toBeNull();
    expect(container.querySelector(".app-layout-parked")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "对局" }));
    expect(screen.getByTestId("match-list")).toBe(list);
    expect(list.querySelector("li:not(.mlr-group)")).toBe(firstRow);
    expect(container.querySelector(".app-layout")).toBeTruthy();
  });

  it("从设置回来报告重挂(读新设置),列表不动;从战绩回来报告也不动", async () => {
    const all = Array.from({ length: 3 }, (_, i) => meta(i));
    const data = loadRealMatchFixture();
    (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
      matches: {
        page: async (opts: { before?: number; limit: number }) => {
          const before = opts.before ?? Infinity;
          return all.filter((m) => m.startTime < before).slice(0, opts.limit);
        },
        get: async () => ({ kind: "match", data }),
        list: async () => all,
      },
      logs: { onMatchStored: () => () => {} },
      settings: {
        get: async () => ({ wowDirectory: null, aiLanguage: "zh" }),
      },
    };
    const { container } = render(<App />);
    const list = await screen.findByTestId("match-list");
    fireEvent.click(list.querySelector("li:not(.mlr-group)")!);
    await waitFor(() =>
      expect(container.querySelector(".rpt-match")).toBeTruthy(),
    );
    const report = container.querySelector(".rpt-match");
    // a replay left playing stops while the page is parked
    fireEvent.click(screen.getByRole("button", { name: "回放" }));
    const play = () =>
      container.querySelector(".rpt-replay-play") as HTMLButtonElement;
    fireEvent.click(play());
    expect(play().textContent).toContain("暂停");

    fireEvent.click(screen.getByRole("button", { name: "战绩" }));
    expect(play().textContent).toContain("播放");
    fireEvent.click(screen.getByRole("button", { name: "对局" }));
    expect(container.querySelector(".rpt-match")).toBe(report);

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    fireEvent.click(screen.getByRole("button", { name: "对局" }));
    await waitFor(() =>
      expect(container.querySelector(".rpt-match")).toBeTruthy(),
    );
    expect(container.querySelector(".rpt-match")).not.toBe(report);
    expect(screen.getByTestId("match-list")).toBe(list);
  });
});
