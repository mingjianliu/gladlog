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
  it("组装:头/meters/时间轴/单位面板齐全,默认选中 log owner", () => {
    const { container } = render(<MatchReport source={m} />);
    expect(screen.getByText(m.result)).toBeTruthy();
    expect(
      container.querySelector("[data-testid='rpt-timeline']"),
    ).toBeTruthy();
    const owner = m.units[m.playerId]!;
    expect(screen.getAllByText(owner.name).length).toBeGreaterThan(1); // header + unit panel
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
