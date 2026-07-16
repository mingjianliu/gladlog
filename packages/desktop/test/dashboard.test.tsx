// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";

import {
  deriveDashboard,
  periodStart,
} from "../src/renderer/src/components/dashboard";
import { StatsDashboard } from "../src/renderer/src/components/StatsDashboard";
import type { StoredMatchMeta } from "../src/main/matchStore";

const NOW = new Date("2026-07-18T20:00:00Z").getTime();
const H = 3600_000;

const meta = (over: Partial<StoredMatchMeta>): StoredMatchMeta => ({
  id: Math.random().toString(36).slice(2),
  kind: "match",
  bracket: "3v3",
  zoneId: "1505",
  startTime: NOW - H,
  endTime: NOW - H + 300_000,
  result: "win",
  storedAt: 1,
  durationS: 300,
  avgRating: 2400,
  teams: [
    [{ specId: 105, classId: 11 }],
    [
      { specId: 64, classId: 8 },
      { specId: 71, classId: 1 },
    ],
  ],
  ...over,
});

describe("deriveDashboard", () => {
  const metas = [
    meta({}),
    meta({ result: "loss", avgRating: 2350, startTime: NOW - 2 * H }),
    // 8 天前:week 期外
    meta({ startTime: NOW - 8 * 24 * H, avgRating: 2200 }),
    // 旧行:无富字段
    meta({
      startTime: NOW - 3 * H,
      durationS: undefined,
      avgRating: undefined,
      teams: undefined,
      result: "loss",
      zoneId: "617",
    }),
    // 2v2 一场(评分序列需 ≥2 点才成线,该 bracket 应被滤掉)
    meta({ bracket: "2v2", startTime: NOW - 4 * H, avgRating: 1800 }),
  ];

  it("period 过滤 + 总览/中位数(旧行无时长不计中位)", () => {
    const week = deriveDashboard(metas, "week", NOW);
    expect(week.games).toBe(4);
    expect(week.wins).toBe(2);
    expect(week.medianDurationS).toBe(300);
    const all = deriveDashboard(metas, "all", NOW);
    expect(all.games).toBe(5);
    expect(periodStart("all", NOW)).toBe(0);
  });

  it("评分曲线按 bracket 分线且 ≥2 点;comp 表聚合敌方签名并数旧行", () => {
    const week = deriveDashboard(metas, "week", NOW);
    expect(week.ratingSeries.length).toBe(1); // 3v3 两点;2v2 单点被滤
    expect(week.ratingSeries[0]!.bracket).toBe("3v3");
    expect(week.ratingSeries[0]!.points.map((p) => p.rating)).toEqual([
      2350, 2400,
    ]);
    // comp:64+71 出现 3 场(week 内 2 场 3v3 + 1 场 2v2)
    const comp = week.comps.find((c) => c.specIds.join("+") === "64+71")!;
    expect(comp.games).toBe(3);
    expect(comp.wins).toBe(2);
    expect(week.legacyRows).toBe(1);
    // 地图:旧行也计入
    expect(week.zones.find((z) => z.zoneId === "617")!.games).toBe(1);
  });
});

describe("StatsDashboard UI", () => {
  it("渲染总览/曲线/comp 表;comp 行点击回调 specId", async () => {
    (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
      matches: {
        list: async () => [
          meta({}),
          meta({ result: "loss", avgRating: 2350, startTime: NOW - 2 * H }),
        ],
      },
    };
    const picked: number[] = [];
    render(<StatsDashboard onCompClick={(id) => picked.push(id)} />);
    expect(await screen.findByText("场次")).toBeTruthy();
    expect(screen.getByTestId("dash-curve")).toBeTruthy();
    const row = screen.getByTitle("Frost Mage + Arms Warrior");
    fireEvent.click(row);
    expect(picked).toEqual([64]);
  });
});
