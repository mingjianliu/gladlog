// @vitest-environment jsdom
import { ensureAnalysisData } from "@gladlog/analysis";
import { render, screen } from "@testing-library/react";
import { beforeEach,describe, expect, it, test, vi } from "vitest";

import { ProComparisonVerified } from "./ProComparisonVerified";

const result = {
  verifiedComparison: {
    dims: [
      {
        key: "offensiveIndex",
        value: 0.31,
        p10: 0.2,
        p50: 0.49,
        p90: 0.7,
        percentile: 30,
        verdict: "bottom quartile of your cohort",
      },
    ],
    facts: {},
  },
  report: "You landed 0.31 offense.",
  droppedReason: null,
  cellMeta: {
    spec: "Discipline Priest",
    bracket: "3v3",
    archetype: "hybrid",
    buildGroup: "offensive",
    sampleN: 40,
    fellBackTo: "archetype×buildGroup",
  },
};

beforeEach(() => {
  (window as any).__gladlogFixture = {
    compare: {
      getCached: vi.fn().mockResolvedValue(result),
      run: vi.fn(),
      cancel: vi.fn(),
      onDelta: () => () => {},
      onDone: () => () => {},
      onError: () => () => {},
    },
  };
});

describe("ProComparisonVerified", () => {
  it("renders the cached verified report + per-dim comparison + cohort meta", async () => {
    render(
      <ProComparisonVerified
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    // jest-dom is not installed; getByText/findByText throw if absent, so a
    // truthy assertion on the returned element is a real presence check.
    expect(await screen.findByText(/You landed 0.31 offense/)).toBeTruthy();
    // Dimension keys are localized through metricLabels (zh by default)
    expect(screen.getAllByText(/进攻输出指数/).length).toBeGreaterThan(0);
    expect(screen.getByText(/offensive build/i)).toBeTruthy(); // build group in meta
  });

  it("P3-1:单维不渲染最强/最弱;zh 判定话术统一;样本 N 场;spec 中文", async () => {
    render(
      <ProComparisonVerified
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    const summary = await screen.findByTestId("cohort-summary");
    expect(summary.textContent).toContain("综合评分");
    expect(summary.textContent).not.toContain("最强");
    // A verdict outside the phrase table (bottom quartile) no longer leaks
    // through as English: it is derived deterministically from the percentile
    expect(screen.getByText("第 30 百分位 · 低于本分档中位")).toBeTruthy();
    expect(screen.queryByText(/bottom quartile/)).toBeNull();
    expect(screen.getByText(/样本 40 场/)).toBeTruthy();
    expect(screen.getByText(/戒律牧师/)).toBeTruthy();
  });
});

// User report, 2026-08-02: "the cohort panel sometimes doesn't show up". The
// cause is not a rendering error — when `result === null` this component renders
// **not a single visible node**, and with hideActions=true (the AI view's merged
// button mode) not even the action row, so the whole .rpt-ai-panel is an empty
// box and reads as "the section disappeared". A null result is the normal path
// on a real machine: 0 of the 809 matches in this library have a usable compare
// cache (the one file that exists is promptVersion=3 and long stale), and after
// a remount lastSignal is initialised to the current nonce so the auto re-run
// branch never fires — switch a tab and come back and it never returns unless
// you click "AI 分析" again.
// The empty state has to announce itself and offer a way out.
describe("空态(无缓存/未跑过对比)", () => {
  beforeEach(() => {
    (window as any).__gladlogFixture = {
      compare: {
        getCached: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue(undefined),
        cancel: vi.fn(),
        onDelta: () => () => {},
        onDone: () => () => {},
        onError: () => () => {},
      },
    };
  });

  it("hideActions 下无结果时仍渲染标题 + 说明 + 可点的对比按钮(不是空框)", async () => {
    render(
      <ProComparisonVerified
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
        hideActions
      />,
    );
    expect(await screen.findByText(/vs 同水平高手/)).toBeTruthy();
    expect(screen.getByTestId("cohort-empty")).toBeTruthy();
    // Escape hatch: merged-button mode still has to leave one button that can
    // trigger the comparison again
    expect(screen.getByRole("button", { name: /vs 高分群体/ })).toBeTruthy();
  });

  // Root-cause fix (the only candidate that survived adversarial verification):
  // while the AI tab is unmounted compare:done is dropped (IPC events are not
  // queued or replayed), and after a remount lastSignal already equals the
  // current nonce so nothing re-runs. On top of that, NO_COHORT and
  // compare:error are never written to compare.json at all — so switching a tab
  // and coming back left it blank for good. (2026-08-22 / GH #27:NO_COHORT 已
  // 改为落盘,compare:error 仍只在内存 —— 这条用例测的是「磁盘无缓存也行」,
  // 判据不变。) Main now keeps a pullable terminal
  // state and the renderer pulls getState on mount.
  it("切走再切回:getState 把卸载期丢掉的终态拉回来(磁盘无缓存也行)", async () => {
    (window as any).__gladlogFixture.compare.getState = vi
      .fn()
      .mockResolvedValue({ phase: "done", result });
    render(
      <ProComparisonVerified
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
        hideActions
      />,
    );
    expect(await screen.findByText(/You landed 0.31 offense/)).toBeTruthy();
    // getCached is always null here (0 of 809 local matches have a usable
    // cache); what rescues the panel is the in-memory terminal state
    expect(
      (window as any).__gladlogFixture.compare.getCached,
    ).not.toHaveBeenCalled();
  });

  it("getState 报 error:显示错误而不是空白", async () => {
    (window as any).__gladlogFixture.compare.getState = vi
      .fn()
      .mockResolvedValue({ phase: "error", message: "NO_CORPUS" });
    render(
      <ProComparisonVerified
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
        hideActions
      />,
    );
    expect(await screen.findByText(/NO_CORPUS/)).toBeTruthy();
  });

  it("桩缺 getState 面时回退 getCached(旧调用方/测试桩平滑降级)", async () => {
    (window as any).__gladlogFixture.compare.getCached = vi
      .fn()
      .mockResolvedValue(result);
    render(
      <ProComparisonVerified
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
        hideActions
      />,
    );
    expect(await screen.findByText(/You landed 0.31 offense/)).toBeTruthy();
  });

  it("有结果后 hideActions 才真正隐藏操作行(合并按钮的原意不被破坏)", async () => {
    (window as any).__gladlogFixture.compare.getCached = vi
      .fn()
      .mockResolvedValue(result);
    render(
      <ProComparisonVerified
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
        hideActions
      />,
    );
    await screen.findByText(/You landed 0.31 offense/);
    expect(screen.queryByRole("button", { name: /对比/ })).toBeNull();
    expect(screen.queryByTestId("cohort-empty")).toBeNull();
  });
});

test("对比解说富渲染:英文技能名出内联节点", async () => {
  await ensureAnalysisData(); // Once the 12MB table is loaded, englishNameIndex is available
  (window as any).__gladlogFixture = {
    compare: {
      getCached: vi.fn().mockResolvedValue({
        ...result,
        report: "You should use Tranquility earlier in the fight.",
      }),
      run: vi.fn(),
      cancel: vi.fn(),
      onDelta: () => () => {},
      onDone: () => () => {},
      onError: () => () => {},
    },
  };
  const { container } = render(
    <ProComparisonVerified
      source={{ units: {}, startInfo: {} } as any}
      matchId="m1"
    />,
  );
  await screen.findByText(/use/);
  expect(container.querySelector('[title="Tranquility"]')).not.toBeNull();
});
