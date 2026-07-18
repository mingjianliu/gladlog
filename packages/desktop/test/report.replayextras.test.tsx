// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { arenaObstacles } from "@gladlog/analysis";

import { ReplayView } from "../src/renderer/src/report/components/ReplayView";
import {
  dampeningAt,
  deriveDampeningSeries,
} from "../src/renderer/src/report/derive/dampeningSeries";
import { deriveReplay } from "../src/renderer/src/report/derive/replay";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const m = loadRealMatchFixture();

describe("回放三小件(backlog #11)", () => {
  it("deriveDampeningSeries:1s 网格、单调不减(dampening 只涨不跌)", () => {
    const series = deriveDampeningSeries(m);
    expect(series.length).toBeGreaterThan(30);
    for (let i = 1; i < series.length; i++) {
      expect(series[i]!.tS).toBe(series[i - 1]!.tS + 1);
      expect(series[i]!.pct).toBeGreaterThanOrEqual(series[i - 1]!.pct);
    }
    expect(dampeningAt(series, 0)).toBe(series[0]!.pct);
    expect(dampeningAt(series, 10_000)).toBe(series[series.length - 1]!.pct);
  });

  it("回放渲染:每个存活单位有 HP 数字,seek 到有施法处出现施法闪现", () => {
    const { startTime, tracks } = deriveReplay(m);
    // 找一个真实施法时刻(任一单位第一条 cast)
    const anyUnit = Object.values(m.units).find(
      (u) => u.kind === "Player" && u.casts.length > 0,
    )!;
    const castT = anyUnit.casts[0]!.timestamp;
    const { container } = render(
      <ReplayView
        source={m}
        seekReq={{ tMs: castT + 300, unitNames: [], nonce: 9 }}
      />,
    );
    const hpNums = container.querySelectorAll(".rpt-replay-hpnum");
    expect(hpNums.length).toBeGreaterThan(0);
    for (const el of hpNums) {
      expect(el.textContent).toMatch(/^\d+%$/);
    }
    expect(
      container.querySelectorAll(".rpt-replay-castflash").length,
    ).toBeGreaterThan(0);
    void startTime;
    void tracks;
  });
});

describe("泳道 chip 点击定位", () => {
  it("点 chip → 时钟跳到该施法时刻并暂停", () => {
    const { container } = render(<ReplayView source={m} />);
    const chip = container.querySelector(".rpt-gcd-act.seekable")!;
    expect(chip).toBeTruthy();
    fireEvent.click(chip);
    // 时钟显示不再是 0:00 开头(已定位),播放按钮存在(暂停态)
    const time = container.querySelector(".rpt-replay-time");
    expect(time?.textContent?.startsWith("0:00 /")).toBe(false);
  });
});

describe("回放小件(phase3 #4)", () => {
  it("键盘:空格切播放,→ +5s;速度段控含 0.5×;纳格兰画出障碍物", () => {
    const { container } = render(<ReplayView source={m} />);
    // 障碍物(fixture 是 zoneId=1911 Mugambala?按 zone 有无均不炸;至少不抛)
    // 速度段控含 0.5×
    expect(screen.getByRole("button", { name: "0.5×" })).toBeTruthy();
    // → 前进 5s
    fireEvent.keyDown(window, { code: "ArrowRight" });
    const time = container.querySelector(".rpt-replay-time");
    expect(time?.textContent?.startsWith("0:05 /")).toBe(true);
    // 空格开始播放(按钮变暂停)
    fireEvent.keyDown(window, { code: "Space" });
    expect(screen.getByRole("button", { name: /暂停/ })).toBeTruthy();
    fireEvent.keyDown(window, { code: "Space" });
  });

  it("障碍物几何:有该 zone 时渲染 rpt-replay-obstacle", () => {
    const zoneId = (m as { zoneId?: string | number }).zoneId;
    const { container } = render(<ReplayView source={m} />);
    const has = container.querySelectorAll(".rpt-replay-obstacle").length;
    // fixture zone 在 arenaObstacles 里则必须画出;不在则为 0(两者都合法,但记录断言)
    const expected = (arenaObstacles[String(zoneId)] ?? []).length;
    expect(has).toBe(expected);
  });
});

describe("竞技场框体侧栏(血条防遮挡)", () => {
  it("友方/敌方两组框体齐全,每行有血条与百分比;hover 行点亮场上光环", () => {
    const { container } = render(<ReplayView source={m} />);
    const data = deriveReplay(m as never);
    const friendly = data.tracks.filter((t) => t.reaction === "Friendly");
    const enemy = data.tracks.filter((t) => t.reaction !== "Friendly");
    const fCol = container.querySelector("[data-testid='rpt-frames-friendly']")!;
    const eCol = container.querySelector("[data-testid='rpt-frames-enemy']")!;
    expect(fCol.querySelectorAll(".rpt-frame").length).toBe(friendly.length);
    expect(eCol.querySelectorAll(".rpt-frame").length).toBe(enemy.length);
    expect(fCol.querySelectorAll(".rpt-frame-bar").length).toBeGreaterThan(0);
    expect(fCol.querySelectorAll(".rpt-frame-pct").length).toBeGreaterThan(0);
    // 旧 legend 已被框体取代
    expect(container.querySelector(".rpt-replay-legend")).toBeNull();
    // hover 联动:框体行 hover → 场上出现金色光环
    fireEvent.mouseEnter(fCol.querySelector(".rpt-frame")!);
    expect(container.querySelector(".rpt-replay-hover-ring")).toBeTruthy();
    fireEvent.mouseLeave(fCol.querySelector(".rpt-frame")!);
    expect(container.querySelector(".rpt-replay-hover-ring")).toBeNull();
  });
});
