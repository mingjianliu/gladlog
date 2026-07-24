// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";

import { AuraUptimeCard } from "../src/renderer/src/report/components/AuraUptimeCard";
import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import {
  deriveAuraUptime,
  mergeCoverage,
} from "../src/renderer/src/report/derive/auraUptime";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const m = loadRealMatchFixture();

describe("光环 uptime(第四阶段④)", () => {
  it("mergeCoverage:重叠/相接区间并集,互不相交保持原样", () => {
    expect(
      mergeCoverage([
        { fromS: 0, toS: 30 },
        { fromS: 10, toS: 40 },
        { fromS: 50, toS: 60 },
      ]),
    ).toEqual([
      { fromS: 0, toS: 40 },
      { fromS: 50, toS: 60 },
    ]);
  });


  it("derive:行按类别白名单筛选,uptime 秒数与区间加总一致且不超全场", () => {
    const { rows, durationS } = deriveAuraUptime(m);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(["offense", "defense", "cc"]).toContain(r.kind);
      // uptime = 区间并集(同名 buff 多来源重叠不得重复计)
      const union = mergeCoverage(r.intervals).reduce(
        (s, iv) => s + (iv.toS - iv.fromS),
        0,
      );
      expect(r.uptimeS).toBeCloseTo(Math.round(union * 10) / 10, 5);
      expect(r.uptimeS).toBeLessThanOrEqual(durationS + 1e-6);
      for (const iv of r.intervals) {
        expect(iv.fromS).toBeGreaterThanOrEqual(0);
        expect(iv.toS).toBeLessThanOrEqual(durationS + 1e-6);
        expect(iv.toS).toBeGreaterThanOrEqual(iv.fromS);
      }
    }
  });

  it("时间窗:窗口占比 = 重叠秒数 / 窗口时长(同谓词),且 ≤ 全场秒数", () => {
    const full = deriveAuraUptime(m);
    const range = { fromS: 10, toS: 40 };
    const windowed = deriveAuraUptime(m, range);
    for (const w of windowed.rows) {
      const f = full.rows.find(
        (r) => r.unitId === w.unitId && r.spellId === w.spellId,
      );
      // 窗口行必然也在全场行里(窗口只会降 uptime,不会造新行……除非全场被
      // 每单位 top-N 截断挤掉 —— 那种情况跳过比较
      if (!f) continue;
      expect(w.uptimeS).toBeLessThanOrEqual(f.uptimeS + 1e-6);
      expect(w.uptimeS).toBeLessThanOrEqual(30 + 1e-6);
    }
  });

  it("组件:渲染区间条与占比;空数据不渲染", () => {
    const data = deriveAuraUptime(m);
    const { container } = render(<AuraUptimeCard data={data} />);
    expect(screen.getByTestId("aura-uptime")).toBeTruthy();
    expect(container.querySelectorAll(".rpt-aura-seg").length).toBeGreaterThan(
      0,
    );
    const { container: empty } = render(
      <AuraUptimeCard data={{ rows: [], durationS: 1 }} />,
    );
    expect(empty.querySelector("[data-testid=aura-uptime]")).toBeNull();
  });

  it("战报视图集成:卡片出现在页面上", () => {
    render(<MatchReport source={m} matchId="t" />);
    expect(screen.getByTestId("aura-uptime")).toBeTruthy();
  });
});
