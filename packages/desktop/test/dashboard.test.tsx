// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import type { StoredMatchMeta } from "../src/main/matchStore";
import {
  deriveCurrentRating,
  deriveDashboard,
  deriveRatingDeltas,
  periodStart,
  RATE_MIN_N_ROW,
  RATE_MIN_N_TOTAL,
  rateDisplay,
} from "../src/renderer/src/components/dashboard";
import { StatsDashboard } from "../src/renderer/src/components/StatsDashboard";

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
    // 8 days ago: outside the week period
    meta({ startTime: NOW - 8 * 24 * H, avgRating: 2200 }),
    // Legacy row: none of the rich fields
    meta({
      startTime: NOW - 3 * H,
      durationS: undefined,
      avgRating: undefined,
      teams: undefined,
      result: "loss",
      zoneId: "617",
    }),
    // One 2v2 match (a rating series needs >=2 points to form a line, so this
    // bracket should be filtered out)
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
    expect(week.ratingSeries.length).toBe(1); // 3v3 has two points; the single 2v2 point is filtered
    expect(week.ratingSeries[0]!.bracket).toBe("3v3");
    expect(week.ratingSeries[0]!.points.map((p) => p.rating)).toEqual([
      2350, 2400,
    ]);
    // comp: 64+71 appears in 3 matches (2 x 3v3 + 1 x 2v2 within the week)
    const comp = week.comps.find((c) => c.specIds.join("+") === "64+71")!;
    expect(comp.games).toBe(3);
    expect(comp.wins).toBe(2);
    expect(week.legacyRows).toBe(1);
    // Zones: legacy rows count too
    expect(week.zones.find((z) => z.zoneId === "617")!.games).toBe(1);
  });
});

describe("shuffle 回合口径(1e)", () => {
  it("胜率按回合计;comp 按回合敌组;旧 shuffle 行回退按场", () => {
    const metas = [
      // Rich shuffle row: 6 rounds, 4 wins, two enemy comps
      meta({
        kind: "shuffle",
        bracket: "Rated Solo Shuffle",
        result: "win",
        roundStats: [
          { win: true, enemySpecIds: [64, 71, 105] },
          { win: true, enemySpecIds: [64, 71, 105] },
          { win: false, enemySpecIds: [62, 71, 105] },
          { win: true, enemySpecIds: [62, 71, 105] },
          { win: false, enemySpecIds: [64, 71, 105] },
          { win: true, enemySpecIds: [64, 71, 105] },
        ],
      }),
      // Legacy shuffle row (no roundStats): falls back to per-match, with
      // teams taken from the R1 roster
      meta({
        kind: "shuffle",
        bracket: "Rated Solo Shuffle",
        result: "loss",
        startTime: NOW - 2 * H,
      }),
      // A regular match, unchanged
      meta({ result: "win", startTime: NOW - 3 * H }),
    ];
    const d = deriveDashboard(metas, "week", NOW);
    // Match count is per match (3); win rate is per round: 6 (rich shuffle
    // row) + 1 (legacy shuffle) + 1 (match) = 8, wins = 4 + 0 + 1 = 5
    expect(d.games).toBe(3);
    expect(d.rateGames).toBe(8);
    expect(d.rateWins).toBe(5);
    // comp: the rich shuffle splits into two rows by per-round enemy comp;
    // the legacy shuffle and the match go through teams[1]
    const a = d.comps.find((c) => c.specIds.join("+") === "64+71+105")!;
    expect(a.games).toBe(4);
    expect(a.wins).toBe(3);
    const b = d.comps.find((c) => c.specIds.join("+") === "62+71+105")!;
    expect(b.games).toBe(2);
    expect(b.wins).toBe(1);
    const legacy = d.comps.find((c) => c.specIds.join("+") === "64+71")!;
    expect(legacy.games).toBe(2); // legacy shuffle row + match row
    expect(legacy.wins).toBe(1);
  });

  it("普通对局全场景下 rate 口径与按场一致(回归不变量)", () => {
    const metas = [meta({}), meta({ result: "loss", startTime: NOW - 2 * H })];
    const d = deriveDashboard(metas, "week", NOW);
    expect(d.rateGames).toBe(d.games);
    expect(d.rateWins).toBe(d.wins);
  });
});

describe("第二轮 P0:最近对局 + 评分涨跌单源", () => {
  it("recent 取期内按时间降序前 8", () => {
    const metas = Array.from({ length: 10 }, (_, i) =>
      meta({ id: `m${i}`, startTime: NOW - (i + 1) * H }),
    );
    const d = deriveDashboard(metas, "all", NOW);
    expect(d.recent.map((m) => m.id)).toEqual([
      "m0",
      "m1",
      "m2",
      "m3",
      "m4",
      "m5",
      "m6",
      "m7",
    ]);
  });

  it("recent 不随时间段收窄(「最近」就是最近,P0 空态填充的本意)", () => {
    const metas = [meta({ id: "old", startTime: NOW - 8 * 24 * H })];
    const d = deriveDashboard(metas, "week", NOW);
    expect(d.games).toBe(0);
    expect(d.recent.map((m) => m.id)).toEqual(["old"]);
  });

  it("deriveRatingDeltas:同 bracket+角色+评分源相邻差;CR 与队均 MMR 不混比", () => {
    const metas = [
      meta({
        id: "a",
        playerName: "A",
        playerRating: 2000,
        startTime: NOW - 3 * H,
      }),
      meta({
        id: "b",
        playerName: "A",
        playerRating: 2018,
        startTime: NOW - 2 * H,
      }),
      // Legacy row with no personal rating: falls back to the team average,
      // which is a different key and is never subtracted against CR
      meta({ id: "c", playerName: "A", startTime: NOW - H }),
    ];
    const d = deriveRatingDeltas(metas);
    expect(d.get("a")).toBeNull();
    expect(d.get("b")).toBe(18);
    expect(d.get("c")).toBeNull();
  });
});

describe("StatsDashboard UI", () => {
  it("渲染总览/曲线/comp 表;comp 行点击回调 specId", async () => {
    // Build the data relative to the current instant: the component uses the
    // real Date.now() for its "last week" window, so a fixed NOW
    // (2026-07-18) slides out of the window 7 days later and dash-curve
    // disappears (confirmed as a date-rollover flake on 2026-07-25: CI green
    // in the morning, red in the afternoon).
    const now = Date.now();
    (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
      matches: {
        list: async () => [
          meta({ startTime: now - H }),
          meta({ result: "loss", avgRating: 2350, startTime: now - 2 * H }),
        ],
      },
    };
    const picked: number[] = [];
    render(<StatsDashboard onCompClick={(id) => picked.push(id)} />);
    expect(await screen.findByText("场次")).toBeTruthy();
    // Two matches < RATE_MIN_N_TOTAL: the tile leads with counts (UI review #8)
    const tile = screen.getByTestId("dash-kpi-rate");
    expect(tile.querySelector(".dash-kpi-v")!.textContent).toBe("1-1");
    expect(tile.querySelector(".dash-kpi-k")!.textContent).toContain("50%");
    // 1e redesign: the full-width curve card is gone; the curve now lives in
    // the popover opened from the "current rating" sparkline
    expect(screen.getByTestId("dash-sparkline")).toBeTruthy();
    // First/last value labels (3.5-4(2)): HTML layer, first=2350 last=2400
    expect(
      [...document.querySelectorAll(".dash-spark-lab")].map(
        (e) => e.textContent,
      ),
    ).toEqual(["2350", "2400"]);
    fireEvent.click(screen.getByLabelText("展开评分曲线大图"));
    expect(screen.getByTestId("dash-curve")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("关闭"));
    expect(screen.queryByTestId("dash-curve")).toBeNull();
    const row = screen.getByTitle("Frost Mage + Arms Warrior");
    fireEvent.click(row);
    expect(picked).toEqual([64]);
  });

  it("分地图行式卡(规格二-3):行点击回调 onZoneClick 带 zoneId", async () => {
    const now = Date.now();
    (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
      matches: {
        list: async () => [
          meta({ startTime: now - H }),
          meta({ zoneId: "617", startTime: now - 2 * H }),
        ],
      },
    };
    const picked: string[] = [];
    render(<StatsDashboard onZoneClick={(id) => picked.push(id)} />);
    const card = await screen.findByTestId("dash-zones");
    const rows = card.querySelectorAll(".dash-comp");
    expect(rows.length).toBe(2);
    fireEvent.click(rows[0]!);
    expect(picked.length).toBe(1);
    expect(["1505", "617"]).toContain(picked[0]);
  });

  it("最近对局卡(三点五-1①):MatchListRow 行,点击回调 onOpenMatch", async () => {
    const now = Date.now();
    (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
      matches: {
        list: async () => [
          meta({ id: "r1", startTime: now - H }),
          meta({ id: "r2", startTime: now - 2 * H }),
        ],
      },
    };
    const opened: string[] = [];
    render(<StatsDashboard onOpenMatch={(id) => opened.push(id)} />);
    const card = await screen.findByTestId("dash-recent");
    const rows = card.querySelectorAll(".dash-recent-row");
    expect(rows.length).toBe(2);
    // Descending: the most recent comes first
    fireEvent.click(rows[0]!);
    expect(opened).toEqual(["r1"]);
  });

  it("阵容空态(三点五-1②):重建索引入口调 rebuildIndex 并刷新列表", async () => {
    const now = Date.now();
    const rebuildIndex = vi.fn().mockResolvedValue({ updated: 1, failed: 0 });
    const list = vi
      .fn()
      // First fetch: only legacy rows without teams -> empty comp state
      .mockResolvedValueOnce([
        meta({
          id: "old",
          startTime: now - H,
          teams: undefined,
          durationS: undefined,
          avgRating: undefined,
        }),
      ])
      // After the rebuild: rich rows are backfilled
      .mockResolvedValue([meta({ startTime: now - H })]);
    (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
      matches: { list, rebuildIndex },
    };
    render(<StatsDashboard />);
    const btn = await screen.findByTestId("dash-rebuild");
    fireEvent.click(btn);
    await screen.findByText(/已重建:更新 1 场/);
    expect(rebuildIndex).toHaveBeenCalledTimes(1);
    // The list has refreshed: the comp row appears
    expect(screen.getByTitle("Frost Mage + Arms Warrior")).toBeTruthy();
  });
});

describe("角色区分(用户反馈:17 个号分数跳来跳去)", () => {
  const mk = (
    over: Partial<import("../src/main/matchStore").StoredMatchMeta>,
  ) =>
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
    const { deriveDashboard, listCharacters } =
      await import("../src/renderer/src/components/dashboard");
    const metas = [
      mk({ playerName: "A-Realm", result: "Win" }),
      mk({ playerName: "A-Realm", result: "Loss" }),
      mk({ playerName: "B-Realm", result: "Win" }),
      mk({}), // Legacy row with no playerName
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
    const { deriveDashboard } =
      await import("../src/renderer/src/components/dashboard");
    const t = Date.now();
    const metas = [
      mk({ startTime: t - 5000, playerRating: 1800, avgRating: 2100 }),
      mk({ startTime: t - 4000, playerRating: 1820, avgRating: 2050 }),
      mk({ startTime: t - 3000, avgRating: 1500 }), // Legacy row: falls back to team average
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
        startTime: NOW - 8 * 24 * H, // Before the period start (7 days) -> baseline
      }),
      meta({
        id: "c",
        bracket: "2v2",
        playerRating: 1800,
        startTime: NOW - 2 * H,
      }),
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
      deriveCurrentRating([meta({ playerRating: null, avgRating: null })], NOW),
    ).toBeNull();
  });
});

describe("rateDisplay (small-N honesty, UI review #8)", () => {
  it("below the floor leads with counts and demotes the percentage", () => {
    expect(rateDisplay(8, 12, RATE_MIN_N_TOTAL)).toEqual({
      primary: "8-4",
      secondary: "67%",
      belowFloor: true,
    });
  });
  it("at the floor leads with the percentage", () => {
    expect(rateDisplay(10, 20, RATE_MIN_N_TOTAL)).toEqual({
      primary: "50%",
      secondary: "10-10",
      belowFloor: false,
    });
  });
  it("zero games renders a dash and no secondary", () => {
    expect(rateDisplay(0, 0, RATE_MIN_N_ROW)).toEqual({
      primary: "—",
      secondary: null,
      belowFloor: true,
    });
  });
  it("row floor is lower than the total floor (3v3 rows count matches)", () => {
    expect(RATE_MIN_N_ROW).toBeLessThan(RATE_MIN_N_TOTAL);
    expect(rateDisplay(3, 4, RATE_MIN_N_ROW).belowFloor).toBe(true);
    expect(rateDisplay(3, 5, RATE_MIN_N_ROW).belowFloor).toBe(false);
  });
});
