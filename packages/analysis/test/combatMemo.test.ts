import type { ICombatUnit } from "@gladlog/parser-compat";
import { LogEvent } from "@gladlog/parser-compat";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  breakAbilityPresses,
  breakAbilityPressesUncached,
} from "../src/utils/ccTrinketAnalysis";
import {
  combatMemo,
  roundFingerprint,
  setCombatMemoEnabledForTest,
  unitMemo,
  unitTokens,
} from "../src/utils/combatMemo";
import { getUnitPositionAtTime } from "../src/utils/losAnalysis";
import {
  ADAPTATION_LOCKOUT_AURA_ID,
  ADAPTATION_TRIGGER_AURA_ID,
  MEDALLION_SPELL_ID,
  pvpTrinketUses,
  pvpTrinketUsesUncached,
} from "../src/utils/pvpTrinketUses";

// T81 (first-paint growers): three readings are computed once instead of once
// per caller / per control / by a linear scan. Performance only — each must
// stay the reading it replaced, value for value.

/** deterministic LCG, so a failure reproduces */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

afterEach(() => setCombatMemoEnabledForTest(true));

describe("combatMemo", () => {
  const combatOf = (units: object[]) => ({
    startTime: 1000,
    endTime: 91_000,
    units: Object.fromEntries(units.map((u, i) => [`u${i}`, u])),
  });
  const unit = (n: number) => ({ id: "x", auraEvents: new Array(n).fill(0) });

  it("同一回合对象 + 同一组单位只算一次;每个调用方拿到自己的数组", () => {
    const [a, b] = [unit(3), unit(4)];
    const combat = combatOf([a, b]);
    const compute = vi.fn(() => [{ v: 1 }]);
    const call = () =>
      combatMemo(
        combat,
        `k|${unitTokens([a])}|${unitTokens([b])}`,
        roundFingerprint(combat, [a], [b]),
        compute,
      );
    const first = call();
    const second = call();
    expect(compute).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    second.push({ v: 2 });
    expect(call()).toHaveLength(1);
  });

  it("两边对调、换了一个同 id 的单位对象,都是另一条", () => {
    const [a, b] = [unit(3), unit(3)];
    const combat = combatOf([a, b]);
    const compute = vi.fn(() => [0]);
    const call = (x: object[], y: object[]) =>
      combatMemo(
        combat,
        `k|${unitTokens(x)}|${unitTokens(y)}`,
        roundFingerprint(combat, x, y),
        compute,
      );
    call([a], [b]);
    call([b], [a]);
    expect(compute).toHaveBeenCalledTimes(2);
    call([{ ...a }], [b]); // same id, same lengths, another object
    expect(compute).toHaveBeenCalledTimes(3);
    call([a], [b]);
    expect(compute).toHaveBeenCalledTimes(3);
  });

  it("回合里任何单位的事件数组变长、或回合边界变了 → 重算", () => {
    const [a, b, pet] = [unit(3), unit(3), unit(1)];
    const combat = combatOf([a, b, pet]);
    const compute = vi.fn(() => [0]);
    const call = () =>
      combatMemo(combat, "k", roundFingerprint(combat, [a], [b]), compute);
    call();
    pet.auraEvents.push(0); // a unit that is not an argument
    call();
    expect(compute).toHaveBeenCalledTimes(2);
    combat.endTime += 1;
    call();
    expect(compute).toHaveBeenCalledTimes(3);
    call();
    expect(compute).toHaveBeenCalledTimes(3);
  });

  it("关掉以后每次都算(测试开关)", () => {
    const combat = combatOf([]);
    const compute = vi.fn(() => [0]);
    setCombatMemoEnabledForTest(false);
    combatMemo(combat, "k", 1, compute);
    combatMemo(combat, "k", 1, compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("unitMemo:按单位对象记,数组变长或 id 变了就重算", () => {
    const u = { id: "p1", casts: [1, 2] };
    const compute = vi.fn(() => [u.casts.length]);
    expect(unitMemo(u, "k", compute)).toEqual([2]);
    expect(unitMemo(u, "k", compute)).toEqual([2]);
    expect(compute).toHaveBeenCalledTimes(1);
    u.casts.push(3);
    expect(unitMemo(u, "k", compute)).toEqual([3]);
    u.id = "p2";
    unitMemo(u, "k", compute);
    expect(compute).toHaveBeenCalledTimes(3);
    expect(unitMemo(u, "other", compute)).toEqual([3]);
    expect(compute).toHaveBeenCalledTimes(4);
  });
});

describe("按键 / 饰品读数:记住的与现算的逐值相等", () => {
  const SELF = "Player-1";
  const BREAK_IDS = ["59752", "7744", "20594", MEDALLION_SPELL_ID, "999"];
  const AURA_IDS = [
    MEDALLION_SPELL_ID,
    ADAPTATION_TRIGGER_AURA_ID,
    ADAPTATION_LOCKOUT_AURA_ID,
    "59752",
    "7744",
  ];
  const randomUnit = (r: () => number): ICombatUnit =>
    ({
      id: SELF,
      spellCastEvents: Array.from({ length: 40 }, () => ({
        spellId: BREAK_IDS[Math.floor(r() * BREAK_IDS.length)],
        logLine: {
          event:
            r() < 0.8
              ? LogEvent.SPELL_CAST_SUCCESS
              : LogEvent.SPELL_CAST_START,
          timestamp: 1000 + Math.floor(r() * 60_000),
        },
      })),
      auraEvents: Array.from({ length: 60 }, () => ({
        spellId: AURA_IDS[Math.floor(r() * AURA_IDS.length)],
        srcUnitId: r() < 0.8 ? SELF : "Player-2",
        destUnitId: r() < 0.8 ? SELF : "Player-2",
        logLine: {
          event:
            r() < 0.6
              ? LogEvent.SPELL_AURA_APPLIED
              : LogEvent.SPELL_AURA_REMOVED,
          timestamp: 1000 + Math.floor(r() * 60_000),
        },
      })),
    }) as unknown as ICombatUnit;

  it("200 个随机单位:两个读数各调三次都等于现算;往单位里追加事件后仍相等", () => {
    const r = rng(81);
    let nonEmpty = 0;
    for (let i = 0; i < 200; i++) {
      const u = randomUnit(r);
      for (let k = 0; k < 3; k++) {
        expect(pvpTrinketUses(u)).toEqual(pvpTrinketUsesUncached(u));
        expect(breakAbilityPresses(u)).toEqual(breakAbilityPressesUncached(u));
      }
      if (pvpTrinketUses(u).length + breakAbilityPresses(u).length > 0)
        nonEmpty++;
      const more = randomUnit(r);
      u.spellCastEvents.push(...more.spellCastEvents.slice(0, 5));
      u.auraEvents.push(...more.auraEvents.slice(0, 5));
      expect(pvpTrinketUses(u)).toEqual(pvpTrinketUsesUncached(u));
      expect(breakAbilityPresses(u)).toEqual(breakAbilityPressesUncached(u));
    }
    expect(nonEmpty).toBeGreaterThan(150);
  });
});

describe("getUnitPositionAtTime:二分起点与线性扫描逐值相等", () => {
  type Sample = {
    timestamp: number;
    advancedActorPositionX: number;
    advancedActorPositionY: number;
  };
  /** the scan `getUnitPositionAtTime` was until T81 */
  function plain(actions: Sample[], t: number, maxGapMs?: number) {
    if (actions.length === 0) return null;
    if (t < actions[0]!.timestamp) return null;
    const last = actions[actions.length - 1]!;
    if (t >= last.timestamp) {
      if (maxGapMs !== undefined && t - last.timestamp > maxGapMs) return null;
      return { x: last.advancedActorPositionX, y: last.advancedActorPositionY };
    }
    for (let i = 0; i < actions.length - 1; i++) {
      const curr = actions[i]!;
      const next = actions[i + 1]!;
      if (curr.timestamp <= t && next.timestamp > t) {
        if (
          maxGapMs !== undefined &&
          Math.min(t - curr.timestamp, next.timestamp - t) > maxGapMs
        )
          return null;
        const f = (t - curr.timestamp) / (next.timestamp - curr.timestamp);
        return {
          x:
            curr.advancedActorPositionX +
            (next.advancedActorPositionX - curr.advancedActorPositionX) * f,
          y:
            curr.advancedActorPositionY +
            (next.advancedActorPositionY - curr.advancedActorPositionY) * f,
        };
      }
    }
    return null;
  }

  it("随机流(有序含重复时刻 / 乱序 / 含 NaN)× 随机时刻 × 三种 maxGap", () => {
    const r = rng(8102);
    let checked = 0;
    let hits = 0;
    for (let round = 0; round < 300; round++) {
      const n = Math.floor(r() * 40);
      const kind = round % 3; // 0 ordered with ties, 1 shuffled, 2 ordered + a NaN
      let ts = Array.from({ length: n }, () => 1000 + Math.floor(r() * 50) * 100);
      if (kind !== 1) ts = ts.sort((a, b) => a - b);
      if (kind === 2 && n > 2) ts[Math.floor(r() * n)] = Number.NaN;
      const actions: Sample[] = ts.map((timestamp) => ({
        timestamp,
        advancedActorPositionX: r() * 100,
        advancedActorPositionY: r() * 100,
      }));
      const unit = { advancedActions: actions } as unknown as ICombatUnit;
      for (let q = 0; q < 60; q++) {
        const t =
          q === 0 ? Number.NaN : 900 + Math.floor(r() * 5300) + (q % 2) * 0.5;
        for (const gap of [undefined, 150, 2000]) {
          const got = getUnitPositionAtTime(unit, t, gap);
          expect(got).toEqual(plain(actions, t, gap));
          checked++;
          if (got) hits++;
        }
      }
      // a sample appended in place (the order cache is per length)
      actions.push({
        timestamp: 500,
        advancedActorPositionX: 1,
        advancedActorPositionY: 2,
      });
      for (const t of [450, 500, 1500, 3000, 7000])
        expect(getUnitPositionAtTime(unit, t)).toEqual(plain(actions, t));
    }
    expect(checked).toBe(300 * 60 * 3);
    expect(hits).toBeGreaterThan(10_000);
  });
});
