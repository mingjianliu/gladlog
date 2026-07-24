// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";

import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import { deriveDetailBreakdown } from "../src/renderer/src/report/derive/detailBreakdown";
import { deriveStatsTable } from "../src/renderer/src/report/derive/statsTable";
import { deriveSummary } from "../src/renderer/src/report/derive/summary";
import { deriveVulnBands } from "../src/renderer/src/report/derive/vulnWindows";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const m = loadRealMatchFixture();
const fullS = (m.endTime - m.startTime) / 1000;

describe("时间窗联动(第四阶段①)— derive 层", () => {
  it("全场窗口 ≡ 不传窗口(恒等)", () => {
    const a = deriveSummary(m);
    const b = deriveSummary(m, { fromS: 0, toS: fullS });
    expect(b.map((r) => [r.unitId, r.damageDone, r.healingDone])).toEqual(
      a.map((r) => [r.unitId, r.damageDone, r.healingDone]),
    );
  });

  it("守恒:窗口内伤害 = 直接按事件时间戳过滤的加总(同一谓词两条路)", () => {
    const range = { fromS: 10, toS: 50 };
    const rows = deriveSummary(m, range);
    const fromMs = m.startTime + range.fromS * 1000;
    const toMs = m.startTime + range.toS * 1000;
    for (const u of Object.values(m.units)) {
      if (u.kind !== "Player" || !u.info) continue;
      const pets = Object.values(m.units).filter((p) => p.ownerId === u.id);
      const expected = [u, ...pets].reduce(
        (acc, unit) =>
          acc +
          (
            unit.damageOut as Array<{
              timestamp: number;
              effectiveAmount: number;
            }>
          )
            .filter((e) => e.timestamp >= fromMs && e.timestamp <= toMs)
            .reduce((s, e) => s + e.effectiveAmount, 0),
        0,
      );
      const row = rows.find((r) => r.unitId === u.id);
      expect(row!.damageDone, u.name).toBe(expected);
    }
  });

  it("dps 分母 = 窗口时长(不是全场时长)", () => {
    const range = { fromS: 10, toS: 50 };
    const rows = deriveSummary(m, range);
    for (const r of rows) {
      expect(r.dps).toBeCloseTo(r.damageDone / 40, 6);
    }
  });

  it("明细分解与榜单同口径:分解合计 = 榜单 damageDone(窗口下守恒)", () => {
    const range = { fromS: 10, toS: 50 };
    const rows = deriveSummary(m, range);
    const top = rows[0]!;
    const { rows: breakdown } = deriveDetailBreakdown(
      m,
      top.unitId,
      "damage",
      range,
    );
    const total = breakdown.reduce((s, r) => s + r.total, 0);
    expect(total).toBe(top.damageDone);
  });

  it("statsTable:窗口计数单调 ≤ 全场;被控秒数按重叠裁剪不超窗口长", () => {
    const full = deriveStatsTable(m);
    const range = { fromS: 0, toS: 45 };
    const windowed = deriveStatsTable(m, range);
    for (const w of windowed) {
      const f = full.find((r) => r.unitId === w.unitId)!;
      expect(w.kicksCast, w.name).toBeLessThanOrEqual(f.kicksCast);
      expect(w.kicksTaken, w.name).toBeLessThanOrEqual(f.kicksTaken);
      expect(w.ccTakenS, w.name).toBeLessThanOrEqual(f.ccTakenS + 1e-6);
      expect(w.ccTakenS, w.name).toBeLessThanOrEqual(45 + 1e-6);
      // 明细列表也在窗口内
      for (const i of w.detail.kicksCast) {
        expect(i.tS).toBeGreaterThanOrEqual(0);
        expect(i.tS).toBeLessThanOrEqual(45);
      }
    }
  });
});

describe("时间窗联动 — UI 集成", () => {
  it("phase 下拉回显:窗口与 band 差小数秒(标签取整)仍能选中", () => {
    const bands = deriveVulnBands(m);
    const b0 = bands[0]!;
    // 模拟「从取整标签来的窗口」(如视觉场景的 {36,59} vs band 的 36.734/59.189)
    const { container } = render(
      <MatchReport
        source={m}
        matchId="t"
        initialTimeRange={{ fromS: Math.floor(b0.fromS), toS: Math.floor(b0.toS) }}
      />,
    );
    const select = container
      .querySelector("[data-testid=time-range-bar]")!
      .querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("0");
  });


  it("phase 下拉选窗口 → chip 出现、榜单数值变化;清除 → 复原", () => {
    const bands = deriveVulnBands(m);
    // fixture 没有窗口时本用例无意义 —— 用断言防静默空转
    expect(bands.length).toBeGreaterThan(0);
    const { container } = render(<MatchReport source={m} matchId="t" />);
    const fullText = container.querySelector(".rpt-meters")!.textContent;
    const select = screen
      .getByTestId("time-range-bar")
      .querySelector("select")!;
    fireEvent.change(select, { target: { value: "0" } });
    expect(screen.getByTestId("time-range-chip")).toBeTruthy();
    expect(screen.getByTestId("tl-range")).toBeTruthy();
    const windowedText = container.querySelector(".rpt-meters")!.textContent;
    expect(windowedText).not.toBe(fullText);
    fireEvent.click(screen.getByRole("button", { name: "清除" }));
    expect(screen.queryByTestId("time-range-chip")).toBeNull();
    expect(container.querySelector(".rpt-meters")!.textContent).toBe(fullText);
  });
});
