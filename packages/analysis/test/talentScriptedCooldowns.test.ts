import { describe, expect, it } from "vitest";

import {
  EVENT_COOLDOWN_REDUCTIONS,
  eventReducedCooldownSeconds,
} from "../src/data/talentScriptedCooldowns";
import {
  applyCdModifiers,
  cdAvailableAt,
  cdSecondsUntilReady,
  warpClock,
} from "../src/utils/cooldowns";
import {
  CD_TALENT_MODIFIERS,
  PER_RANK_COOLDOWN_TALENTS,
} from "../src/utils/talentModifiers";

describe("RULED_COOLDOWN_VALUES — 静电充能每级 10 秒(用户裁 2026-09-26)", () => {
  const mods = [
    { talentSpellId: "265046", effect: "reduce_cd" as const, value: 15 },
  ];
  const at = (rank: number) =>
    applyCdModifiers(mods, 60, 1, new Set(["265046"]), new Set(), {
      talentRanks: new Map([["265046", rank]]),
    }).cooldownSeconds;
  it("1 级 −10,2 级 −20(DB2 行的 −15 被裁决值取代)", () => {
    expect(at(1)).toBe(50);
    expect(at(2)).toBe(40);
  });
});

describe("PER_RANK_COOLDOWN_TALENTS — Savagery (Takedown −15 s per rank, FT board item 1b)", () => {
  const SAVAGERY = "1251790";
  const TAKEDOWN = "1250646";
  const at = (rank: number | undefined) =>
    applyCdModifiers(
      CD_TALENT_MODIFIERS[TAKEDOWN],
      90,
      1,
      new Set(rank === undefined ? [] : [SAVAGERY]),
      new Set(),
      rank === undefined
        ? undefined
        : { talentRanks: new Map([[SAVAGERY, rank]]) },
    ).cooldownSeconds;
  it("the generated row is the DB2 −15 s on Takedown, and the talent is rank-scaled", () => {
    expect(CD_TALENT_MODIFIERS[TAKEDOWN]).toContainEqual(
      expect.objectContaining({
        talentSpellId: SAVAGERY,
        effect: "reduce_cd",
        value: 15,
      }),
    );
    expect(PER_RANK_COOLDOWN_TALENTS.has(SAVAGERY)).toBe(true);
  });
  it("90 s without it, 75 s at rank 1, 60 s at rank 2 (the corpus floor: 60.0 s)", () => {
    expect(at(undefined)).toBe(90);
    expect(at(1)).toBe(75);
    expect(at(2)).toBe(60);
  });
});

/**
 * Scripted cooldown effects (talent impact audit 2026-09-26). The ready
 * instant of an event-reduced press is the fixed point R = press + cd − s ×
 * #triggers in (press, R); "available at t" ⇔ R ≤ t, while "seconds until
 * ready at t" may only count the triggers that had happened by t (agy
 * review: the final override alone would count later bolts early).
 */
const conduit = EVENT_COOLDOWN_REDUCTIONS["1217092"]!;

describe("eventReducedCooldownSeconds — 事件减 CD 的不动点", () => {
  it("没有触发 → 原冷却", () => {
    expect(eventReducedCooldownSeconds(0, 90, [conduit], () => [])).toBe(90);
  });
  it("每次触发 −1 s,只算到(当前)就绪时刻之前的", () => {
    // 10 bolts at 10..19, ready 90 → 80
    const bolts = Array.from({ length: 10 }, (_, i) => 10 + i);
    expect(eventReducedCooldownSeconds(0, 90, [conduit], () => bolts)).toBe(80);
  });
  it("就绪之后的触发不再算", () => {
    // cd 5: bolts at 1,2,3 pull ready 5 → 2 (bolt at 3 is after ready)
    expect(eventReducedCooldownSeconds(0, 5, [conduit], () => [1, 2, 3])).toBe(
      3,
    );
  });
  it("按下之前的触发不算", () => {
    expect(eventReducedCooldownSeconds(50, 90, [conduit], () => [10, 20])).toBe(
      90,
    );
  });
});

describe("cdSecondsUntilReady — 只计 t 之前发生的减 CD", () => {
  const cast = {
    timeSeconds: 0,
    cooldownSecondsOverride: 70,
    reductions: [
      { atSeconds: 60, seconds: 10 },
      { atSeconds: 65, seconds: 10 },
    ],
  };
  const cd = { casts: [cast], cooldownSeconds: 90, neverUsed: false };
  it("t=50:之后的两次尚未发生,剩 40 s(不是 20)", () => {
    expect(cdSecondsUntilReady(cd, 50)).toBeCloseTo(40, 6);
  });
  it("t=62:第一次已发生,剩 90−10−62 = 18 s", () => {
    expect(cdSecondsUntilReady(cd, 62)).toBeCloseTo(18, 6);
  });
  it("可用判定仍按最终就绪时刻 70", () => {
    expect(cdAvailableAt(cd, 69)).toBe(false);
    expect(cdAvailableAt(cd, 70)).toBe(true);
  });
});

describe("cdAvailableAt — 免费再施放窗口(Escape from Reality)", () => {
  it("窗口内未用 → 可用;窗口过后按冷却", () => {
    const cd = {
      casts: [{ timeSeconds: 100, freeRecastUntil: 110 }],
      cooldownSeconds: 45,
      neverUsed: false,
    };
    expect(cdAvailableAt(cd, 105)).toBe(true);
    expect(cdAvailableAt(cd, 120)).toBe(false);
    expect(cdAvailableAt(cd, 145)).toBe(true);
  });
  it("免费那次按了之后,冷却仍锚在开窗那次", () => {
    const cd = {
      casts: [
        { timeSeconds: 100, freeRecastUntil: 110 },
        { timeSeconds: 103, freeRecast: true, cooldownSecondsOverride: 42 },
      ],
      cooldownSeconds: 45,
      neverUsed: false,
    };
    expect(cdAvailableAt(cd, 105)).toBe(false);
    expect(cdAvailableAt(cd, 145)).toBe(true);
  });
});

describe("warpClock — buff 期间冷却加速(batch C)", () => {
  it("×11 窗口 10 s:τ 多走 100 s", () => {
    const { tau, inverse } = warpClock([
      { fromSeconds: 20, toSeconds: 30, mult: 11 },
    ]);
    expect(tau(10)).toBe(10);
    expect(tau(30)).toBe(130);
    expect(tau(40)).toBe(140);
    expect(inverse(130)).toBeCloseTo(30, 5);
  });
  it("单层 90 s:0 按下,20–30 s 加速 ×11 → 实际 26.4 s 就好(r + 10(r−20) = 90)", () => {
    const cd = {
      casts: [{ timeSeconds: 0 }],
      cooldownSeconds: 90,
      neverUsed: false,
      rateWindows: [{ fromSeconds: 20, toSeconds: 30, mult: 11 }],
    };
    expect(cdAvailableAt(cd, 25.5)).toBe(false);
    expect(cdAvailableAt(cd, 29)).toBe(true);
  });
  it("可用判定与剩余秒数取同一时刻(codex 复现:81.4 刚按,81 时不能显示已好)", () => {
    const cd = {
      casts: [{ timeSeconds: 0 }, { timeSeconds: 81.4 }],
      cooldownSeconds: 90,
      neverUsed: false,
      rateWindows: [{ fromSeconds: 80, toSeconds: 81.4, mult: 11 }],
    };
    expect(cdAvailableAt(cd, 81)).toBe(false);
    expect(cdSecondsUntilReady(cd, 81)).toBeGreaterThan(80);
  });
  it("剩余秒数不预支未来的窗口", () => {
    const cd = {
      casts: [{ timeSeconds: 0 }],
      cooldownSeconds: 90,
      neverUsed: false,
      rateWindows: [{ fromSeconds: 50, toSeconds: 60, mult: 11 }],
    };
    expect(cdSecondsUntilReady(cd, 40)).toBeCloseTo(50, 6);
  });
});
