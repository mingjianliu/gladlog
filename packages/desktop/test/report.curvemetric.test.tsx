// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";

import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import { loadRealMatchFixtureWithKillWindow } from "./fixtures/loadFixture";

// the real fixture minus the enemy priest's own shields: since the
// 2026-10-21 ruling they end its only kill window (see the loader)
const m = loadRealMatchFixtureWithKillWindow();

const metricSelect = (): HTMLSelectElement =>
  screen.getByTestId("tl-metric") as HTMLSelectElement;
const meterMode = (c: HTMLElement): string | null =>
  c.querySelector(".rpt-mode-seg button.active")?.textContent ?? null;
const barCount = (c: HTMLElement): number =>
  Array.from(
    c.querySelectorAll<SVGPathElement>("[data-testid='tl-flow-bar']"),
  ).filter((p) => (p.getAttribute("d") ?? "").length > 0).length;

describe("战报曲线指标下拉 × 榜单联动", () => {
  it("默认血量曲线,榜单停在伤害", () => {
    const { container } = render(<MatchReport source={m} matchId="t" />);
    expect(metricSelect().value).toBe("hp");
    expect(
      container.querySelectorAll("path.rpt-tl-line").length,
    ).toBeGreaterThan(0);
    expect(barCount(container)).toBe(0);
    expect(meterMode(container)).toBe("伤害");
  });

  it("切到治疗:曲线换成每秒堆叠柱,榜单跟着切到治疗", () => {
    const { container } = render(<MatchReport source={m} matchId="t" />);
    fireEvent.change(metricSelect(), { target: { value: "healing" } });
    expect(metricSelect().value).toBe("healing");
    expect(container.querySelectorAll("path.rpt-tl-line")).toHaveLength(0);
    expect(barCount(container)).toBeGreaterThan(0);
    expect(meterMode(container)).toBe("治疗");
  });

  it("被治疗 / 血量没有对应榜单模式 → 榜单原地不动", () => {
    const { container } = render(<MatchReport source={m} matchId="t" />);
    fireEvent.change(metricSelect(), { target: { value: "taken" } });
    expect(meterMode(container)).toBe("承伤");
    fireEvent.change(metricSelect(), { target: { value: "healed" } });
    expect(metricSelect().value).toBe("healed");
    expect(meterMode(container)).toBe("承伤");
    fireEvent.change(metricSelect(), { target: { value: "hp" } });
    expect(meterMode(container)).toBe("承伤");
    // 回到血量,曲线回来
    expect(
      container.querySelectorAll("path.rpt-tl-line").length,
    ).toBeGreaterThan(0);
  });

  it("联动是单向的:点榜单不会把曲线从血量上抢走", () => {
    const { container } = render(<MatchReport source={m} matchId="t" />);
    const healBtn = Array.from(
      container.querySelectorAll(".rpt-mode-seg button"),
    ).find((b) => b.textContent === "治疗")!;
    fireEvent.click(healBtn);
    expect(meterMode(container)).toBe("治疗");
    expect(metricSelect().value).toBe("hp");
    expect(
      container.querySelectorAll("path.rpt-tl-line").length,
    ).toBeGreaterThan(0);
  });

  it("裁剪过的 doc 没有 healIn → 被治疗给空态提示而不是空白图", () => {
    const { container } = render(<MatchReport source={m} matchId="t" />);
    // This fixture is the trimmed one on purpose; if it ever regains healIn the
    // case below stops testing the empty path and must be re-pointed
    expect("healIn" in Object.values(m.units)[0]!).toBe(false);
    fireEvent.change(metricSelect(), { target: { value: "healed" } });
    expect(barCount(container)).toBe(0);
    expect(screen.getByTestId("tl-flow-empty").textContent).toContain("被治疗");
  });

  it("时间窗只高亮不裁剪柱子:选窗口后柱子数量不变,榜单数字变", () => {
    const { container } = render(<MatchReport source={m} matchId="t" />);
    fireEvent.change(metricSelect(), { target: { value: "damage" } });
    const before = barCount(container);
    const fullMeters = container.querySelector(".rpt-meters")!.textContent;
    const rangeSelect = screen
      .getByTestId("time-range-bar")
      .querySelector("select")!;
    expect(rangeSelect.querySelectorAll("option").length).toBeGreaterThan(1);
    fireEvent.change(rangeSelect, { target: { value: "0" } });
    expect(screen.getByTestId("tl-range")).toBeTruthy();
    expect(barCount(container)).toBe(before);
    expect(container.querySelector(".rpt-meters")!.textContent).not.toBe(
      fullMeters,
    );
  });
});
