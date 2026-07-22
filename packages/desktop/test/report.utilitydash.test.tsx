// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";

import { DispelDashboard } from "../src/renderer/src/report/components/DispelDashboard";
import { KickDashboard } from "../src/renderer/src/report/components/KickDashboard";
import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import { deriveDispelDash } from "../src/renderer/src/report/derive/dispelDash";
import { deriveKickDash } from "../src/renderer/src/report/derive/kickDash";
import { deriveStatsTable } from "../src/renderer/src/report/derive/statsTable";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const base = loadRealMatchFixture();

/**
 * fixture 剥掉了 actionsIn/Out(控体积),kick 判果与驱散账目为空 —— 克隆并
 * 注入合成事件走真实转换/判定管线(deathrecap 注入先例)。注入内容:
 *  - Player1 一次 Wind Shear 命中(enemy actionsIn SPELL_INTERRUPT 配对)+ 一次落空
 *  - Player1 一次 Purge 驱掉 Player2 的 Power Infusion(ourPurges)
 *  - Player1 一次 Purify Spirit 给 Player3 解 Polymorph(allyCleanse)
 */
function withInjectedUtility() {
  const m = JSON.parse(JSON.stringify(base)) as typeof base;
  const units = m.units as Record<string, Record<string, unknown>>;
  const p1 = units["Player-1-00000001"]!; // Friendly kicker/purger
  const p2 = units["Player-1-00000002"]!; // Hostile target
  const p3 = units["Player-1-00000003"]!; // Friendly cleanse target
  const t0 = m.startTime;
  const ev = (over: Record<string, unknown>) => ({
    srcId: p1.id,
    srcName: p1.name,
    ...over,
  });

  // kick ×2:t0+20s 命中(下方 actionsIn 配对),t0+40s 无配对(落空/未知)
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
      // params[11]/[12] = 被打断的法术(extraSpellFields 契约)
      params: Array.from({ length: 13 }, (_, i) =>
        i === 11 ? "116" : i === 12 ? "Frostbolt" : "",
      ),
    }),
  ];

  // 驱散账目:purge 敌方 PI + 给队友解 Polymorph
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
  return m;
}

const m = withInjectedUtility();

describe("打断仪表盘(backlog #2)", () => {
  it("deriveKickDash:命中/未命中分桶,注入的两脚按差分入账", () => {
    // fixture 里 Player1 本就有真实打断施放 —— 用差分断言,不写死绝对数
    const findP1 = (rows: ReturnType<typeof deriveKickDash>) =>
      rows.find((r) => r.name === "Player1-Test");
    const before = findP1(deriveKickDash(base));
    const p1 = findP1(deriveKickDash(m));
    expect(p1).toBeTruthy();
    expect(p1!.reaction).toBe("Friendly");
    expect(p1!.total).toBe((before?.total ?? 0) + 2);
    expect(p1!.landed).toBe((before?.landed ?? 0) + 1);
    // 命中率分母只含有结论的(unknown 不入)
    const decided = p1!.landed + p1!.juked + p1!.missed;
    if (decided > 0) {
      expect(p1!.landedRate).toBeCloseTo(p1!.landed / decided, 5);
    } else {
      expect(p1!.landedRate).toBeNull();
    }
    // 己方行排在敌方行之前
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
      // statsTable 的 purges 含偷(同一桶),对齐口径
      expect(dr.purges + dr.steals, dr.name).toBe(sr!.purges);
    }
  });
});

describe("战报视图集成", () => {
  it("两个面板渲染;行展开出明细;▶ 触发 seek(切到回放)", () => {
    const { container } = render(<MatchReport source={m} matchId="t" />);
    expect(screen.getByTestId("kick-dash")).toBeTruthy();
    expect(screen.getByTestId("dispel-dash")).toBeTruthy();
    // 展开 kick 面板第一行
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
    // seek 管线会切到回放视图
    expect(container.querySelector(".rpt-replay-scrub")).toBeTruthy();
  });

  it("零数据时面板不渲染,不留空壳(组件级)", () => {
    // base fixture 并非零数据(有真实漏解窗口/打断施放),空壳判定在组件层测
    const { container } = render(
      <>
        <KickDashboard rows={[]} />
        <DispelDashboard
          dash={{
            rows: [],
            missedPurges: [],
            missedCleanses: [],
            ccEfficiency: [],
          }}
        />
      </>,
    );
    expect(container.querySelector("[data-testid]")).toBeNull();
  });
});
