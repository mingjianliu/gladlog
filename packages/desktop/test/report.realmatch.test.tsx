// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";

import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import { deriveUnitTimeline } from "../src/renderer/src/report/derive/casts";
import { deriveReplay } from "../src/renderer/src/report/derive/replay";
import { deriveSummary } from "../src/renderer/src/report/derive/summary";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

// 真实(裁剪+匿名)3v3 比赛数据,验证三视图能吃真实走位/技能数据渲染。
const m = loadRealMatchFixture();

describe("真实比赛数据渲染", () => {
  it("fixture 已匿名:不含真实角色名/服务器痕迹", () => {
    const s = JSON.stringify(m);
    expect(s).not.toMatch(/白银之手|冰风岗|罗宁|黑铁|安加萨|暗影之月/);
    // 玩家名已换成通用名
    const players = Object.values(m.units).filter((u) => u.kind === "Player");
    expect(players.length).toBeGreaterThanOrEqual(4);
    expect(players.every((p) => /^Player\d+-Test$/.test(p.name))).toBe(true);
  });

  it("derive 层吃真实数据:meters/回放/单位事件流都非空", () => {
    const summary = deriveSummary(m);
    expect(summary.length).toBeGreaterThan(0);
    expect(summary.some((r) => r.damageDone > 0 || r.healingDone > 0)).toBe(
      true,
    );

    const replay = deriveReplay(m);
    expect(replay.tracks.length).toBeGreaterThan(0);
    expect(replay.tracks.every((t) => t.samples.length > 0)).toBe(true);
    // 真实走位:包围盒非退化
    expect(replay.bounds.maxX - replay.bounds.minX).toBeGreaterThan(1);

    const anyPlayer = Object.values(m.units).find((u) => u.kind === "Player")!;
    expect(deriveUnitTimeline(m, anyPlayer.id).length).toBeGreaterThan(0);
  });

  it("战报视图:头/榜单卡/时间轴齐全(全宽,无侧栏)", () => {
    const { container } = render(<MatchReport source={m} />);
    expect(screen.getByText(m.result)).toBeTruthy();
    expect(container.querySelector(".rpt-meters-card")).toBeTruthy();
    expect(
      container.querySelector("[data-testid='rpt-timeline']"),
    ).toBeTruthy();
    // View B 单位侧栏已按设计移除
    expect(container.querySelector(".rpt-unitpanel")).toBeNull();
  });

  it("回放视图:竞技场画出多个单位(职业字形 + 血条)", () => {
    const { container } = render(<MatchReport source={m} />);
    fireEvent.click(screen.getByRole("button", { name: /回放/ }));
    expect(
      container.querySelector("[data-testid='rpt-replay-field']"),
    ).toBeTruthy();
    const units = container.querySelectorAll(".rpt-replay-unit");
    expect(units.length).toBeGreaterThan(1);
    // 竞技场重绘:每个存活单位带 2 字母职业字形 + 血条
    expect(container.querySelectorAll(".rpt-replay-glyph").length).toBe(
      units.length,
    );
    expect(container.querySelectorAll(".rpt-replay-hp-track").length).toBe(
      units.length,
    );
    expect(container.querySelector(".rpt-replay-play")).toBeTruthy();
  });

  it("回放:GCD 泳道随玩家 chip 切换列 + 共享时间光标", () => {
    const { container } = render(<MatchReport source={m} />);
    fireEvent.click(screen.getByRole("button", { name: /回放/ }));
    expect(container.querySelector(".rpt-gcd")).toBeTruthy();
    expect(container.querySelector(".rpt-gcd-cursor")).toBeTruthy();
    const chips =
      container.querySelectorAll<HTMLButtonElement>(".rpt-gcd-chip");
    expect(chips.length).toBeGreaterThan(1);
    const cols0 = container.querySelectorAll(".rpt-gcd-col").length;
    expect(cols0).toBe(chips.length); // 默认全选
    fireEvent.click(chips[0]!); // 关掉第一个玩家列
    expect(container.querySelectorAll(".rpt-gcd-col").length).toBe(cols0 - 1);
  });
});
