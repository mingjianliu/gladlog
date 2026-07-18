// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { ReportHeader } from "../src/renderer/src/report/components/ReportHeader";
import { Meters } from "../src/renderer/src/report/components/Meters";
import { deriveSummary } from "../src/renderer/src/report/derive/summary";
import { loadMatchFixture } from "./fixtures/loadFixture";

const m = loadMatchFixture();

describe("ReportHeader(1c 单行页头)", () => {
  it("渲染本地化胜负 + bracket·地图·时长;玩家名不再出现在页头", () => {
    const { container } = render(<ReportHeader source={m} />);
    expect(
      screen.getByText(m.result.toLowerCase() === "win" ? "胜利" : "失败"),
    ).toBeTruthy();
    expect(screen.getByText(new RegExp(m.bracket))).toBeTruthy();
    for (const u of Object.values(m.units)) {
      if (u.kind === "Player" && u.info)
        expect(container.textContent).not.toContain(u.name);
    }
  });
  it("roundLabel 并入 meta 行", () => {
    render(<ReportHeader source={m} roundLabel="Round 2" />);
    expect(screen.getByText(/Round 2/)).toBeTruthy();
  });
});

describe("Meters", () => {
  it("damage 模式:行数=玩家数,首行为最大值且数值千分位出现", () => {
    const rows = deriveSummary(m);
    render(<Meters rows={rows} mode="damage" />);
    const top = rows[0]!;
    expect(screen.getByText(top.name)).toBeTruthy();
    expect(
      screen.getByText(Math.round(top.damageDone).toLocaleString("en-US")),
    ).toBeTruthy();
  });
});
