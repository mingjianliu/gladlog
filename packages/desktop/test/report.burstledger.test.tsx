// @vitest-environment jsdom
import { JUKE_LOOKBACK_MS } from "@gladlog/analysis";
import { fireEvent, render, screen } from "@testing-library/react";

import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import { deriveBurstLedger } from "../src/renderer/src/report/derive/burstLedger";
import { CAST_BAR_MAX_MS } from "../src/renderer/src/report/derive/castBars";
import type { StoredMatch } from "../src/renderer/src/report/derive/types";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const m = loadRealMatchFixture();

/** 注入合成事件:友方惩戒骑开 AW + 打伤害;敌方假读条骗掉友方风剪。 */
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
  // 爆发:AW 开启 + 窗口内对敌方的伤害
  ret.casts = [
    ...(ret.casts ?? []),
    mk({ timestamp: t0, spellId: 31884, spellName: "Avenging Wrath" }),
    // 打断:风剪指向敌方,落空(下面给敌方一条被取消的读条 → 判被骗)
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
      // doc 侧为正数,convert 取负(effectiveAmount - absorbed)
      amount: 50_000,
      effectiveAmount: 50_000,
    },
  ];
  // 敌方读条开始、无 SUCCESS(取消)→ 风剪被骗
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

describe("爆发账本(DPS D1)", () => {
  it("juke 回溯常量与读条条上限相等(共享谓词:读条无 SUCCESS 4s 内结束)", () => {
    expect(JUKE_LOOKBACK_MS).toBe(CAST_BAR_MAX_MS);
  });

  it("derive:真实 fixture 结构不变式(时间有界、比例 0–100、结果枚举合法)", () => {
    const players = deriveBurstLedger(m);
    const durS = (m.endTime - m.startTime) / 1000;
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
    const players = deriveBurstLedger(s);
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

  it("UI:无任何账本数据时不渲染卡(空数组防御)", () => {
    const empty = JSON.parse(JSON.stringify(m)) as StoredMatch;
    for (const u of Object.values(empty.units as Record<string, any>)) {
      (u as any).casts = [];
    }
    render(<MatchReport source={empty} matchId="t2" />);
    expect(screen.queryByTestId("burst-ledger")).toBeNull();
  });
});
