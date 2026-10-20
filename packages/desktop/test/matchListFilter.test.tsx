// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";

import type { StoredMatchMeta } from "../src/main/matchStore";
import {
  applyFilter,
  EMPTY_FILTER,
  type ListFilter,
  MatchListFilter,
} from "../src/renderer/src/components/MatchListFilter";

const meta = (over: Partial<StoredMatchMeta>): StoredMatchMeta => ({
  id: Math.random().toString(36).slice(2),
  kind: "match",
  bracket: "3v3",
  zoneId: "1505",
  startTime: 1,
  endTime: 2,
  result: "win",
  storedAt: 1,
  ...over,
});

const metas: StoredMatchMeta[] = [
  meta({ id: "w3", teams: [[{ specId: 105, classId: 11 }], []] }),
  meta({ id: "l3", result: "loss" }),
  meta({
    id: "w2",
    bracket: "2v2",
    teams: [
      [
        { specId: 64, classId: 8 },
        { specId: 105, classId: 11 },
      ],
      [{ specId: 105, classId: 11 }],
    ],
  }),
];

describe("列表筛选(MatchListFilter)", () => {
  it("applyFilter:zoneId 精确匹配(战绩分地图行点击入口,规格二-3)", () => {
    const mixed = [...metas, meta({ id: "z2", zoneId: "617" })];
    expect(
      applyFilter(mixed, { ...EMPTY_FILTER, zoneId: "617" }).map((m) => m.id),
    ).toEqual(["z2"]);
    expect(applyFilter(mixed, { ...EMPTY_FILTER, zoneId: "1505" }).length).toBe(
      3,
    );
  });

  it("applyFilter:胜负/赛制/专精(任一方);旧行无 teams 时专精筛选不匹配", () => {
    expect(applyFilter(metas, EMPTY_FILTER).length).toBe(3);
    expect(
      applyFilter(metas, { ...EMPTY_FILTER, result: "win" }).map((m) => m.id),
    ).toEqual(["w3", "w2"]);
    expect(
      applyFilter(metas, { ...EMPTY_FILTER, result: "loss" }).map((m) => m.id),
    ).toEqual(["l3"]);
    expect(
      applyFilter(metas, { ...EMPTY_FILTER, bracket: "2v2" }).map((m) => m.id),
    ).toEqual(["w2"]);
    // 105 appears on w3's own side and on both sides of w2; l3 has no teams →
    // no match
    expect(
      applyFilter(metas, { ...EMPTY_FILTER, specIds: [105] }).map((m) => m.id),
    ).toEqual(["w3", "w2"]);
    // Combined
    expect(
      applyFilter(metas, {
        ...EMPTY_FILTER,
        result: "win",
        bracket: "2v2",
        specIds: [105],
      }).map((m) => m.id),
    ).toEqual(["w2"]);
  });

  it("applyFilter:多专精 = 同队全含(comp 检索),跨队不算", () => {
    // 64+105 on the same team occurs only on w2's own side; w3 has only 105
    expect(
      applyFilter(metas, { ...EMPTY_FILTER, specIds: [64, 105] }).map(
        (m) => m.id,
      ),
    ).toEqual(["w2"]);
    // 64 and 105 split across the two teams must not match: build a
    // cross-team case
    const cross = meta({
      id: "x",
      teams: [[{ specId: 64, classId: 8 }], [{ specId: 105, classId: 11 }]],
    });
    expect(
      applyFilter([cross], { ...EMPTY_FILTER, specIds: [64, 105] }),
    ).toHaveLength(0);
  });

  it("applyFilter:日期范围按本地日含端点", () => {
    const day = (s: string) => new Date(`${s}T12:00:00`).getTime();
    const dated = [
      meta({ id: "d1", startTime: day("2026-07-01") }),
      meta({ id: "d2", startTime: day("2026-07-15") }),
      meta({ id: "d3", startTime: day("2026-07-31") }),
    ];
    expect(
      applyFilter(dated, { ...EMPTY_FILTER, dateFrom: "2026-07-15" }).map(
        (m) => m.id,
      ),
    ).toEqual(["d2", "d3"]);
    expect(
      applyFilter(dated, { ...EMPTY_FILTER, dateTo: "2026-07-15" }).map(
        (m) => m.id,
      ),
    ).toEqual(["d1", "d2"]);
    expect(
      applyFilter(dated, {
        ...EMPTY_FILTER,
        dateFrom: "2026-07-02",
        dateTo: "2026-07-30",
      }).map((m) => m.id),
    ).toEqual(["d2"]);
  });

  it("UI:选项来自实际数据;加专精出 chip,点 chip 移除;激活后清除可复位", () => {
    let f: ListFilter = EMPTY_FILTER;
    const view = () => (
      <MatchListFilter metas={metas} filter={f} onChange={(n) => (f = n)} />
    );
    const { rerender, container } = render(view());
    expect(screen.getByRole("option", { name: "2v2" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Frost Mage" })).toBeTruthy();
    // Add a spec → the chip appears and that option leaves the dropdown
    const specSelect = container.querySelectorAll("select")[1]!;
    fireEvent.change(specSelect, { target: { value: "105" } });
    expect(f.specIds).toEqual([105]);
    rerender(view());
    const chip = container.querySelector(".mlf-chip");
    expect(chip).toBeTruthy();
    expect(
      screen.queryByRole("option", { name: "Restoration Druid" }),
    ).toBeNull();
    // Click the chip to remove it
    fireEvent.click(chip!);
    expect(f.specIds).toEqual([]);
    rerender(view());
    // Date input + reset via clear
    const dateInputs = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0]!, { target: { value: "2026-07-01" } });
    expect(f.dateFrom).toBe("2026-07-01");
    rerender(view());
    fireEvent.click(screen.getByRole("button", { name: "胜" }));
    rerender(view());
    fireEvent.click(screen.getByRole("button", { name: "清除" }));
    expect(f).toEqual(EMPTY_FILTER);
  });
});
