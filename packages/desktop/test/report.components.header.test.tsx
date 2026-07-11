// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { ReportHeader } from "../src/renderer/src/report/components/ReportHeader";
import { Meters } from "../src/renderer/src/report/components/Meters";
import { deriveSummary } from "../src/renderer/src/report/derive/summary";
import { loadMatchFixture } from "./fixtures/loadFixture";

const m = loadMatchFixture();

describe("ReportHeader", () => {
  it("渲染结果、bracket、全部玩家名", () => {
    render(<ReportHeader source={m} />);
    expect(screen.getByText(m.result)).toBeTruthy();
    expect(screen.getByText(new RegExp(m.bracket))).toBeTruthy();
    for (const u of Object.values(m.units)) {
      if (u.kind === "Player" && u.info)
        expect(screen.getByText(u.name)).toBeTruthy();
    }
  });
  it("roundLabel 显示", () => {
    render(<ReportHeader source={m} roundLabel="Round 2" />);
    expect(screen.getByText("Round 2")).toBeTruthy();
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
