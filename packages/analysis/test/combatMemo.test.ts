import type { ICombatUnit } from "@gladlog/parser-compat";
import { LogEvent } from "@gladlog/parser-compat";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CANDIDATE_TYPE_FLAGS } from "../src/data/candidateTypeFlags";
import {
  breakAbilityPresses,
  breakAbilityPressesUncached,
} from "../src/utils/ccTrinketAnalysis";
import {
  combatMemo,
  identityToken,
  memoInputNames,
  mixFingerprint,
  mixFingerprintString,
  once,
  roundFingerprint,
  roundValue,
  setCombatMemoEnabledForTest,
  setSharedReadingsFrozenForTest,
  unitMemo,
  unitTokens,
} from "../src/utils/combatMemo";
import { getUnitPositionAtTime } from "../src/utils/losAnalysis";
import { OFFENSIVE_AURA_FLAGS } from "../src/utils/offensiveAuraOccurrences";
import {
  ADAPTATION_LOCKOUT_AURA_ID,
  ADAPTATION_TRIGGER_AURA_ID,
  MEDALLION_SPELL_ID,
  pvpTrinketUses,
  pvpTrinketUsesUncached,
} from "../src/utils/pvpTrinketUses";
import { MUTABLE_FLAG_NAMES } from "./support/flagGuard";

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

afterEach(() => {
  setCombatMemoEnabledForTest(true);
  setSharedReadingsFrozenForTest(false);
});

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
            r() < 0.8 ? LogEvent.SPELL_CAST_SUCCESS : LogEvent.SPELL_CAST_START,
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
      let ts = Array.from(
        { length: n },
        () => 1000 + Math.floor(r() * 50) * 100,
      );
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

// T81 attempt 2: a whole-round reading that is one object comes back as the
// SAME object to every asker — read-only by contract, and the contract can be
// switched to a hard one (frozen all the way down) for the tests that check it.
describe("roundValue:同一个对象给所有调用方", () => {
  const combat = () => ({ startTime: 0, endTime: 90_000, units: {} });

  it("同一回合对象 + 同一把键 + 同一指纹只算一次,返回的是同一个对象", () => {
    const c = combat();
    const compute = vi.fn(() => ({ rows: [{ t: 1 }] }));
    const fp = roundFingerprint(c);
    const first = roundValue(c, "k", fp, compute);
    expect(roundValue(c, "k", fp, compute)).toBe(first);
    expect(compute).toHaveBeenCalledTimes(1);
    // another key, another fingerprint, another round object: computed
    roundValue(c, "k2", fp, compute);
    roundValue(c, "k", mixFingerprint(fp, 1), compute);
    roundValue(combat(), "k", fp, compute);
    expect(compute).toHaveBeenCalledTimes(4);
    // the latest fingerprint is the one kept
    roundValue(c, "k", fp, compute);
    expect(compute).toHaveBeenCalledTimes(5);
  });

  it("关掉以后每次都算;算的时候抛了不留结果,下一个调用方重算", () => {
    const c = combat();
    const fp = roundFingerprint(c);
    let fail = true;
    const compute = vi.fn(() => {
      if (fail) throw new Error("no advanced logging");
      return { ok: true };
    });
    expect(() => roundValue(c, "k", fp, compute)).toThrow("no advanced");
    fail = false;
    expect(roundValue(c, "k", fp, compute)).toEqual({ ok: true });
    expect(compute).toHaveBeenCalledTimes(2);
    setCombatMemoEnabledForTest(false);
    expect(roundValue(c, "k", fp, compute)).not.toBe(
      roundValue(c, "k", fp, compute),
    );
  });

  it("冻结开关:存下的结果从上到下都冻住,写它就抛;类实例和输入对象不动", () => {
    const c = combat();
    const fp = roundFingerprint(c);
    const input = new (class Unit {
      hp = 1;
    })();
    setSharedReadingsFrozenForTest(true);
    const v = roundValue(c, "k", fp, () => ({
      rows: [{ t: 1, nested: { list: [1, 2] } }],
      byId: new Map<string, number>(),
      input,
    }));
    expect(() => {
      (v.rows[0] as { flag?: boolean }).flag = true;
    }).toThrow(TypeError);
    expect(() => v.rows.push({ t: 2, nested: { list: [] } })).toThrow(
      TypeError,
    );
    expect(() => v.rows[0]!.nested.list.sort()).toThrow(TypeError);
    v.byId.set("a", 1);
    input.hp = 2;
    expect(input.hp).toBe(2);
    // off again: a new result is left writable
    setSharedReadingsFrozenForTest(false);
    const w = roundValue(c, "k2", fp, () => ({ rows: [1] }));
    w.rows.push(2);
    expect(w.rows).toEqual([1, 2]);
  });

  it("键与指纹的辅助:对象身份、字符串输入", () => {
    const [a, b] = [{}, {}];
    expect(identityToken(a)).toBe(identityToken(a));
    expect(identityToken(a)).not.toBe(identityToken(b));
    expect(identityToken(undefined)).toBe(0);
    expect(mixFingerprintString(7, "1505")).toBe(
      mixFingerprintString(7, "1505"),
    );
    expect(mixFingerprintString(7, "1505")).not.toBe(
      mixFingerprintString(7, "1552"),
    );
    expect(mixFingerprintString(7, undefined)).not.toBe(
      mixFingerprintString(7, ""),
    );
  });
});

describe("开关单例是记忆的输入:翻了开关,记住的结果不再被拿来用", () => {
  it("每个可变开关单例都登记了(时间线渲染开关除外:没有哪个记住的读数读它)", () => {
    // TIMELINE_LINE_FLAGS is read by the timeline formatters and the kill
    // attempt's stamp only — line rendering, never inside a kept reading
    const exempt = new Set(["TIMELINE_LINE_FLAGS"]);
    expect(
      MUTABLE_FLAG_NAMES.filter(
        (n) => !exempt.has(n) && !memoInputNames().includes(n),
      ),
    ).toEqual([]);
  });

  it("combatMemo 与 roundValue:翻开关重算,翻回来仍是翻回来之后那次算的", () => {
    const c = { startTime: 0, endTime: 90_000, units: {} };
    const fp = roundFingerprint(c);
    const compute = vi.fn(() => ({ demonic: OFFENSIVE_AURA_FLAGS.demonic }));
    const list = vi.fn(() => [CANDIDATE_TYPE_FLAGS.missedPurge]);
    const savedAura = { ...OFFENSIVE_AURA_FLAGS };
    const savedTypes = { ...CANDIDATE_TYPE_FLAGS };
    try {
      expect(roundValue(c, "k", fp, compute).demonic).toBe("minor");
      OFFENSIVE_AURA_FLAGS.demonic = "burst";
      expect(roundValue(c, "k", fp, compute).demonic).toBe("burst");
      expect(roundValue(c, "k", fp, compute).demonic).toBe("burst");
      expect(compute).toHaveBeenCalledTimes(2);

      const before = combatMemo(c, "l", fp, list);
      CANDIDATE_TYPE_FLAGS.missedPurge = !savedTypes.missedPurge;
      expect(combatMemo(c, "l", fp, list)).toEqual([!before[0]]);
      expect(list).toHaveBeenCalledTimes(2);
    } finally {
      Object.assign(OFFENSIVE_AURA_FLAGS, savedAura);
      Object.assign(CANDIDATE_TYPE_FLAGS, savedTypes);
    }
  });
});

describe("once:算一次;抛过的以后照样抛同一个错", () => {
  it("值只算一次", () => {
    const f = vi.fn(() => [1]);
    const thunk = once(f);
    expect(thunk()).toBe(thunk());
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("抛错只算一次,每次都抛同一个错误对象", () => {
    const err = new Error("absent");
    const f = vi.fn(() => {
      throw err;
    });
    const thunk = once(f);
    expect(thunk).toThrow(err);
    expect(thunk).toThrow(err);
    expect(f).toHaveBeenCalledTimes(1);
  });
  // codex 85-tk-I-T81-2: a thunk stored inside a roundValue holder is a
  // function, which the holder's freeze walk skips — what it computes later
  // was left writable although every asker shares it.
  it("冻结开关:roundValue 持有者里的惰性读数在算出来时冻住,写它就抛", () => {
    setSharedReadingsFrozenForTest(true);
    const c = { startTime: 0, endTime: 90_000, units: {} };
    const holder = roundValue(c, "holder", roundFingerprint(c), () => ({
      rows: once(() => [{ spellName: "a", casts: [1] }]),
    }));
    const rows = holder.rows();
    expect(() => {
      rows[0]!.spellName = "b";
    }).toThrow(TypeError);
    expect(() => rows[0]!.casts.push(2)).toThrow(TypeError);
    expect(() => rows.pop()).toThrow(TypeError);
    expect(holder.rows()[0]!.spellName).toBe("a");
    setSharedReadingsFrozenForTest(false);
    const loose = once(() => [1])();
    loose.push(2);
    expect(loose).toEqual([1, 2]);
  });
});
