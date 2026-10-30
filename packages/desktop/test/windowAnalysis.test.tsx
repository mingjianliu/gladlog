// @vitest-environment jsdom
import { ensureAnalysisData } from "@gladlog/analysis";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import { WindowAnalysisCard } from "../src/renderer/src/report/components/WindowAnalysisCard";
import { buildWindowAnalysisRequest } from "../src/renderer/src/report/derive/analysisInput";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const m = loadRealMatchFixture();

beforeAll(async () => {
  // Precondition contract for building the pack: spell names in the prompt must
  // never degrade (same as analysisInput.test.ts).
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

beforeEach(() => {
  installFixtureBridge();
});

// 20–35s: a clean window measured not to pass the gates (both the survival and
// offense gates come up empty) — the 90s trimmed fixture has no player death but
// still carries teachable CC/defensive signals (e.g. a hard CC around 47–58s with
// the trinket unused), so not every window is null; 20–35s is one deterministically
// verified empty window (see the task-4 implementation notes).
// 20–35 s used to be clean; GH #34 ① (2026-08-29) corrected Power Infusion's
// buff duration 20 → 15 s, which moves the burst window it anchors, and a
// teammate's Hammer of Justice at 22.6 s now enters an offensive-kind pack
// inside 20–35. 25–40 and 30–45 are the clean 15 s windows on this fixture
// (probed over the whole match); 25–40 keeps the "no signal" contract.
const NO_SIGNAL_RANGE = { fromS: 25, toS: 40 };
// 45–60s: a window measured to pass the gates (a survival-class signal, see the
// task-4 scan notes) — the race and busy tests need analyzeWindow to actually be
// called, so NO_SIGNAL_RANGE cannot be used (when the gate fails, the function
// returns before sending IPC and never calls analyzeWindow).
const SIGNAL_RANGE = { fromS: 45, toS: 60 };

describe("buildWindowAnalysisRequest(#16 选段分析)", () => {
  it("真实 fixture 干净窗口(20–35s)→ null(门不过),不抛", () => {
    expect(() =>
      buildWindowAnalysisRequest(m, NO_SIGNAL_RANGE.fromS, NO_SIGNAL_RANGE.toS),
    ).not.toThrow();
    expect(
      buildWindowAnalysisRequest(m, NO_SIGNAL_RANGE.fromS, NO_SIGNAL_RANGE.toS),
    ).toBeNull();
  });
});

describe("MatchReport【AI 分析此段】按钮", () => {
  it("无 timeRange → 无按钮;有 initialTimeRange → 按钮出现", () => {
    const noRange = render(<MatchReport source={m} matchId="m1" />);
    expect(noRange.queryByTestId("window-ai-btn")).toBeNull();

    const withRange = render(
      <MatchReport
        source={m}
        matchId="m2"
        initialTimeRange={{ fromS: 36, toS: 59 }}
      />,
    );
    expect(withRange.queryByTestId("window-ai-btn")).toBeTruthy();
  });

  it("点击按钮(fixture 门不过)→ 出「未检出可教信号」卡,不调用 analyzeWindow", async () => {
    const analyzeWindow = installFixtureBridge();
    const { getByTestId, findByTestId } = render(
      <MatchReport
        source={m}
        matchId="m3"
        initialTimeRange={NO_SIGNAL_RANGE}
      />,
    );
    fireEvent.click(getByTestId("window-ai-btn"));
    const card = await findByTestId("window-ai-card");
    expect(card.textContent).toContain("未检出可教信号");
    expect(analyzeWindow).not.toHaveBeenCalled();
  });

  it("窗口 onChange(TimeRangeBar 清除)→ 卡收起", async () => {
    const { getByTestId, findByTestId, queryByTestId, getByRole } = render(
      <MatchReport
        source={m}
        matchId="m4"
        initialTimeRange={NO_SIGNAL_RANGE}
      />,
    );
    fireEvent.click(getByTestId("window-ai-btn"));
    await findByTestId("window-ai-card");
    fireEvent.click(getByRole("button", { name: "清除" }));
    expect(queryByTestId("window-ai-card")).toBeNull();
  });

  it("stale 响应不复活已收起的卡(fix round 1):在飞请求结果落地前用户清了窗口", async () => {
    let resolveAnalyze!: (r: {
      status: "ok";
      entries: Array<{ title: string | null; text: string; chips: never[] }>;
      fromCache: boolean;
    }) => void;
    const analyzeWindow = installFixtureBridge(
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveAnalyze = resolve;
          }),
      ),
    );
    const { getByTestId, queryByTestId, getByRole } = render(
      <MatchReport source={m} matchId="m5" initialTimeRange={SIGNAL_RANGE} />,
    );

    fireEvent.click(getByTestId("window-ai-btn"));
    // Only create the race once analyzeWindow has actually been called (proving
    // the gate passed and we are in the "in flight" phase) — that is the only
    // moment a stale response can occur.
    await waitFor(() => expect(analyzeWindow).toHaveBeenCalledTimes(1));
    expect(queryByTestId("window-ai-card")).toBeTruthy(); // the loading card is still there

    // The user clears the window before the result lands: the TimeRangeBar clear
    // button → the card-dismissal effect fires.
    fireEvent.click(getByRole("button", { name: "清除" }));
    expect(queryByTestId("window-ai-card")).toBeNull();

    // The earlier call only resolves now — it must not resurrect the dismissed card.
    await act(async () => {
      resolveAnalyze({
        status: "ok",
        entries: [{ title: null, text: "过期结果(不应显示)", chips: [] }],
        fromCache: false,
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(queryByTestId("window-ai-card")).toBeNull();
  });

  // Retest-prep 2026-08-05 (user call I-1): "AI 分析此段" (drag-select) no
  // longer forces snapshot — it follows the deepDiveSnapshot setting, read at
  // click time. Only the moment-dive button (momentDive.test.tsx) stays fixed
  // dense.

  it("ok→result(全分支审查补测):有信号窗口,analyzeWindow resolve ok → 结果卡出现、文本渲染、缓存徽标在", async () => {
    const analyzeWindow = installFixtureBridge(
      vi.fn().mockResolvedValue({
        status: "ok",
        entries: [{ title: null, text: "这段的可教信号是……", chips: [] }],
        fromCache: true,
      }),
    );
    const { getByTestId, findByTestId } = render(
      <MatchReport source={m} matchId="m7" initialTimeRange={SIGNAL_RANGE} />,
    );
    fireEvent.click(getByTestId("window-ai-btn"));
    await waitFor(() => expect(analyzeWindow).toHaveBeenCalledTimes(1));
    const card = await findByTestId("window-ai-card");
    expect(card.textContent).toContain("这段的可教信号是……");
    expect(card.textContent).toContain("(缓存)");
  });

  it("matchId 变化后到达的响应被丢弃(fix:审计 Critical——ShuffleReport 若无 key 复用同一实例换局,飞行响应只比 fromS/toS 会把上一局结果落到新局页面;此测直接压 isCurrent() 守卫,不依赖 ShuffleReport 是否加了 key)", async () => {
    let resolveAnalyze!: (r: {
      status: "ok";
      entries: Array<{ title: string | null; text: string; chips: never[] }>;
      fromCache: boolean;
    }) => void;
    const analyzeWindow = installFixtureBridge(
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveAnalyze = resolve;
          }),
      ),
    );
    const { getByTestId, queryByTestId, findByTestId, rerender } = render(
      <MatchReport
        source={m}
        matchId="round-A"
        initialTimeRange={SIGNAL_RANGE}
      />,
    );

    fireEvent.click(getByTestId("window-ai-btn"));
    await waitFor(() => expect(analyzeWindow).toHaveBeenCalledTimes(1));
    await findByTestId("window-ai-card"); // the loading card has appeared

    // The same component instance is switched to another match (matchId changed,
    // fromS/toS unchanged) — simulating a caller that passes no key.
    rerender(
      <MatchReport
        source={m}
        matchId="round-B"
        initialTimeRange={SIGNAL_RANGE}
      />,
    );

    // round-A's request only resolves now — its result must not land on round-B's page.
    await act(async () => {
      resolveAnalyze({
        status: "ok",
        entries: [
          { title: null, text: "round-A 的结果不该出现在 round-B", chips: [] },
        ],
        fromCache: false,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    const card = queryByTestId("window-ai-card");
    expect(card?.textContent ?? "").not.toContain(
      "round-A 的结果不该出现在 round-B",
    );
  });

  it("busy 终态(fix round 1):可重试,不再原地空转 loading", async () => {
    const analyzeWindow = installFixtureBridge(
      vi.fn().mockResolvedValue({ status: "busy" }),
    );
    const { getByTestId, findByTestId } = render(
      <MatchReport source={m} matchId="m6" initialTimeRange={SIGNAL_RANGE} />,
    );
    fireEvent.click(getByTestId("window-ai-btn"));
    await waitFor(() => expect(analyzeWindow).toHaveBeenCalledTimes(1));
    const card = await findByTestId("window-ai-card");
    expect(card.textContent).toContain("仍在进行中");
    expect(card.querySelector("button")).toBeTruthy(); // the retry button
  });

  it("#21 item11 复核轮修复(红→绿):audit-empty 的重试按钮传 force=true(否则 main 侧的空终态缓存会吞掉重试,永远拿不到新答案)", async () => {
    const analyzeWindow = installFixtureBridge(
      vi
        .fn()
        .mockResolvedValueOnce({ status: "audit-empty" })
        .mockResolvedValueOnce({
          status: "ok",
          entries: [{ title: null, text: "重试后的结果", chips: [] }],
          fromCache: false,
        }),
    );
    const { getByTestId, findByTestId, getByRole } = render(
      <MatchReport
        source={m}
        matchId="m-force"
        initialTimeRange={SIGNAL_RANGE}
      />,
    );
    fireEvent.click(getByTestId("window-ai-btn"));
    await waitFor(() => expect(analyzeWindow).toHaveBeenCalledTimes(1));
    await findByTestId("window-ai-card");
    // The first click (not a retry) must not carry force — that is "a window was
    // selected", not an explicit retry.
    expect(analyzeWindow.mock.calls[0]?.[0]?.force).toBeFalsy();

    fireEvent.click(getByRole("button", { name: "重试" }));
    await waitFor(() => expect(analyzeWindow).toHaveBeenCalledTimes(2));
    // Before the fix (red): the second call's force is undefined — identical to
    // the first call, so the main side hits the honest empty-terminal-state cache,
    // swallows the retry outright, and the model is never reached.
    // After the fix (green): a retry from audit-empty explicitly passes force: true.
    expect(analyzeWindow.mock.calls[1]?.[0]?.force).toBe(true);
    const card = await findByTestId("window-ai-card");
    expect(card.textContent).toContain("重试后的结果");
  });

  it("error 态的重试不传 force=true(该状态从未落盘缓存,不需要绕开)", async () => {
    const analyzeWindow = installFixtureBridge(
      vi.fn().mockResolvedValue({ status: "error" }),
    );
    const { getByTestId, findByTestId, getByRole } = render(
      <MatchReport
        source={m}
        matchId="m-force-err"
        initialTimeRange={SIGNAL_RANGE}
      />,
    );
    fireEvent.click(getByTestId("window-ai-btn"));
    await waitFor(() => expect(analyzeWindow).toHaveBeenCalledTimes(1));
    await findByTestId("window-ai-card");
    fireEvent.click(getByRole("button", { name: "重试" }));
    await waitFor(() => expect(analyzeWindow).toHaveBeenCalledTimes(2));
    expect(analyzeWindow.mock.calls[1]?.[0]?.force).toBeFalsy();
  });
});

describe("WindowAnalysisCard 单测", () => {
  it("result 态:单条 text 经 rich 注入渲染,chips 点击调 onJumpT", () => {
    const onJumpT = vi.fn();
    const rich = (t?: string | null) => (t ? `RICH(${t})` : null);
    const { getByText, getByTitle } = render(
      <WindowAnalysisCard
        state={{
          phase: "result",
          entries: [
            {
              title: null,
              text: "示例正文",
              chips: [
                {
                  t: 12,
                  label: "冰霜新星",
                  unitNames: ["法师-测试"],
                  spellId: "122",
                },
              ],
            },
          ],
          fromCache: true,
        }}
        range={{ fromS: 0, toS: 20 }}
        rich={rich}
        onJumpT={onJumpT}
        onRetry={() => {}}
      />,
    );
    expect(getByText("RICH(示例正文)")).toBeTruthy();
    fireEvent.click(getByTitle("冰霜新星"));
    expect(onJumpT).toHaveBeenCalledWith(12, ["法师-测试"]);
  });

  // window-multi-finding Task 2: up to 4 entries may now share one "result"
  // state, each independently audited — see auditDeepDives' `mode: "window"`.
  it("result 态:2 条 entries 各自渲染 title/text/chips", () => {
    const rich = (t?: string | null) => (t ? `RICH(${t})` : null);
    const { getByText, getByTitle } = render(
      <WindowAnalysisCard
        state={{
          phase: "result",
          entries: [
            {
              title: "控制窗口",
              text: "第一条正文",
              chips: [{ t: 12, label: "冰霜新星", unitNames: ["法师-测试"] }],
            },
            {
              title: "二次判断",
              text: "第二条正文",
              chips: [{ t: 20, label: "圣佑术", unitNames: ["圣骑-测试"] }],
            },
          ],
          fromCache: false,
        }}
        range={{ fromS: 0, toS: 20 }}
        rich={rich}
        onJumpT={() => {}}
        onRetry={() => {}}
      />,
    );
    expect(getByText("控制窗口")).toBeTruthy();
    expect(getByText("二次判断")).toBeTruthy();
    expect(getByText("RICH(第一条正文)")).toBeTruthy();
    expect(getByText("RICH(第二条正文)")).toBeTruthy();
    expect(getByTitle("冰霜新星")).toBeTruthy();
    expect(getByTitle("圣佑术")).toBeTruthy();
  });

  it("result 态:entry 无 title(null)时不渲染标题行", () => {
    const rich = (t?: string | null) => (t ? `RICH(${t})` : null);
    const { container, queryByText } = render(
      <WindowAnalysisCard
        state={{
          phase: "result",
          entries: [{ title: null, text: "无标题的正文", chips: [] }],
          fromCache: false,
        }}
        range={{ fromS: 0, toS: 20 }}
        rich={rich}
        onJumpT={() => {}}
        onRetry={() => {}}
      />,
    );
    expect(queryByText("RICH(无标题的正文)")).toBeTruthy();
    // No heading-tag element rendered for the title-less entry.
    expect(container.querySelector(".rpt-finding-deep-tag")).toBeNull();
  });

  it("audit-empty 态:重试按钮调 onRetry", () => {
    const onRetry = vi.fn();
    const { getByRole } = render(
      <WindowAnalysisCard
        state={{ phase: "audit-empty" }}
        range={{ fromS: 0, toS: 20 }}
        rich={(t) => t ?? null}
        onJumpT={() => {}}
        onRetry={onRetry}
      />,
    );
    fireEvent.click(getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("busy 态(fix round 1):文案可重试,重试按钮调 onRetry", () => {
    const onRetry = vi.fn();
    const { getByText, getByRole } = render(
      <WindowAnalysisCard
        state={{ phase: "busy" }}
        range={{ fromS: 0, toS: 20 }}
        rich={(t) => t ?? null}
        onJumpT={() => {}}
        onRetry={onRetry}
      />,
    );
    expect(getByText(/仍在进行中/)).toBeTruthy();
    fireEvent.click(getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
