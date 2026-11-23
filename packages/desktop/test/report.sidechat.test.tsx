// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const base = loadRealMatchFixture();

/** Same recipe as report.deathrecap.test: the trimmed fixture has no player
 * deaths, so clone it and inject one (at the victim's last damage taken) to
 * make a ✕ marker clickable. */
function withInjectedDeath() {
  const m = JSON.parse(JSON.stringify(base)) as typeof base;
  const players = Object.values(m.units).filter(
    (u) =>
      u.kind === "Player" && (u as { damageIn?: unknown[] }).damageIn?.length,
  ) as unknown as Array<{
    id: string;
    name: string;
    damageIn: Array<{ timestamp: number }>;
    deaths: Array<Record<string, unknown>>;
  }>;
  players.sort((a, b) => b.damageIn.length - a.damageIn.length);
  const victim = players[0]!;
  const t = Math.max(...victim.damageIn.map((d) => d.timestamp));
  victim.deaths.push({
    timestamp: t,
    eventName: "UNIT_DIED",
    spellId: 0,
    spellName: "",
    srcId: "",
    srcName: "",
    destId: victim.id,
    destName: victim.name,
    unconscious: false,
  });
  return m;
}

beforeEach(() => {
  (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
    settings: {
      get: vi.fn().mockResolvedValue({ language: "zh" }),
      save: vi.fn().mockResolvedValue({}),
    },
    analysis: {
      getState: vi.fn().mockResolvedValue({ cached: null, running: false }),
      getCached: vi.fn().mockResolvedValue(null),
    },
    compare: {
      getState: vi.fn().mockResolvedValue(null),
      getCached: vi.fn().mockResolvedValue(null),
      run: vi.fn(),
      cancel: vi.fn(),
      onDelta: () => () => {},
      onDone: () => () => {},
      onError: () => () => {},
    },
    chat: {
      getState: vi.fn().mockResolvedValue({
        status: "ready",
        backend: "claudeCli",
        model: "opus",
        messages: [],
        busy: false,
      }),
      send: vi.fn(),
      cancel: vi.fn(),
    },
  };
});

const paneHidden = (testid: string): boolean =>
  (screen.getByTestId(testid) as HTMLElement).hidden;

describe("战报右侧栏:问教练 tab(2026-08-04)", () => {
  it("默认在回顾 tab:占位可见,聊天 pane hidden", () => {
    render(<MatchReport source={base} matchId="m1" />);
    expect(screen.getByText("点击曲线上的 ✕ 查看死亡回顾")).toBeTruthy();
    expect(paneHidden("side-pane-recap")).toBe(false);
    expect(paneHidden("side-pane-chat")).toBe(true);
  });

  it("点问教练 → 聊天 pane 显示、聊天卡挂载;回顾 pane hidden", async () => {
    render(<MatchReport source={base} matchId="m1" />);
    fireEvent.click(screen.getByTestId("side-tab-chat"));
    expect(paneHidden("side-pane-chat")).toBe(false);
    expect(paneHidden("side-pane-recap")).toBe(true);
    // The chat card really mounted (ready state renders the input box)
    expect(await screen.findByPlaceholderText(/问教练/)).toBeTruthy();
  });

  it("切走再切回,聊天草稿不丢(hidden 而非卸载)", async () => {
    render(<MatchReport source={base} matchId="m1" />);
    fireEvent.click(screen.getByTestId("side-tab-chat"));
    const box = (await screen.findByPlaceholderText(/问教练/)) as
      HTMLTextAreaElement | HTMLInputElement;
    fireEvent.change(box, { target: { value: "为什么 0:36 掉血那么快" } });
    fireEvent.click(screen.getByTestId("side-tab-recap"));
    fireEvent.click(screen.getByTestId("side-tab-chat"));
    expect(
      (screen.getByPlaceholderText(/问教练/) as HTMLTextAreaElement).value,
    ).toBe("为什么 0:36 掉血那么快");
  });

  it("停在问教练时点曲线 ✕ → 自动切回回顾并显示死亡回顾", () => {
    const m = withInjectedDeath();
    const { container } = render(<MatchReport source={m} matchId="m1" />);
    fireEvent.click(screen.getByTestId("side-tab-chat"));
    expect(paneHidden("side-pane-recap")).toBe(true);
    const marker = container.querySelector(".rpt-tl-death-click");
    expect(marker).toBeTruthy();
    fireEvent.click(marker!);
    expect(paneHidden("side-pane-recap")).toBe(false);
    expect(paneHidden("side-pane-chat")).toBe(true);
    expect(container.querySelector(".rpt-recap-placeholder")).toBeNull();
  });
});
