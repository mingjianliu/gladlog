// @vitest-environment jsdom
import type { IKillWindowTargetEval } from "@gladlog/analysis";
import { JUKE_LOOKBACK_MS } from "@gladlog/analysis";
import { fireEvent, render, screen } from "@testing-library/react";

import { BurstLedgerCard } from "../src/renderer/src/report/components/BurstLedgerCard";
import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import {
  deriveBurstLedger,
  type LedgerPlayer,
} from "../src/renderer/src/report/derive/burstLedger";
import { CAST_BAR_MAX_MS } from "../src/renderer/src/report/derive/castBars";
import type { StoredMatch } from "../src/renderer/src/report/derive/types";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const m = loadRealMatchFixture();

/** Inject synthetic events: a friendly Ret paladin pops AW and deals damage;
 * an enemy fake-cast bait juke's the friendly Wind Shear. */
function buildSynthetic(): StoredMatch {
  const s = JSON.parse(JSON.stringify(m)) as StoredMatch;
  const units = s.units as Record<string, any>;
  const ret = Object.values(units).find(
    (u: any) => u.info && u.reaction === "Friendly" && u.specId === 70,
  ) as any;
  const enemy = Object.values(units).find(
    (u: any) => u.info && u.reaction === "Hostile",
  ) as any;
  const t0 = s.startTime + 20_000;
  const mk = (over: any) => ({
    eventName: "SPELL_CAST_SUCCESS",
    srcId: ret.id,
    srcName: ret.name,
    destId: ret.id,
    destName: ret.name,
    ...over,
  });
  // Burst: AW goes up plus damage on the enemy inside the window
  ret.casts = [
    ...(ret.casts ?? []),
    mk({ timestamp: t0, spellId: 31884, spellName: "Avenging Wrath" }),
    // Interrupt: Wind Shear aimed at the enemy, whiffing (the enemy gets a
    // cancelled cast below → judged as juked)
    mk({
      timestamp: t0 + 5_000,
      spellId: 57994,
      spellName: "Wind Shear",
      destId: enemy.id,
      destName: enemy.name,
    }),
  ];
  ret.damageOut = [
    ...(ret.damageOut ?? []),
    {
      eventName: "SPELL_DAMAGE",
      timestamp: t0 + 2_000,
      spellId: 1,
      spellName: "Test",
      srcId: ret.id,
      srcName: ret.name,
      destId: enemy.id,
      destName: enemy.name,
      // positive on the doc side; convert negates it (effectiveAmount -
      // absorbed)
      amount: 50_000,
      effectiveAmount: 50_000,
    },
  ];
  // Enemy cast starts with no SUCCESS (cancelled) → the Wind Shear was juked
  enemy.castStarts = [
    {
      eventName: "SPELL_CAST_START",
      timestamp: t0 + 3_800,
      spellId: 116,
      spellName: "Frostbolt",
      srcId: enemy.id,
      srcName: enemy.name,
      destId: ret.id,
      destName: ret.name,
    },
  ];
  return s;
}

/** Reclassify every Hostile but the first as Friendly, leaving a single enemy
 * (below the 2-enemy threshold). */
function buildSingleEnemy(): StoredMatch {
  const s = JSON.parse(JSON.stringify(m)) as StoredMatch;
  const units = s.units as Record<string, any>;
  let seenHostile = false;
  for (const u of Object.values(units)) {
    if (u.info && u.reaction === "Hostile") {
      if (!seenHostile) {
        seenHostile = true;
        continue;
      }
      u.reaction = "Friendly";
    }
  }
  return s;
}

/** Minimal LedgerPlayer for the UI join (only targeting is filled in;
 * bursts/kicks stay empty). */
function minimalLedgerPlayer(
  windowFromSeconds: number,
  windowToSeconds: number,
): LedgerPlayer {
  return {
    unitId: "p1",
    name: "Ret-Test",
    classId: 2,
    isHealer: false,
    bursts: [],
    targeting: [
      {
        windowFromSeconds,
        windowToSeconds,
        windowTargetId: "e1",
        windowTargetName: "Warrior",
        playerDamageTotal: 100_000,
        playerDamageToTarget: 80_000,
        onTargetPct: 80,
        topOffTarget: null,
      },
    ],
    kicks: [],
  };
}

function minimalTargetEval(
  windowFromSeconds: number,
  windowToSeconds: number,
  overrides: Partial<IKillWindowTargetEval>,
): IKillWindowTargetEval {
  return {
    windowFromSeconds,
    windowToSeconds,
    focusedTarget: {
      unitId: "e1",
      playerName: "Warrior",
      playerSpec: "Arms Warrior",
      hpPercent: 90,
      defensivesAvailable: [],
      defensivesUnavailable: [],
      trinketAvailable: true,
      tier: "locked",
      wallsInHand: [],
    },
    otherTargets: [],
    betterTargetExists: false,
    ...overrides,
  };
}

describe("爆发账本(DPS D1)", () => {
  it("juke 回溯常量与读条条上限相等(共享谓词:读条无 SUCCESS 4s 内结束)", () => {
    expect(JUKE_LOOKBACK_MS).toBe(CAST_BAR_MAX_MS);
  });

  it("derive:真实 fixture 结构不变式(时间有界、比例 0–100、结果枚举合法)", () => {
    const { players, targetSelection } = deriveBurstLedger(m);
    const durS = (m.endTime - m.startTime) / 1000;
    for (const ev of targetSelection) {
      expect(ev.windowFromSeconds).toBeGreaterThanOrEqual(0);
      expect(ev.windowToSeconds).toBeGreaterThanOrEqual(ev.windowFromSeconds);
      expect(typeof ev.betterTargetExists).toBe("boolean");
    }
    for (const p of players) {
      for (const b of p.bursts) {
        expect(b.fromSeconds).toBeGreaterThanOrEqual(0);
        expect(b.toSeconds).toBeGreaterThanOrEqual(b.fromSeconds);
        expect(b.toSeconds).toBeLessThanOrEqual(durS + 0.001);
      }
      for (const w of p.targeting) {
        expect(w.onTargetPct).toBeGreaterThanOrEqual(0);
        expect(w.onTargetPct).toBeLessThanOrEqual(100);
        expect(w.playerDamageToTarget).toBeLessThanOrEqual(w.playerDamageTotal);
      }
      for (const k of p.kicks) {
        expect(["landed", "juked", "missed", "unknown"]).toContain(k.result);
      }
    }
  });

  it("derive:合成注入 —— AW 爆发有伤害归因,风剪判被假读条骗掉", () => {
    const s = buildSynthetic();
    const { players } = deriveBurstLedger(s);
    const ret = players.find((p) => p.name.startsWith("Player1"));
    expect(ret).toBeTruthy();
    const burst = ret!.bursts.find((b) =>
      b.spells.some((sp) => sp.spellId === "31884"),
    );
    expect(burst).toBeTruthy();
    expect(burst!.dominantTarget).toBeTruthy();
    expect(burst!.dominantTarget!.damage).toBeGreaterThanOrEqual(50_000);
    const kick = ret!.kicks.find((k) => k.kickSpellId === "57994");
    expect(kick?.result).toBe("juked");
    expect(kick?.jukedBySpellName).toBeTruthy();
  });

  it("UI:战报视图渲染账本卡,点 ▶ 切到回放视图", () => {
    const s = buildSynthetic();
    const { container } = render(<MatchReport source={s} matchId="t" />);
    const card = screen.getByTestId("burst-ledger");
    expect(card).toBeTruthy();
    expect(screen.getByText("爆发对齐")).toBeTruthy();
    const jump = card.querySelector(".rpt-stats-detail-jump")!;
    expect(jump).toBeTruthy();
    fireEvent.click(jump);
    expect(container.querySelector(".rpt-replay-scrub")).toBeTruthy();
  });

  it("UI:无任何账本数据时保留卡壳 + 空态文案(P1-1,功能可发现)", () => {
    const empty = JSON.parse(JSON.stringify(m)) as StoredMatch;
    for (const u of Object.values(empty.units as Record<string, any>)) {
      (u as any).casts = [];
    }
    const { container } = render(<MatchReport source={empty} matchId="t2" />);
    const card = screen.getByTestId("burst-ledger");
    expect(card).toBeTruthy();
    expect(
      container.querySelector("[data-testid=burst-ledger] .rpt-ledger-empty"),
    ).toBeTruthy();
  });

  it("derive:单敌 → targetSelection 为空数组(analyzeKillWindowTargetSelection <2 敌人门槛)", () => {
    const s = buildSingleEnemy();
    const { targetSelection } = deriveBurstLedger(s);
    expect(targetSelection).toEqual([]);
  });

  it("UI:targetSelection 按 windowFromSeconds join 到窗口目标纪律行 —— betterTargetExists → bad chip 文案", () => {
    const player = minimalLedgerPlayer(10, 20);
    const targetSelection = [
      minimalTargetEval(10, 20, {
        betterTargetExists: true,
        betterTargetName: "Mage",
        betterTargetSpec: "Frost Mage",
      }),
    ];
    render(
      <BurstLedgerCard players={[player]} targetSelection={targetSelection} />,
    );
    expect(screen.getByText(/该打 Mage/)).toBeTruthy();
    expect(screen.getByText(/Frost Mage/)).toBeTruthy();
  });

  it("UI:betterTargetExists=false → 不下任何判断(合格证已删,2026-08-18 重设计);无匹配窗口的行不出 chip", () => {
    const player = minimalLedgerPlayer(10, 20);
    const targetSelection = [minimalTargetEval(10, 20, {})];
    const { rerender } = render(
      <BurstLedgerCard players={[player]} targetSelection={targetSelection} />,
    );
    // 旧版这里渲染绿色「目标合理」—— 它与红色指控出自同一个未验证公式,已删。
    expect(screen.queryByText("目标合理")).toBeNull();
    expect(screen.queryByText(/该打/)).toBeNull();

    // Window start does not match (30 ≠ 10) → no chip, and no throw
    const noMatch = [minimalTargetEval(30, 40, {})];
    rerender(<BurstLedgerCard players={[player]} targetSelection={noMatch} />);
    expect(screen.queryByText(/该打/)).toBeNull();
  });
});
