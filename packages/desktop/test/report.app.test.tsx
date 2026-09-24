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
    expect(
      screen.getByText(m.result.toLowerCase() === "win" ? "胜利" : "败北"),
    ).toBeTruthy();
    expect(container.querySelector(".rpt-meters-card")).toBeTruthy();
    expect(
      container.querySelector("[data-testid='rpt-timeline']"),
    ).toBeTruthy();
    const owner = m.units[m.playerId]!;
    // 头部出全名,榜单行出短名(T8:伤害榜与全 app 其它名字面统一剥服务器
    // 后缀)。改动前这里断言的是「全名出现 >1 次 = 头部 + 榜单行」,现在两处
    // 分开断言,反而钉得更死:少了任何一处都会红。
    const short = owner.name.split("-")[0]!;
    expect(short).not.toBe(owner.name); // fixture 名字确实带后缀
    expect(screen.getAllByText(owner.name).length).toBe(1); // 头部
    const meterNames = [...container.querySelectorAll(".rpt-meter-name")].map(
      (e) => e.textContent ?? "",
    );
    expect(meterNames.some((t) => t.includes(short))).toBe(true);
    expect(meterNames.some((t) => t.includes(owner.name))).toBe(false);
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
    // The AI view mounts StructuredAnalysisPanel + ProComparisonVerified,
    // both of which go through bridge()
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
    // Match the view tab exactly (the recap card auto-expanded by P1-3 also
    // has its own "replay this moment" button)
    fireEvent.click(screen.getByRole("button", { name: "回放" }));
    expect(
      container.querySelector("[data-testid='rpt-replay-field']"),
    ).toBeTruthy();
    expect(container.querySelector(".rpt-body")).toBeNull();
    // The fixture carries advancedSamples -> at least one unit is drawn
    expect(
      container.querySelectorAll(".rpt-replay-unit").length,
    ).toBeGreaterThan(0);
  });
});

describe("ShuffleReport", () => {
  it("回合 tab 切换,只渲染激活回合", () => {
    const s = buildSyntheticShuffle(m);
    const { container } = render(<ShuffleReport shuffle={s} />);
    // P1-4: rpt-round-tabs was removed; the W/L pills (role=tab) are the
    // switching control
    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBe(s.rounds.length);
    expect(
      container.querySelectorAll("[data-testid='rpt-timeline']"),
    ).toHaveLength(1); // Lazy: only the active round
    fireEvent.click(screen.getByTitle("回合 3"));
    expect(screen.getByTitle("回合 3").className).toContain("cur");
    expect(
      container.querySelectorAll("[data-testid='rpt-timeline']"),
    ).toHaveLength(1);
  });

  it("六回合:胶囊序列是 flex 容器,每个胶囊带窄屏短文案", () => {
    const s = buildSyntheticShuffle(m, 6);
    const { container } = render(<ShuffleReport shuffle={s} />);
    const seq = container.querySelector(".rpt-shuffle-seq")!;
    expect(seq).toBeTruthy();
    const pills = seq.querySelectorAll("[role=tab]");
    expect(pills.length).toBe(6);
    // Narrow-width text is the round number alone; full text keeps R6 · W/L
    // (fixture playerTeamId=0, round 6 → winningTeamId 1 → loss)
    const last = pills[5]!;
    expect(last.querySelector(".rpt-shuffle-pill-full")!.textContent).toBe(
      "R6 · L",
    );
    expect(last.querySelector(".rpt-shuffle-pill-short")!.textContent).toBe(
      "6",
    );
    expect(last.getAttribute("aria-label")).toBe("回合 6 · 负");
  });
});
