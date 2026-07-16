// @vitest-environment jsdom
import { render } from "@testing-library/react";

import { ReplayView } from "../src/renderer/src/report/components/ReplayView";
import {
  deriveBurstAuras,
  deriveFocusFire,
} from "../src/renderer/src/report/derive/replayHighlights";
import type { StoredMatch } from "../src/renderer/src/report/derive/types";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const m = loadRealMatchFixture();

/** 敌方开 AW(t0)+ 己方两人同秒(t0+2s)打该敌方。 */
function buildSynthetic(): {
  s: StoredMatch;
  enemyId: string;
  t0: number;
} {
  const s = JSON.parse(JSON.stringify(m)) as StoredMatch;
  const units = s.units as Record<string, any>;
  const friends = Object.values(units).filter(
    (u: any) => u.info && u.reaction === "Friendly",
  ) as any[];
  const enemy = Object.values(units).find(
    (u: any) => u.info && u.reaction === "Hostile",
  ) as any;
  const t0 = s.startTime + 20_000;

  enemy.casts = [
    ...(enemy.casts ?? []),
    {
      eventName: "SPELL_CAST_SUCCESS",
      timestamp: t0,
      spellId: 31884,
      spellName: "Avenging Wrath",
      srcId: enemy.id,
      srcName: enemy.name,
      destId: enemy.id,
      destName: enemy.name,
    },
  ];
  // 清空真实伤害再注入,保证秒网格确定性:
  // 同秒双人(t0+2000/t0+2400)= 集火;t0+7s 单人 = 不算
  enemy.damageIn = [
    {
      eventName: "SPELL_DAMAGE",
      timestamp: t0 + 7_000,
      spellId: 1,
      spellName: "Test",
      srcId: friends[0].id,
      srcName: friends[0].name,
      destId: enemy.id,
      destName: enemy.name,
      amount: 10_000,
      effectiveAmount: 10_000,
    },
    ...[friends[0], friends[1]].map((f: any, i: number) => ({
      eventName: "SPELL_DAMAGE",
      timestamp: t0 + 2_000 + i * 400,
      spellId: 1,
      spellName: "Test",
      srcId: f.id,
      srcName: f.name,
      destId: enemy.id,
      destName: enemy.name,
      amount: 10_000,
      effectiveAmount: 10_000,
    })),
  ];
  return { s, enemyId: enemy.id, t0 };
}

describe("回放爆发红光 + 同秒集火(DPS D1)", () => {
  it("deriveBurstAuras:敌方 AW 产生 active 区间(span = 账本同谓词)", () => {
    const { s, enemyId, t0 } = buildSynthetic();
    const auras = deriveBurstAuras(s);
    const spans = auras[enemyId] ?? [];
    const hit = spans.find((sp) => sp.fromMs === t0);
    expect(hit).toBeTruthy();
    // AW buff 20s → 区间至少盖到 t0+10s(最短 span)以上
    expect(hit!.toMs).toBeGreaterThanOrEqual(t0 + 10_000);
    expect(hit!.spellName).toBe("Avenging Wrath");
  });

  it("deriveFocusFire:两人同秒打同一目标 → 该秒计 2;单人不计", () => {
    const { s, enemyId, t0 } = buildSynthetic();
    const ff = deriveFocusFire(s);
    const sec = Math.floor((t0 + 2_000 - s.startTime) / 1000);
    expect(ff[enemyId]?.[sec]).toBe(2);
    // t0+7s 只有单人打击 → 不算集火
    expect(ff[enemyId]?.[sec + 5]).toBeUndefined();
  });

  it("真实 fixture:结构不变式(秒非负、计数 ≥2、区间正向)", () => {
    const auras = deriveBurstAuras(m);
    for (const spans of Object.values(auras)) {
      for (const sp of spans) {
        expect(sp.toMs).toBeGreaterThan(sp.fromMs);
      }
    }
    const ff = deriveFocusFire(m);
    for (const bySec of Object.values(ff)) {
      for (const [sec, n] of Object.entries(bySec)) {
        expect(Number(sec)).toBeGreaterThanOrEqual(0);
        expect(n).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("UI:seek 到爆发时刻 → 红光环出现;seek 到集火秒 → 集火环出现", () => {
    const { s, t0 } = buildSynthetic();
    const { container } = render(
      <ReplayView
        source={s}
        seekReq={{ tMs: t0 + 2_100, unitNames: [], nonce: 1 }}
      />,
    );
    expect(container.querySelector(".rpt-replay-burst-ring")).toBeTruthy();
    expect(container.querySelector(".rpt-replay-focus-ring")).toBeTruthy();
  });

  it("UI:无爆发/集火的时刻两个环都不渲染", () => {
    const { container } = render(
      <ReplayView
        source={m}
        seekReq={{ tMs: m.startTime, unitNames: [], nonce: 1 }}
      />,
    );
    // fixture 开场第 0 秒没有进攻 CD 也没有集火
    expect(container.querySelector(".rpt-replay-burst-ring")).toBeNull();
    expect(container.querySelector(".rpt-replay-focus-ring")).toBeNull();
  });
});
