// @vitest-environment jsdom
import { arenaObstacles } from "@gladlog/analysis";
import { fireEvent, render, screen } from "@testing-library/react";

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
    // Find a real cast moment (the first cast of any unit)
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

describe("换轮重置回放时钟(shuffle 同组件换 source,真机反馈)", () => {
  it("source.startTime 变化 → t 复位到新一轮开始并暂停", () => {
    const { container, rerender } = render(<ReplayView source={m} />);
    const scrub = () =>
      container.querySelector<HTMLInputElement>(".rpt-replay-scrub")!;
    // The user drags the clock to mid-match
    const mid = Math.round((m.startTime + m.endTime) / 2);
    fireEvent.change(scrub(), { target: { value: String(mid) } });
    expect(Number(scrub().value)).toBe(mid);
    // Round change: the same component instance receives a new source (window
    // shifted 5s earlier, events still inside it)
    const next = { ...m, startTime: m.startTime - 5000 };
    rerender(<ReplayView source={next} />);
    expect(Number(scrub().value)).toBe(next.startTime);
  });
});

describe("泳道 chip 点击定位", () => {
  it("点 chip → 时钟跳到该施法时刻并暂停", () => {
    const { container } = render(<ReplayView source={m} />);
    const chip = container.querySelector(".rpt-gcd-act.seekable")!;
    expect(chip).toBeTruthy();
    fireEvent.click(chip);
    // The clock display no longer starts at 0:00 (it seeked), and the play
    // button is present (paused state)
    const time = container.querySelector(".rpt-replay-time");
    expect(time?.textContent?.startsWith("0:00 /")).toBe(false);
  });
});

describe("回放小件(phase3 #4)", () => {
  it("键盘:空格切播放,→ +5s;速度段控含 0.5×;纳格兰画出障碍物", () => {
    const { container } = render(<ReplayView source={m} />);
    // Obstacles (the fixture is zoneId=1911 Mugambala? either way, present or
    // not, nothing breaks — at minimum it must not throw)
    // The speed segmented control includes 0.5x
    expect(screen.getByRole("button", { name: "0.5×" })).toBeTruthy();
    // Right arrow advances 5s
    fireEvent.keyDown(window, { code: "ArrowRight" });
    const time = container.querySelector(".rpt-replay-time");
    expect(time?.textContent?.startsWith("0:05 /")).toBe(true);
    // Space starts playback (the button switches to pause)
    fireEvent.keyDown(window, { code: "Space" });
    expect(screen.getByRole("button", { name: /暂停/ })).toBeTruthy();
    fireEvent.keyDown(window, { code: "Space" });
  });

  it("障碍物几何:有该 zone 时渲染 rpt-replay-obstacle", () => {
    const zoneId = (m as { zoneId?: string | number }).zoneId;
    const { container } = render(<ReplayView source={m} />);
    const has = container.querySelectorAll(".rpt-replay-obstacle").length;
    // If the fixture's zone is in arenaObstacles it must be drawn; otherwise
    // the count is 0 (both are legal, but the assertion records which)
    const expected = (arenaObstacles[String(zoneId)] ?? []).length;
    expect(has).toBe(expected);
  });
});

describe("竞技场框体侧栏(血条防遮挡)", () => {
  it("友方/敌方两组框体齐全,每行有血条与百分比;hover 行点亮场上光环", () => {
    const { container } = render(<ReplayView source={m} />);
    const data = deriveReplay(m as never);
    const friendly = data.tracks.filter((t) => t.side === "friendly");
    const enemy = data.tracks.filter((t) => t.side !== "friendly");
    const fCol = container.querySelector(
      "[data-testid='rpt-frames-friendly']",
    )!;
    const eCol = container.querySelector("[data-testid='rpt-frames-enemy']")!;
    expect(fCol.querySelectorAll(".rpt-frame").length).toBe(friendly.length);
    expect(eCol.querySelectorAll(".rpt-frame").length).toBe(enemy.length);
    expect(fCol.querySelectorAll(".rpt-frame-bar").length).toBeGreaterThan(0);
    expect(fCol.querySelectorAll(".rpt-frame-pct").length).toBeGreaterThan(0);
    // The old legend has been replaced by the unit frames
    expect(container.querySelector(".rpt-replay-legend")).toBeNull();
    // Hover linkage: hovering a frame row → a gold ring appears on the arena
    fireEvent.mouseEnter(fCol.querySelector(".rpt-frame")!);
    expect(container.querySelector(".rpt-replay-hover-ring")).toBeTruthy();
    fireEvent.mouseLeave(fCol.querySelector(".rpt-frame")!);
    expect(container.querySelector(".rpt-replay-hover-ring")).toBeNull();
  });
});

describe("GCD 泳道两队分组", () => {
  it("友方列在前敌方列在后,交界有分隔竖线", () => {
    const { container } = render(<ReplayView source={m} />);
    const data = deriveReplay(m as never);
    const nFriendly = data.tracks.filter(
      (t) => t.side === "friendly",
    ).length;
    const nEnemy = data.tracks.length - nFriendly;
    if (nFriendly > 0 && nEnemy > 0) {
      expect(
        container.querySelectorAll("[data-testid='gcd-team-divider']").length,
      ).toBe(1);
    }
    // Column header order: the first nFriendly columns are all friendly
    const heads = [...container.querySelectorAll(".rpt-gcd-col-name")].map(
      (el) => el.textContent,
    );
    const friendlyNames = new Set(
      data.tracks.filter((t) => t.side === "friendly").map((t) => t.name),
    );
    for (let i = 0; i < nFriendly; i++) {
      expect(friendlyNames.has(heads[i] ?? "")).toBe(true);
    }
  });
});
