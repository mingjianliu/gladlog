// @vitest-environment jsdom
import { ensureAnalysisData } from "@gladlog/analysis";
import { cleanup, render, waitFor } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import {
  ReportShell,
  skeletonTeamSizes,
} from "../src/renderer/src/report/components/ReportSkeleton";
import { resetSourceMemoForTest } from "../src/renderer/src/report/derive/sourceMemo";
import type { ReportSource } from "../src/renderer/src/report/derive/types";
import { formatOpenTrace } from "../src/shared/openTrace";
import { parseDocBytes } from "../src/shared/parseDocBytes";
import { composeLazyDoc, parseLazyPayload } from "../src/shared/parseLazyDoc";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

// T93: a match opened from the list fills in steps, so the page shows the
// report's frame at once instead of nothing until every derive has run.

const fresh = (): ReportSource =>
  structuredClone(loadRealMatchFixture()) as unknown as ReportSource;

beforeAll(async () => {
  await ensureAnalysisData();
});
beforeEach(() => {
  resetSourceMemoForTest(true);
  (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
    settings: { get: vi.fn().mockResolvedValue({ aiLanguage: "zh" }) },
  };
});
afterEach(cleanup);

const root = (c: HTMLElement) => c.querySelector(".rpt-match") as HTMLElement;

describe("MatchReport staged fill", () => {
  it("首帧只有框架,逐步填完后与一次渲染的结果逐字节相同", async () => {
    const onePass = render(<MatchReport source={fresh()} matchId="m" />);
    expect(root(onePass.container).dataset["fill"]).toBe("done");
    const want = root(onePass.container).innerHTML;
    onePass.unmount();
    resetSourceMemoForTest(true);

    const staged = render(<MatchReport source={fresh()} matchId="m" staged />);
    const el = root(staged.container);
    expect(el.dataset["fill"]).toBe("0");
    expect(el.getAttribute("aria-busy")).toBe("true");
    expect(el.querySelector("[data-testid=rpt-body-skeleton]")).toBeTruthy();
    expect(el.querySelector("[data-testid=rpt-timeline]")).toBeNull();
    // the hero line is real from the first frame
    expect(el.querySelector("[data-testid=rpt-hero]")).toBeTruthy();

    const seen = new Set<string>();
    await waitFor(
      () => {
        seen.add(el.dataset["fill"]!);
        expect(el.dataset["fill"]).toBe("done");
      },
      { timeout: 20_000, interval: 1 },
    );
    expect(el.getAttribute("aria-busy")).toBeNull();
    expect(el.querySelector(".rpt-skel")).toBeNull();
    expect(el.innerHTML).toBe(want);
  });

  it("中间步骤:曲线和榜单先到,失误清单还是占位", async () => {
    const { container } = render(
      <MatchReport source={fresh()} matchId="m" staged />,
    );
    const el = root(container);
    await waitFor(() => expect(el.dataset["fill"]).toBe("1"), {
      timeout: 20_000,
      interval: 1,
    });
    expect(el.querySelector("[data-testid=rpt-timeline]")).toBeTruthy();
    expect(el.querySelector(".rpt-meters-card:not(.rpt-skel)")).toBeTruthy();
    expect(el.querySelector("[data-testid=engagement-panel]")).toBeNull();
    expect(el.querySelector("[data-testid=kpi-chips]")).toBeNull();
    expect(el.querySelector("[data-testid=mistakes-card]")).toBeNull();
    expect(el.querySelector(".rpt-fill-status")?.textContent).toBe("分析中…");
  });

  it("填过一次的对局再次挂载不再出现占位", async () => {
    const source = fresh();
    const first = render(<MatchReport source={source} matchId="m" staged />);
    await waitFor(
      () => expect(root(first.container).dataset["fill"]).toBe("done"),
      { timeout: 20_000, interval: 1 },
    );
    first.unmount();
    const again = render(<MatchReport source={source} matchId="m" staged />);
    expect(root(again.container).dataset["fill"]).toBe("done");
    expect(root(again.container).querySelector(".rpt-skel")).toBeNull();
  });
});

describe("ReportShell", () => {
  it("只用列表行的事实:结果、赛制、地图、时长、队伍人数", () => {
    const { container } = render(
      <ReportShell
        facts={{
          result: "Win",
          bracket: "3v3",
          zoneId: "1505",
          startTime: 1_000,
          endTime: 1_000 + 185_000,
        }}
        teamSizes={[3, 3]}
      />,
    );
    const el = container.querySelector("[data-testid=rpt-shell]")!;
    expect(el.getAttribute("data-fill")).toBe("shell");
    expect(el.querySelector(".rpt-head-result")?.textContent).toBe("胜利");
    expect(el.querySelector(".rpt-head-meta")?.textContent).toContain("3:05");
    expect(el.querySelectorAll(".rpt-meter-row")).toHaveLength(6);
    expect(el.querySelector(".rpt-fill-status")?.textContent).toBe("读取对局…");
    // tabs are drawn but not live yet
    expect(
      [...el.querySelectorAll(".rpt-view-tabs button")].every(
        (b) => (b as HTMLButtonElement).disabled,
      ),
    ).toBe(true);
  });

  it("回合时长未知时不编数字", () => {
    const { container } = render(
      <ReportShell
        facts={{
          result: "",
          bracket: "Rated Solo Shuffle",
          zoneId: "1505",
          startTime: 0,
          endTime: null,
        }}
        roundLabel="回合 2/6"
        teamSizes={[3, 3]}
      />,
    );
    const meta = container.querySelector(".rpt-head-meta")!.textContent!;
    expect(meta).toContain("回合 2/6");
    expect(meta).toContain("–:––");
    expect(meta).not.toMatch(/\d:\d\d/);
  });

  it("队伍人数:行里有阵容用阵容,否则读赛制,再否则 3v3", () => {
    expect(
      skeletonTeamSizes(
        [
          [1, 2],
          [3, 4],
        ],
        "3v3",
      ),
    ).toEqual([2, 2]);
    expect(skeletonTeamSizes(undefined, "2v2")).toEqual([2, 2]);
    expect(skeletonTeamSizes(undefined, "Rated Solo Shuffle")).toEqual([3, 3]);
    expect(skeletonTeamSizes([[], []], "3v3")).toEqual([3, 3]);
  });
});

describe("page-side parse of a match open", () => {
  const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

  it("整份字节:与 preload 的解析逐值相同", () => {
    const doc = {
      schemaVersion: 1,
      kind: "match",
      data: { id: "x", units: {} },
    };
    expect(parseLazyPayload({ mode: "full", bytes: enc(doc) })).toEqual(
      parseDocBytes(enc(doc)),
    );
  });

  it("按回合:与 composeLazyDoc 相同,拼不上返回 null", () => {
    const shell = {
      schemaVersion: 1,
      kind: "shuffle",
      data: { rounds: [null, null] },
    };
    const r0 = { id: "r0", units: {} };
    expect(
      parseLazyPayload({
        mode: "perRound",
        shell: enc(shell),
        round0: enc(r0),
        roundCount: 2,
      }),
    ).toEqual(composeLazyDoc(enc(shell), enc(r0), 2));
    expect(
      parseLazyPayload({
        mode: "perRound",
        shell: enc(shell),
        round0: enc(r0),
        roundCount: 3,
      }),
    ).toBeNull();
  });
});

describe("open trace log line", () => {
  it("一行 JSON,只有 id 和数字", () => {
    const line = formatOpenTrace(
      {
        id: "abc123",
        what: "match",
        at: { docArrived: 282.4, fill1Committed: 510.2 },
        dur: { parse: 177.3, "derive:deriveMistakes": 376.8 },
        longTasks: { n: 3, sumMs: 900.4, maxMs: 410.6 },
        io: { invokeMs: 63.2, parseMs: 0, handedAt: 100 },
      },
      { readMs: 12.6, bytes: 1234, mode: "full" },
    );
    expect(line.startsWith("[open] ")).toBe(true);
    expect(JSON.parse(line.slice(7))).toEqual({
      id: "abc123",
      what: "match",
      read: { ms: 13, bytes: 1234, mode: "full" },
      io: { invokeMs: 63, parseMs: 0 },
      at: { docArrived: 282, fill1Committed: 510 },
      dur: { parse: 177, "derive:deriveMistakes": 377 },
      longTasks: { n: 3, sumMs: 900, maxMs: 411 },
    });
  });
});
