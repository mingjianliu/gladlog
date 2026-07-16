// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";

import { DeathRecapCard } from "../src/renderer/src/report/components/DeathRecapCard";
import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import { deriveDeathRecaps } from "../src/renderer/src/report/derive/deathRecap";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const base = loadRealMatchFixture();

// fixture 裁剪到前 90s,没有玩家死亡(唯一 death 是 NPC)——克隆并给承伤最多的
// 玩家注入一次死亡(时刻取其最后一次承伤),走真实转换/判定管线。
function withInjectedDeath() {
  const m = JSON.parse(JSON.stringify(base)) as typeof base;
  const players = Object.values(m.units).filter(
    (u) => u.kind === "Player" && (u as { damageIn?: unknown[] }).damageIn?.length,
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
  return { m, victim, deathTMs: t };
}

const { m, victim } = withInjectedDeath();

describe("死亡回顾(backlog #6)", () => {
  it("deriveDeathRecaps:真实 fixture 出 1 条回顾,事件升序且含承伤", () => {
    const recaps = deriveDeathRecaps(m);
    expect(recaps.length).toBeGreaterThanOrEqual(1);
    const r = recaps[0]!;
    expect(r.deathS).toBeGreaterThan(0);
    for (let i = 1; i < r.events.length; i++) {
      expect(r.events[i]!.tS).toBeGreaterThanOrEqual(r.events[i - 1]!.tS);
    }
    // 死前窗口内必有伤害事件(死总得有原因)
    expect(r.events.some((e) => e.kind === "dmg")).toBe(true);
    // 事件都在窗口内
    for (const e of r.events) {
      expect(e.tS).toBeLessThanOrEqual(r.deathS + 0.001);
      expect(e.tS).toBeGreaterThanOrEqual(r.deathS - 10.001);
    }
  });

  it("DeathRecapCard:渲染标题/事件行;回放此刻回调带死者名", () => {
    const recaps = deriveDeathRecaps(m);
    const jumped: Array<[number, string[]]> = [];
    render(
      <DeathRecapCard
        recap={recaps[0]!}
        onClose={() => {}}
        onJump={(t, names) => jumped.push([t, names])}
      />,
    );
    expect(screen.getByText(/死亡回顾 —/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /回放此刻/ }));
    expect(jumped.length).toBe(1);
    expect(jumped[0]![1]).toEqual([victim.name]);
    expect(jumped[0]![0]).toBeCloseTo(Math.max(0, recaps[0]!.deathS - 8), 3);
  });

  it("战报视图:点死亡标记打开回顾卡,✕ 关闭", () => {
    const { container } = render(<MatchReport source={m} matchId="t" />);
    const marker = container.querySelector(".rpt-tl-death-click");
    expect(marker).toBeTruthy();
    fireEvent.click(marker!);
    expect(screen.getByTestId("death-recap")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "✕" }));
    expect(screen.queryByTestId("death-recap")).toBeNull();
  });
});

describe("回放视图死亡回顾入口(#6 v2)", () => {
  it("scrub 到死亡后点 ✕ → 回顾卡打开(回放视图内)", () => {
    const { container } = render(<MatchReport source={m} matchId="t" />);
    fireEvent.click(screen.getByRole("button", { name: "回放" }));
    // scrub 到末尾让阵亡残影出现
    const scrub = container.querySelector(
      ".rpt-replay-scrub",
    ) as HTMLInputElement;
    fireEvent.change(scrub, { target: { value: scrub.max } });
    const ghost = container.querySelector(".rpt-replay-ghost-click");
    expect(ghost).toBeTruthy();
    fireEvent.click(ghost!);
    expect(screen.getByTestId("death-recap")).toBeTruthy();
    // 关闭后仍在回放视图
    fireEvent.click(screen.getByRole("button", { name: "✕" }));
    expect(screen.queryByTestId("death-recap")).toBeNull();
    expect(container.querySelector(".rpt-replay-scrub")).toBeTruthy();
  });
});
