// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { DispelDashboard } from "../src/renderer/src/report/components/DispelDashboard";
import { KickDashboard } from "../src/renderer/src/report/components/KickDashboard";
import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import { deriveDispelDash } from "../src/renderer/src/report/derive/dispelDash";
import { deriveKickDash } from "../src/renderer/src/report/derive/kickDash";
import { deriveStatsTable } from "../src/renderer/src/report/derive/statsTable";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const base = loadRealMatchFixture();

/**
 * The fixture strips actionsIn/Out (to keep its size down), so kick outcomes
 * and the dispel ledger come out empty — clone it and inject synthetic events
 * so they go through the real conversion/judging pipeline (following the
 * deathrecap injection precedent). What gets injected:
 *  - one landed Wind Shear from Player1 (paired with a SPELL_INTERRUPT in the
 *    enemy's actionsIn) + one that whiffs
 *  - one Purge from Player1 removing Player2's Power Infusion (ourPurges)
 *  - one Purify Spirit from Player1 clearing Polymorph on Player3
 *    (allyCleanse)
 */
function withInjectedUtility() {
  const m = JSON.parse(JSON.stringify(base)) as typeof base;
  const units = m.units as unknown as Record<string, Record<string, unknown>>;
  const p1 = units["Player-1-00000001"]!; // Friendly kicker/purger
  const p2 = units["Player-1-00000002"]!; // Hostile target
  const p3 = units["Player-1-00000003"]!; // Friendly cleanse target
  const t0 = m.startTime;
  const ev = (over: Record<string, unknown>) => ({
    srcId: p1.id,
    srcName: p1.name,
    ...over,
  });

  // kick ×2: t0+20s lands (paired by the actionsIn below), t0+40s has no pair
  // (whiff / unknown)
  const WIND_SHEAR = { spellId: 57994, spellName: "Wind Shear" };
  (p1.casts as unknown[]).push(
    ev({
      timestamp: t0 + 20_000,
      eventName: "SPELL_CAST_SUCCESS",
      ...WIND_SHEAR,
      destId: p2.id,
      destName: p2.name,
    }),
    ev({
      timestamp: t0 + 40_000,
      eventName: "SPELL_CAST_SUCCESS",
      ...WIND_SHEAR,
      destId: p2.id,
      destName: p2.name,
    }),
  );
  p2.actionsIn = [
    ev({
      timestamp: t0 + 20_100,
      eventName: "SPELL_INTERRUPT",
      ...WIND_SHEAR,
      destId: p2.id,
      destName: p2.name,
      // params[11]/[12] = the interrupted spell (the extraSpellFields contract)
      params: Array.from({ length: 13 }, (_, i) =>
        i === 11 ? "116" : i === 12 ? "Frostbolt" : "",
      ),
    }),
  ];

  // Dispel ledger: purge the enemy's PI + cleanse Polymorph off a teammate
  p1.actionsOut = [
    ev({
      timestamp: t0 + 25_000,
      eventName: "SPELL_DISPEL",
      spellId: 370,
      spellName: "Purge",
      destId: p2.id,
      destName: p2.name,
      params: Array.from({ length: 13 }, (_, i) =>
        i === 11 ? "10060" : i === 12 ? "Power Infusion" : "",
      ),
    }),
    ev({
      timestamp: t0 + 30_000,
      eventName: "SPELL_DISPEL",
      spellId: 77130,
      spellName: "Purify Spirit",
      destId: p3.id,
      destName: p3.name,
      params: Array.from({ length: 13 }, (_, i) =>
        i === 11 ? "118" : i === 12 ? "Polymorph" : "",
      ),
    }),
  ];
  // A hard-cast dispel is preceded by its SPELL_CAST_SUCCESS in the real log;
  // without it classifyDispel (UI review #3) files the dispel as a passive
  // proc and it leaves the purge/cleanse counts — which is the point.
  (p1.casts as unknown[]).push(
    ev({
      timestamp: t0 + 25_000,
      eventName: "SPELL_CAST_SUCCESS",
      spellId: 370,
      spellName: "Purge",
      destId: p2.id,
      destName: p2.name,
    }),
    ev({
      timestamp: t0 + 30_000,
      eventName: "SPELL_CAST_SUCCESS",
      spellId: 77130,
      spellName: "Purify Spirit",
      destId: p3.id,
      destName: p3.name,
    }),
  );
  return m;
}

const m = withInjectedUtility();

describe("打断仪表盘(backlog #2)", () => {
  it("deriveKickDash:命中/未命中分桶,注入的两脚按差分入账", () => {
    // Player1 already has real kick casts in the fixture — assert on the delta,
    // never on hard-coded absolute numbers
    const findP1 = (rows: ReturnType<typeof deriveKickDash>) =>
      rows.find((r) => r.name === "Player1-Test");
    const before = findP1(deriveKickDash(base));
    const p1 = findP1(deriveKickDash(m));
    expect(p1).toBeTruthy();
    expect(p1!.reaction).toBe("Friendly");
    expect(p1!.total).toBe((before?.total ?? 0) + 2);
    expect(p1!.landed).toBe((before?.landed ?? 0) + 1);
    // The landed-rate denominator only counts decided outcomes (unknown is excluded)
    const decided = p1!.landed + p1!.juked + p1!.missed;
    if (decided > 0) {
      expect(p1!.landedRate).toBeCloseTo(p1!.landed / decided, 5);
    } else {
      expect(p1!.landedRate).toBeNull();
    }
    // Friendly rows sort before hostile rows
    const rows = deriveKickDash(m);
    const firstHostile = rows.findIndex((r) => r.reaction === "Hostile");
    const lastFriendly = rows.map((r) => r.reaction).lastIndexOf("Friendly");
    if (firstHostile >= 0) expect(lastFriendly).toBeLessThan(firstHostile);
  });

  it("与统计表守恒:kick 施放次数 = statsTable 的 kicksCast", () => {
    const kickRows = deriveKickDash(m);
    const statsRows = deriveStatsTable(m);
    for (const kr of kickRows) {
      const sr = statsRows.find((s) => s.unitId === kr.unitId);
      expect(sr, kr.name).toBeTruthy();
      expect(kr.total, kr.name).toBe(sr!.kicksCast);
    }
  });
});

describe("驱散仪表盘(backlog #3)", () => {
  it("deriveDispelDash:purge 与解各归一桶,事件带时间与目标", () => {
    const dash = deriveDispelDash(m);
    const p1 = dash.rows.find((r) => r.name === "Player1-Test");
    expect(p1).toBeTruthy();
    expect(p1!.purges).toBe(1);
    expect(p1!.cleanses).toBe(1);
    expect(p1!.steals).toBe(0);
    expect(p1!.events).toHaveLength(2);
    expect(p1!.events[0]!.tS).toBeLessThan(p1!.events[1]!.tS);
    expect(p1!.events.some((e) => e.label.includes("Power Infusion"))).toBe(
      true,
    );
  });

  it("与统计表守恒:cleanses/purges 计数一致", () => {
    const dash = deriveDispelDash(m);
    const statsRows = deriveStatsTable(m);
    for (const dr of dash.rows) {
      const sr = statsRows.find((s) => s.unitId === dr.unitId);
      expect(sr, dr.name).toBeTruthy();
      expect(dr.cleanses, dr.name).toBe(sr!.cleanses);
      // statsTable's purges include steals (same bucket) — align the measure
      expect(dr.purges + dr.steals, dr.name).toBe(sr!.purges);
    }
  });
});

describe("战报视图集成", () => {
  it("两个面板渲染;行展开出明细;▶ 触发 seek(切到回放)", () => {
    const { container } = render(<MatchReport source={m} matchId="t" />);
    // 1a merged card: kicks are the engagement panel's default tab, dispels
    // need a tab switch (mutually exclusive mounting)
    expect(screen.getByTestId("kick-dash")).toBeTruthy();
    fireEvent.click(screen.getByTestId("engage-tab-dispel"));
    expect(screen.getByTestId("dispel-dash")).toBeTruthy();
    fireEvent.click(screen.getByTestId("engage-tab-kick"));
    // Expand the first row of the kick panel
    const row = screen
      .getByTestId("kick-dash")
      .querySelector("tr.rpt-stats-expandable");
    expect(row).toBeTruthy();
    fireEvent.click(row!);
    const jump = screen
      .getByTestId("kick-dash")
      .querySelector(".rpt-stats-detail-jump");
    expect(jump).toBeTruthy();
    fireEvent.click(jump!);
    // The seek pipeline switches to the replay view
    expect(container.querySelector(".rpt-replay-scrub")).toBeTruthy();
  });

  it("零数据时保留卡壳 + 一行空态(P1-1,功能可发现;组件级)", () => {
    // The base fixture is not zero-data (it has real missed-cleanse windows and
    // kick casts), so the empty state is tested at the component level
    const { container } = render(
      <>
        <KickDashboard rows={[]} />
        <DispelDashboard
          dash={{
            rows: [],
            totals: { friendlyDeliberate: 0, friendlyPassive: 0 },
            missedPurges: [],
            missedCleanses: [],
            ccEfficiency: [],
          }}
        />
      </>,
    );
    expect(
      container.querySelector("[data-testid=kick-dash] .rpt-ledger-empty")
        ?.textContent,
    ).toContain("打断");
    expect(
      container.querySelector("[data-testid=dispel-dash] .rpt-ledger-empty")
        ?.textContent,
    ).toContain("驱散");
    // The empty-state card renders no table or rows, only the card shell plus
    // one line of copy
    expect(container.querySelector("table")).toBeNull();
  });
});

describe("读条控制条(假读习惯,2026-09-26)", () => {
  const cc = {
    name: "Player1-Realm",
    classId: 7,
    hardcasts: 40,
    cancels: [
      {
        spellId: "8004",
        spellName: "Healing Surge",
        startS: 10,
        cancelS: 10.6,
        progressPct: 40,
      },
      {
        spellId: "8004",
        spellName: "Healing Surge",
        startS: 30,
        cancelS: 30.9,
        progressPct: 60,
      },
    ],
    medianCancelPct: 60,
    kicked: 2,
    baitedKicks: [
      {
        atSeconds: 31.2,
        kickerName: "Enemy-Realm",
        kickSpellName: "Kick",
        baitSpellName: "Healing Surge",
      },
    ],
  };
  it("shows counts, expands baited kicks, ▶ seeks to the kick", () => {
    const onSeek = vi.fn();
    const { container } = render(
      <KickDashboard rows={[]} castControl={cc} onSeek={onSeek} />,
    );
    const strip = container.querySelector("[data-testid=cast-control]")!;
    expect(strip.textContent).toContain("读条 40 次");
    expect(strip.textContent).toContain("自己停手 2 次(中位读到 60%)");
    expect(strip.textContent).toContain("被打断 2 次");
    expect(strip.textContent).toContain("骗掉对方打断 1 次");
    fireEvent.click(screen.getByTitle("展开被骗掉的打断"));
    expect(strip.textContent).toContain("0:31");
    fireEvent.click(screen.getByTitle("回放此刻"));
    expect(onSeek).toHaveBeenCalledWith(28.2, ["Player1-Realm", "Enemy-Realm"]);
  });
  it("renders nothing without cast control (not the recorder / not loaded)", () => {
    const { container } = render(<KickDashboard rows={[]} />);
    expect(container.querySelector("[data-testid=cast-control]")).toBeNull();
  });
});
