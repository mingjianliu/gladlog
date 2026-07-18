// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";

import {
  deriveCurrentRating,
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

describe("角色区分(用户反馈:17 个号分数跳来跳去)", () => {
  const mk = (over: Partial<import("../src/main/matchStore").StoredMatchMeta>) =>
    ({
      id: Math.random().toString(36).slice(2),
      kind: "match",
      bracket: "3v3",
      zoneId: "1",
      startTime: Date.now() - 1000,
      endTime: Date.now(),
      result: "Win",
      storedAt: Date.now(),
      ...over,
    }) as import("../src/main/matchStore").StoredMatchMeta;

  it("listCharacters 按场次降序;deriveDashboard 按角色过滤", async () => {
    const { deriveDashboard, listCharacters } = await import(
      "../src/renderer/src/components/dashboard"
    );
    const metas = [
      mk({ playerName: "A-Realm", result: "Win" }),
      mk({ playerName: "A-Realm", result: "Loss" }),
      mk({ playerName: "B-Realm", result: "Win" }),
      mk({}), // 旧行无 playerName
    ];
    const chars = listCharacters(metas);
    expect(chars.map((c) => c.name)).toEqual(["A-Realm", "B-Realm"]);
    const all = deriveDashboard(metas, "all");
    expect(all.games).toBe(4);
    const onlyA = deriveDashboard(metas, "all", Date.now(), "A-Realm");
    expect(onlyA.games).toBe(2);
    expect(onlyA.wins).toBe(1);
  });

  it("评分曲线优先记录者本人评分,旧行回退队均", async () => {
    const { deriveDashboard } = await import(
      "../src/renderer/src/components/dashboard"
    );
    const t = Date.now();
    const metas = [
      mk({ startTime: t - 5000, playerRating: 1800, avgRating: 2100 }),
      mk({ startTime: t - 4000, playerRating: 1820, avgRating: 2050 }),
      mk({ startTime: t - 3000, avgRating: 1500 }), // 旧行:回退队均
    ];
    const d = deriveDashboard(metas, "all");
    const pts = d.ratingSeries[0]!.points.map((p) => p.rating);
    expect(pts).toEqual([1800, 1820, 1500]);
  });
});

describe("deriveCurrentRating(1h 总览带)", () => {
  it("取最近有评分场的 bracket,与期起点前最近同 bracket 场相减", () => {
    const metas = [
      meta({ id: "a", bracket: "3v3", playerRating: 2145, startTime: NOW - H }),
      meta({
        id: "b",
        bracket: "3v3",
        playerRating: 2082,
        startTime: NOW - 8 * 24 * H, // 期起点(7 天)之前 → 基线
      }),
      meta({ id: "c", bracket: "2v2", playerRating: 1800, startTime: NOW - 2 * H }),
    ];
    const cur = deriveCurrentRating(metas, NOW - 7 * 24 * H);
    expect(cur).toEqual({ bracket: "3v3", rating: 2145, delta: 63 });
  });

  it("无基线 → delta null;全无评分 → null", () => {
    const cur = deriveCurrentRating(
      [meta({ playerRating: 2000, startTime: NOW - H })],
      NOW - 7 * 24 * H,
    );
    expect(cur!.delta).toBeNull();
    expect(
      deriveCurrentRating(
        [meta({ playerRating: null, avgRating: null })],
        NOW,
      ),
    ).toBeNull();
  });
});
