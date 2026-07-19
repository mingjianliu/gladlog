// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { StructuredAnalysisPanel } from "./StructuredAnalysisPanel";

const result = {
  findings: [
    {
      eventIds: ["e1"],
      severity: "high",
      category: "survival",
      title: "Death",
      explanation: "You died at 30s.",
    },
  ],
  dropped: 0,
  hadNarration: true,
};

beforeEach(() => {
  (window as any).__gladlogFixture = {
    settings: {
      get: vi.fn().mockResolvedValue({ aiLanguage: "zh" }),
      save: vi.fn().mockResolvedValue({}),
    },
    analysis: {
      // 面板重挂走 getState(缓存 + running 一次原子读出);getCached 仍保留在
      // 桩上,语言切换用例断言的是「重查缓存」这件事本身。
      getState: vi.fn().mockResolvedValue({ cached: result, running: false }),
      getCached: vi.fn().mockResolvedValue(result),
      run: vi.fn(),
      cancel: vi.fn(),
      onDone: () => () => {},
      onError: () => () => {},
    },
  };
});

describe("StructuredAnalysisPanel", () => {
  it("renders cached findings", async () => {
    render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    expect(await screen.findByText(/You died at 30s/)).toBeTruthy();
  });

  it("语言切换:点 EN 持久化 aiLanguage 并重查缓存(backlog #1)", async () => {
    render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    await screen.findByText(/You died at 30s/);
    const fx = (window as any).__gladlogFixture;
    const callsBefore = fx.analysis.getState.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    await screen.findByText(/You died at 30s/); // 重查后重新渲染
    expect(fx.settings.save).toHaveBeenCalledWith({ aiLanguage: "en" });
    expect(fx.analysis.getState.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});

describe("本场目标(D3 教练闭环)", () => {
  it("aggregate 有「还在犯」分类时渲染目标卡,按 recurring 降序取 top", async () => {
    const fx = (window as any).__gladlogFixture;
    fx.analysis.aggregate = vi.fn().mockResolvedValue([
      {
        category: "survival",
        count: 5,
        recurring: 2,
        done: 1,
        recent: [
          { matchId: "x", title: "开怕晚了", severity: "high", createdAt: 2 },
        ],
      },
      { category: "positioning", count: 3, recurring: 0, done: 3, recent: [] },
      {
        category: "cd",
        count: 4,
        recurring: 4,
        done: 0,
        recent: [
          {
            matchId: "y",
            title: "壁垒全场没按",
            severity: "med",
            createdAt: 1,
          },
        ],
      },
    ]);
    render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    const card = await screen.findByTestId("ai-goals");
    expect(card.textContent).toContain("↻4 cd");
    expect(card.textContent).toContain("↻2 survival");
    expect(card.textContent).toContain("壁垒全场没按");
    // recurring=0 的分类不出现
    expect(card.textContent).not.toContain("positioning");
  });

  it("桩无 aggregate 面时不渲染、不崩(旧行为兼容)", async () => {
    render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    await screen.findByText(/You died at 30s/);
    expect(screen.queryByTestId("ai-goals")).toBeNull();
  });
});

describe("getFlags 竞态守卫(周度复核 新#2)", () => {
  it("快速切场时,先发后到的旧场 flags 不会盖到当前场上", async () => {
    const { findingKey } = await import("../../../../shared/findingKey");
    const key = findingKey(result.findings[0] as never);
    const fx = (window as any).__gladlogFixture;

    // m1 的 flags 慢:解析时 m2 已经挂上了。m2 无标记。
    let releaseM1!: (v: Record<string, string>) => void;
    const m1Flags = new Promise<Record<string, string>>((r) => {
      releaseM1 = r;
    });
    fx.analysis.getFlags = vi.fn((id: string) =>
      id === "m1" ? m1Flags : Promise.resolve({}),
    );

    const { rerender } = render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    rerender(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m2"
      />,
    );
    releaseM1({ [key]: "done" }); // 旧场的响应此刻才到
    await screen.findByText(/You died at 30s/);

    const btn = screen.getByTitle("标记为已改进");
    expect(btn.className).not.toContain("active"); // 旧场标记没串过来
  });
});
