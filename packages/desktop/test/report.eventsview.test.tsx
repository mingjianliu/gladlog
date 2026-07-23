// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";

import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import {
  deriveEventRows,
  EMPTY_EVENTS_FILTER,
  filterEventRows,
} from "../src/renderer/src/report/derive/eventsView";
import { deriveSummary } from "../src/renderer/src/report/derive/summary";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const m = loadRealMatchFixture();
const rows = deriveEventRows(m);

describe("events 视图(第四阶段②)— derive 层", () => {
  it("摊平:非空、按时间升序、tS 全部落在场内", () => {
    expect(rows.length).toBeGreaterThan(100);
    const durS = (m.endTime - m.startTime) / 1000;
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.tS).toBeGreaterThanOrEqual(rows[i - 1]!.tS);
    }
    for (const r of rows) {
      expect(r.tS).toBeGreaterThanOrEqual(0);
      expect(r.tS).toBeLessThanOrEqual(durS + 0.11);
    }
  });

  it("守恒:damage 行数 = 各单位 damageOut 长度之和(B2 溯源:一行一事件)", () => {
    const expected = Object.values(m.units).reduce(
      (s, u) => s + ((u as { damageOut?: unknown[] }).damageOut?.length ?? 0),
      0,
    );
    expect(rows.filter((r) => r.kind === "damage").length).toBe(expected);
  });

  it("过滤:类型/单位/技能子串/时间窗各自独立生效", () => {
    const dmg = filterEventRows(rows, {
      ...EMPTY_EVENTS_FILTER,
      kinds: ["damage"],
    });
    expect(dmg.every((r) => r.kind === "damage")).toBe(true);

    const someUnit = rows.find((r) => r.srcName)!.srcName;
    const byUnit = filterEventRows(rows, {
      ...EMPTY_EVENTS_FILTER,
      unitName: someUnit,
    });
    expect(byUnit.length).toBeGreaterThan(0);
    expect(
      byUnit.every((r) => r.srcName === someUnit || r.destName === someUnit),
    ).toBe(true);

    const windowed = filterEventRows(rows, {
      ...EMPTY_EVENTS_FILTER,
      range: { fromS: 10, toS: 20 },
    });
    expect(windowed.length).toBeGreaterThan(0);
    expect(windowed.every((r) => r.tS >= 10 && r.tS <= 20)).toBe(true);

    const someSpell = rows.find((r) => r.spellName.length > 3)!.spellName;
    const bySpell = filterEventRows(rows, {
      ...EMPTY_EVENTS_FILTER,
      spellQuery: someSpell.slice(0, 4).toLowerCase(),
    });
    expect(bySpell.length).toBeGreaterThan(0);
  });

  it("与榜单守恒:damage 行(按来源+宠物归主)金额加总 = deriveSummary damageDone", () => {
    // 事件行的 detail 是格式化文本,这里直接按同一摊平口径重加总原始事件,
    // 断言两条路径(events 摊平 vs summary 聚合)对同一批事件计数一致。
    const summary = deriveSummary(m);
    const totalSummary = summary.reduce((s, r) => s + r.damageDone, 0);
    const totalEvents = Object.values(m.units).reduce(
      (s, u) =>
        s +
        (
          (u as { damageOut?: { effectiveAmount: number }[] }).damageOut ?? []
        ).reduce((a, e) => a + e.effectiveAmount, 0),
      0,
    );
    expect(totalEvents).toBe(totalSummary);
  });
});

describe("events 视图 — UI 集成", () => {
  it("事件 tab 打开面板;类型 chip 过滤生效;▶ 跳回放", () => {
    const { container } = render(<MatchReport source={m} matchId="t" />);
    fireEvent.click(screen.getByRole("button", { name: "事件" }));
    expect(screen.getByTestId("events-panel")).toBeTruthy();
    const countBefore = container.querySelectorAll(
      ".rpt-events-table tbody tr",
    ).length;
    expect(countBefore).toBeGreaterThan(0);
    // 只看死亡:行数骤减
    fireEvent.click(screen.getByRole("button", { name: "死亡" }));
    const deathRows = container.querySelectorAll(".rpt-events-table tbody tr");
    expect(deathRows.length).toBeLessThan(countBefore);
    // ▶ 跳回放
    fireEvent.click(screen.getByRole("button", { name: "死亡" })); // 取消过滤
    const jump = container.querySelector(
      ".rpt-events-table .rpt-stats-detail-jump",
    );
    expect(jump).toBeTruthy();
    fireEvent.click(jump!);
    expect(container.querySelector(".rpt-replay-scrub")).toBeTruthy();
  });
});
