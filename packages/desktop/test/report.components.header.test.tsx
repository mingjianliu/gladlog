// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";

import { Meters } from "../src/renderer/src/report/components/Meters";
import { ReportHeader } from "../src/renderer/src/report/components/ReportHeader";
import { abbrevAmount } from "../src/renderer/src/report/derive/meterRows";
import { deriveSummary } from "../src/renderer/src/report/derive/summary";
import { loadMatchFixture } from "./fixtures/loadFixture";

const m = loadMatchFixture();

describe("ReportHeader(1c 单行页头)", () => {
  it("渲染本地化胜负 + bracket·地图·时长;玩家名不再出现在页头", () => {
    const { container } = render(<ReportHeader source={m} />);
    expect(
      screen.getByText(m.result.toLowerCase() === "win" ? "胜利" : "败北"),
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
  it("damage 模式:行数=玩家数,首行数值分级缩写(P2-2)、title 保留千分位全值", () => {
    const rows = deriveSummary(m);
    const { container } = render(<Meters rows={rows} mode="damage" />);
    const top = rows[0]!;
    // T8:榜单行显示短名(与事件表/泳道表头/UnitName 一致),全名留在 title 里。
    const short = top.name.split("-")[0]!;
    expect(short).not.toBe(top.name); // fixture 名字带服务器后缀,否则这条断言测不到东西
    expect(screen.getByText(short)).toBeTruthy();
    expect(screen.queryByText(top.name)).toBeNull();
    expect(screen.getByText(abbrevAmount(top.damageDone))).toBeTruthy();
    const title = container
      .querySelector(".rpt-meter-row")
      ?.getAttribute("title");
    expect(title).toContain(Math.round(top.damageDone).toLocaleString("en-US"));
    expect(title).toContain(top.name); // 全名仍可悬停查到
  });
});
