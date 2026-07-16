// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";

import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import { deriveStatsTable } from "../src/renderer/src/report/derive/statsTable";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const m = loadRealMatchFixture();

describe("统计表(backlog #10)", () => {
  it("deriveStatsTable:6 玩家一行,己方在前,字段有界", () => {
    const rows = deriveStatsTable(m);
    expect(rows.length).toBe(6);
    const firstEnemy = rows.findIndex((r) => r.reaction === "Hostile");
    // 己方全部在敌方之前
    for (let i = firstEnemy; i < rows.length; i++) {
      expect(rows[i]!.reaction).toBe("Hostile");
    }
    for (const r of rows) {
      expect(r.ccTakenPct).toBeGreaterThanOrEqual(0);
      expect(r.ccTakenPct).toBeLessThanOrEqual(100);
      expect(r.kicksCast).toBeGreaterThanOrEqual(0);
    }
    // 真实对局总得有人被控/施放过打断
    expect(rows.some((r) => r.ccTakenS > 0 || r.kicksCast > 0)).toBe(true);
  });

  it("战报视图:榜单模式出现「统计」,切换渲染表格", () => {
    render(<MatchReport source={m} matchId="t" />);
    fireEvent.click(screen.getByRole("button", { name: "统计" }));
    expect(screen.getByTestId("stats-table")).toBeTruthy();
    expect(screen.getByText("被打断")).toBeTruthy();
    // 切回伤害榜正常
    fireEvent.click(screen.getByRole("button", { name: "伤害" }));
    expect(screen.queryByTestId("stats-table")).toBeNull();
  });
});
