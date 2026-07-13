// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";

import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import { ShuffleReport } from "../src/renderer/src/report/components/ShuffleReport";
import {
  buildSyntheticShuffle,
  loadMatchFixture,
} from "./fixtures/loadFixture";

const m = loadMatchFixture();

describe("MatchReport", () => {
  it("组装:头/榜单卡/时间轴齐全(全宽,无侧栏)", () => {
    const { container } = render(<MatchReport source={m} />);
    expect(screen.getByText(m.result)).toBeTruthy();
    expect(container.querySelector(".rpt-meters-card")).toBeTruthy();
    expect(
      container.querySelector("[data-testid='rpt-timeline']"),
    ).toBeTruthy();
    const owner = m.units[m.playerId]!;
    expect(screen.getAllByText(owner.name).length).toBeGreaterThan(1); // header + 榜单行
    expect(container.querySelector(".rpt-unitpanel")).toBeNull(); // View B 已移除
  });
  it("meters 模式切换按钮工作", () => {
    render(<MatchReport source={m} />);
    fireEvent.click(screen.getByRole("button", { name: /治疗/ }));
    expect(
      (screen.getByRole("button", { name: /治疗/ }) as HTMLButtonElement)
        .className,
    ).toMatch(/active/);
  });
});

describe("MatchReport 顶层视图 tab(战报 / AI 分析)", () => {
  beforeEach(() => {
    // AI 视图挂载 StructuredAnalysisPanel + ProComparisonVerified,二者走 bridge()
    (window as any).__gladlogFixture = {
      analysis: {
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

  it("默认在战报视图:时间轴在、AI 面板不在", () => {
    const { container } = render(<MatchReport source={m} />);
    expect(
      container.querySelector("[data-testid='rpt-timeline']"),
    ).toBeTruthy();
    expect(container.querySelector(".rpt-ai-full")).toBeNull();
  });

  it("点 AI 分析:战报 body 隐藏、AI 全宽视图出现;点回战报可返回", () => {
    const { container } = render(<MatchReport source={m} />);
    fireEvent.click(screen.getByRole("button", { name: /AI 分析/ }));
    expect(container.querySelector(".rpt-ai-full")).toBeTruthy();
    expect(container.querySelector(".rpt-body")).toBeNull();
    expect(container.querySelector("[data-testid='rpt-timeline']")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /战报/ }));
    expect(container.querySelector(".rpt-body")).toBeTruthy();
    expect(container.querySelector(".rpt-ai-full")).toBeNull();
  });

  it("点回放:出现 2D 走位场地,战报 body 隐藏", () => {
    const { container } = render(<MatchReport source={m} />);
    fireEvent.click(screen.getByRole("button", { name: /回放/ }));
    expect(
      container.querySelector("[data-testid='rpt-replay-field']"),
    ).toBeTruthy();
    expect(container.querySelector(".rpt-body")).toBeNull();
    // fixture 带 advancedSamples → 至少画出一个单位
    expect(
      container.querySelectorAll(".rpt-replay-unit").length,
    ).toBeGreaterThan(0);
  });
});

describe("ShuffleReport", () => {
  it("回合 tab 切换,只渲染激活回合", () => {
    const s = buildSyntheticShuffle(m);
    const { container } = render(<ShuffleReport shuffle={s} />);
    expect(screen.getAllByText("Round 1").length).toBeGreaterThan(0);
    expect(
      container.querySelectorAll("[data-testid='rpt-timeline']"),
    ).toHaveLength(1); // 惰性:只有激活回合
    fireEvent.click(screen.getByText("Round 3"));
    expect(
      container.querySelectorAll("[data-testid='rpt-timeline']"),
    ).toHaveLength(1);
  });
});
