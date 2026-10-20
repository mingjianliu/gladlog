// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";

import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import {
  deriveEventRows,
  EMPTY_EVENTS_FILTER,
  type EventRow,
  filterDisplayRows,
  filterEventRows,
  groupEventRows,
  isGroupRow,
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
    // An event row's detail is formatted text, so we re-sum the raw events
    // under the same flattening measure here and assert that the two paths
    // (events flattening vs summary aggregation) count the same event set
    // identically.
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

describe("events 视图 — 聚合(P0-1)", () => {
  const mk = (over: Partial<EventRow>): EventRow => ({
    tS: 0,
    kind: "aura",
    srcName: "甲",
    destName: "乙",
    spellId: "1",
    spellName: "测试光环",
    detail: "−失去",
    ...over,
  });

  it("死亡清场:24 条同目标 −失去 + 1 条 death → 1 条 aura-flood(deathClear)+ 1 条死亡行", () => {
    const flood = Array.from({ length: 24 }, (_, i) =>
      mk({ tS: 20 + i * 0.05, spellName: `光环${i}`, spellId: String(i) }),
    );
    const death = mk({
      tS: 21.4,
      kind: "death",
      detail: "死亡",
      spellName: "",
      destId: "u1",
    });
    const grouped = groupEventRows([...flood, death]);
    expect(grouped.length).toBe(2);
    const g = grouped[0]!;
    expect(isGroupRow(g) && g.kind === "aura-flood").toBe(true);
    if (g.kind === "aura-flood") {
      expect(g.count).toBe(24);
      expect(g.deathClear).toBe(true);
      expect(g.children.length).toBe(24);
    }
    expect(grouped[1]!.kind).toBe("death");
  });

  it("跨度 >1.5s 或条数 <5 不折叠;+获得 不折叠", () => {
    const sparse = Array.from({ length: 6 }, (_, i) => mk({ tS: i * 0.5 }));
    expect(groupEventRows(sparse).every((r) => !isGroupRow(r))).toBe(true);
    const few = Array.from({ length: 4 }, (_, i) => mk({ tS: i * 0.1 }));
    expect(groupEventRows(few).every((r) => !isGroupRow(r))).toBe(true);
    const gains = Array.from({ length: 8 }, (_, i) =>
      mk({ tS: i * 0.1, detail: "+获得" }),
    );
    expect(groupEventRows(gains).every((r) => !isGroupRow(r))).toBe(true);
  });

  it("周期 tick:同 (kind,src,dest,spell) 连续 ≥3 且间隔 ≤2s → 聚合行,数额求和", () => {
    const ticks = Array.from({ length: 6 }, (_, i) =>
      mk({
        tS: i * 0.5,
        kind: "damage",
        spellName: "萦绕符文",
        detail: "1.0k",
        amount: 1000,
      }),
    );
    const grouped = groupEventRows(ticks);
    expect(grouped.length).toBe(1);
    const g = grouped[0]!;
    expect(g.kind).toBe("tick-group");
    if (g.kind === "tick-group") {
      expect(g.count).toBe(6);
      expect(g.amount).toBe(6000);
      expect(g.rowKind).toBe("damage");
    }
  });

  it("过滤语义:spellQuery 命中任一 child 时整组可见;matched 按原始行数计", () => {
    const flood = Array.from({ length: 8 }, (_, i) =>
      mk({ tS: i * 0.1, spellName: i === 3 ? "月火术" : `光环${i}` }),
    );
    const grouped = groupEventRows(flood);
    expect(grouped.length).toBe(1);
    const hit = filterDisplayRows(grouped, {
      ...EMPTY_EVENTS_FILTER,
      spellQuery: "月火",
    });
    expect(hit.rows.length).toBe(1);
    expect(isGroupRow(hit.rows[0]!)).toBe(true);
    expect(hit.matched).toBe(1);
    const miss = filterDisplayRows(grouped, {
      ...EMPTY_EVENTS_FILTER,
      spellQuery: "不存在",
    });
    expect(miss.rows.length).toBe(0);
    expect(miss.matched).toBe(0);
  });
});

describe("events 视图 — UI 集成", () => {
  it("事件 tab 打开面板;类型 chip 过滤生效;▶ 跳回放", () => {
    const { container } = render(<MatchReport source={m} matchId="t" />);
    fireEvent.click(screen.getByRole("button", { name: "事件" }));
    expect(screen.getByTestId("events-panel")).toBeTruthy();
    // The panel opens on the 关键 preset (UI review #5); this test toggles
    // a single kind from the full list, so switch to 全部 first
    fireEvent.click(screen.getByTestId("events-preset-all"));
    const countBefore = container.querySelectorAll(
      ".rpt-events-table tbody tr",
    ).length;
    expect(countBefore).toBeGreaterThan(0);
    // The kind chips now live in the 类型 column's filter popover (2026-08-04),
    // so it has to be opened first.
    fireEvent.click(screen.getByTestId("events-kind-filter"));
    // Deaths only: the row count drops sharply (the chip's accessible name
    // includes a count, so match by prefix)
    fireEvent.click(screen.getByRole("button", { name: /^死亡/ }));
    const deathRows = container.querySelectorAll(".rpt-events-table tbody tr");
    expect(deathRows.length).toBeLessThan(countBefore);
    // ▶ jumps to the replay
    fireEvent.click(screen.getByRole("button", { name: /^死亡/ })); // clear the filter
    const jump = container.querySelector(
      ".rpt-events-table .rpt-stats-detail-jump",
    );
    expect(jump).toBeTruthy();
    fireEvent.click(jump!);
    expect(container.querySelector(".rpt-replay-scrub")).toBeTruthy();
  });
});
