// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";

import {
  applyFilter,
  EMPTY_FILTER,
  MatchListFilter,
  type ListFilter,
} from "../src/renderer/src/components/MatchListFilter";
import type { StoredMatchMeta } from "../src/main/matchStore";

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
    teams: [[{ specId: 64, classId: 8 }], [{ specId: 105, classId: 11 }]],
  }),
];

describe("列表筛选(MatchListFilter)", () => {
  it("applyFilter:胜负/赛制/专精(任一方);旧行无 teams 时专精筛选不匹配", () => {
    expect(applyFilter(metas, EMPTY_FILTER).length).toBe(3);
    expect(applyFilter(metas, { ...EMPTY_FILTER, result: "win" }).map((m) => m.id)).toEqual(["w3", "w2"]);
    expect(applyFilter(metas, { ...EMPTY_FILTER, result: "loss" }).map((m) => m.id)).toEqual(["l3"]);
    expect(applyFilter(metas, { ...EMPTY_FILTER, bracket: "2v2" }).map((m) => m.id)).toEqual(["w2"]);
    // 105 出现在 w3 己方 和 w2 敌方;l3 无 teams → 不匹配
    expect(applyFilter(metas, { ...EMPTY_FILTER, specId: 105 }).map((m) => m.id)).toEqual(["w3", "w2"]);
    // 组合
    expect(
      applyFilter(metas, { result: "win", bracket: "2v2", specId: 105 }).map((m) => m.id),
    ).toEqual(["w2"]);
  });

  it("UI:选项来自实际数据;激活后出现清除按钮并可复位", () => {
    let f: ListFilter = EMPTY_FILTER;
    const { rerender } = render(
      <MatchListFilter metas={metas} filter={f} onChange={(n) => (f = n)} />,
    );
    // 赛制选项含 2v2/3v3;专精选项含 Frost Mage / Restoration Druid
    expect(screen.getByRole("option", { name: "2v2" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Frost Mage" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "胜" }));
    expect(f.result).toBe("win");
    rerender(<MatchListFilter metas={metas} filter={f} onChange={(n) => (f = n)} />);
    fireEvent.click(screen.getByRole("button", { name: "清除" }));
    expect(f).toEqual(EMPTY_FILTER);
  });
});
