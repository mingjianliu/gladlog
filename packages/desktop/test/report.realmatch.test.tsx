// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";

import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import { deriveReplay } from "../src/renderer/src/report/derive/replay";
import { deriveSummary } from "../src/renderer/src/report/derive/summary";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

// Real (trimmed + anonymized) 3v3 match data, verifying that all three views
// can render real movement / ability data.
const m = loadRealMatchFixture();

describe("真实比赛数据渲染", () => {
  it("fixture 已匿名:不含真实角色名/服务器痕迹", () => {
    const s = JSON.stringify(m);
    expect(s).not.toMatch(/白银之手|冰风岗|罗宁|黑铁|安加萨|暗影之月/);
    // player names have been replaced with generic ones
    const players = Object.values(m.units).filter((u) => u.kind === "Player");
    expect(players.length).toBeGreaterThanOrEqual(4);
    expect(players.every((p) => /^Player\d+-Test$/.test(p.name))).toBe(true);
  });

  it("derive 层吃真实数据:meters/回放都非空", () => {
    const summary = deriveSummary(m);
    expect(summary.length).toBeGreaterThan(0);
    expect(summary.some((r) => r.damageDone > 0 || r.healingDone > 0)).toBe(
      true,
    );

    const replay = deriveReplay(m);
    expect(replay.tracks.length).toBeGreaterThan(0);
    expect(replay.tracks.every((t) => t.samples.length > 0)).toBe(true);
    // Real movement: the bounding box is non-degenerate
    expect(replay.bounds.maxX - replay.bounds.minX).toBeGreaterThan(1);
  });

  it("战报视图:头/榜单卡/时间轴齐全(全宽,无侧栏)", () => {
    const { container } = render(<MatchReport source={m} />);
    expect(
      screen.getByText(m.result.toLowerCase() === "win" ? "胜利" : "失败"),
    ).toBeTruthy();
    expect(container.querySelector(".rpt-meters-card")).toBeTruthy();
    expect(
      container.querySelector("[data-testid='rpt-timeline']"),
    ).toBeTruthy();
  });

  it("回放视图:竞技场画出多个单位(职业字形 + 血条)", () => {
    const { container } = render(<MatchReport source={m} />);
    fireEvent.click(screen.getByRole("button", { name: /回放/ }));
    expect(
      container.querySelector("[data-testid='rpt-replay-field']"),
    ).toBeTruthy();
    const units = container.querySelectorAll(".rpt-replay-unit");
    expect(units.length).toBeGreaterThan(1);
    // Arena redraw: every living unit carries a 2-letter class glyph + HP bar
    expect(container.querySelectorAll(".rpt-replay-glyph").length).toBe(
      units.length,
    );
    expect(container.querySelectorAll(".rpt-replay-hp-track").length).toBe(
      units.length,
    );
    expect(container.querySelector(".rpt-replay-play")).toBeTruthy();
  });

  it("战报点名字:隐藏该玩家生命曲线 + 该行变暗", () => {
    const { container } = render(<MatchReport source={m} />);
    const lines0 = container.querySelectorAll(".rpt-tl-line").length;
    expect(lines0).toBeGreaterThan(1);
    // Top player of the board (has advancedSamples → has an HP curve).
    // Solo semantics since 2026-08-05: clicking from the all-visible default
    // shows ONLY that player (everyone else hidden), not a single-unit flip.
    fireEvent.click(
      container.querySelector<HTMLButtonElement>(".rpt-meter-name")!,
    );
    expect(container.querySelectorAll(".rpt-meter-row.off").length).toBe(
      lines0 - 1,
    );
    expect(container.querySelectorAll(".rpt-tl-line").length).toBe(1);
  });

  it("回放:GCD 泳道随玩家 chip 切换列 + 共享时间光标", () => {
    const { container } = render(<MatchReport source={m} />);
    fireEvent.click(screen.getByRole("button", { name: /回放/ }));
    expect(container.querySelector(".rpt-gcd")).toBeTruthy();
    expect(container.querySelector(".rpt-gcd-cursor")).toBeTruthy();
    const chips =
      container.querySelectorAll<HTMLButtonElement>(".rpt-gcd-chip");
    expect(chips.length).toBeGreaterThan(1);
    // Chips are clustered by team (2026-08-05): a 我方 group and a 敌方 group,
    // together covering every chip, mirroring the lane divider's split.
    const friendly = container.querySelectorAll(
      "[data-testid='gcd-chips-friendly'] .rpt-gcd-chip",
    ).length;
    const enemy = container.querySelectorAll(
      "[data-testid='gcd-chips-enemy'] .rpt-gcd-chip",
    ).length;
    expect(friendly).toBeGreaterThan(0);
    expect(enemy).toBeGreaterThan(0);
    expect(friendly + enemy).toBe(chips.length);
    const cols0 = container.querySelectorAll(".rpt-gcd-col").length;
    expect(cols0).toBe(chips.length); // all selected by default
    fireEvent.click(chips[0]!); // turn off the first player's column
    expect(container.querySelectorAll(".rpt-gcd-col").length).toBe(cols0 - 1);
  });
});
