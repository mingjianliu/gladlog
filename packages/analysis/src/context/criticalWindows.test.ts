import { describe, expect, it } from "vitest";

import { buildCriticalWindowSet } from "./criticalWindows";
import { DMG_SPIKE_THRESHOLD } from "./timelineHelpers";

/**
 * 抽取重构的等价性护栏。
 *
 * buildCriticalWindowSet 是从 matchTimeline.ts 的局部代码原样提出来的。抽取的
 * 唯一目的是让 [CD]/[DMG SPIKE]/[STATE] 等多个 HP 消费者共享同一个窗口集合
 * (见 criticalWindows.ts 的根因说明)—— **它不该改变任何一个秒的归属**。
 *
 * 下面的 legacy 实现是原地逐字复刻的旧逻辑,两者必须产出完全相同的集合。
 */

/** matchTimeline.ts 抽取前的原始内联逻辑,逐字复刻。 */
function legacyBuild(inputs: {
  friendlyDeaths: Array<{ atSeconds: number }>;
  enemyDeaths: Array<{ atSeconds: number }>;
  pressureWindows: Array<{ fromSeconds: number; totalDamage: number }>;
  ccTrinketSummaries: Array<{ ccInstances: Array<{ atSeconds: number }> }>;
  matchDurationSeconds: number;
}): Set<number> {
  const {
    friendlyDeaths,
    enemyDeaths,
    pressureWindows,
    ccTrinketSummaries,
    matchDurationSeconds: matchDurationS,
  } = inputs;
  const criticalWindowSet = new Set<number>();
  for (const d of friendlyDeaths) {
    for (
      let t = Math.max(0, Math.ceil(d.atSeconds - 10));
      t <= Math.floor(d.atSeconds);
      t++
    ) {
      criticalWindowSet.add(t);
    }
  }
  for (const d of enemyDeaths) {
    for (
      let t = Math.max(0, Math.ceil(d.atSeconds - 10));
      t <= Math.floor(d.atSeconds);
      t++
    ) {
      criticalWindowSet.add(t);
    }
  }
  for (const pw of pressureWindows) {
    if (pw.totalDamage >= DMG_SPIKE_THRESHOLD) {
      const from = Math.max(0, Math.ceil(pw.fromSeconds - 5));
      const to = Math.min(
        Math.floor(matchDurationS),
        Math.floor(pw.fromSeconds + 5),
      );
      for (let t = from; t <= to; t++) criticalWindowSet.add(t);
    }
  }
  for (const summary of ccTrinketSummaries) {
    for (const cc of summary.ccInstances) {
      const from = Math.max(0, Math.ceil(cc.atSeconds));
      const to = Math.min(
        Math.floor(matchDurationS),
        Math.floor(cc.atSeconds + 10),
      );
      for (let t = from; t <= to; t++) criticalWindowSet.add(t);
    }
  }
  return criticalWindowSet;
}

/** 确定性伪随机源。 */
function lcg(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

function randomInputs(seed: number) {
  const r = lcg(seed);
  const matchDurationSeconds = 60 + Math.round(r() * 300);
  const at = () => r() * matchDurationSeconds;
  return {
    matchDurationSeconds,
    friendlyDeaths: Array.from({ length: Math.floor(r() * 4) }, () => ({
      atSeconds: at(),
    })),
    enemyDeaths: Array.from({ length: Math.floor(r() * 4) }, () => ({
      atSeconds: at(),
    })),
    pressureWindows: Array.from({ length: Math.floor(r() * 12) }, () => ({
      fromSeconds: at(),
      // 跨越阈值两侧,确保过滤分支都被覆盖
      totalDamage: Math.round(r() * 2 * DMG_SPIKE_THRESHOLD),
    })),
    ccTrinketSummaries: Array.from({ length: Math.floor(r() * 4) }, () => ({
      ccInstances: Array.from({ length: Math.floor(r() * 5) }, () => ({
        atSeconds: at(),
      })),
    })),
  };
}

describe("buildCriticalWindowSet:抽取必须行为等价", () => {
  it("**等价性**:200 组随机输入与抽取前的旧逻辑逐秒一致", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const inputs = randomInputs(seed);
      const extracted = buildCriticalWindowSet(inputs);
      const legacy = legacyBuild(inputs);
      expect([...extracted].sort((a, b) => a - b)).toEqual(
        [...legacy].sort((a, b) => a - b),
      );
    }
  });

  it("空输入 → 空集合", () => {
    expect(
      buildCriticalWindowSet({
        friendlyDeaths: [],
        enemyDeaths: [],
        pressureWindows: [],
        ccTrinketSummaries: [],
        matchDurationSeconds: 120,
      }).size,
    ).toBe(0);
  });

  it("低于阈值的 pressure window 不构成关键窗口", () => {
    const set = buildCriticalWindowSet({
      friendlyDeaths: [],
      enemyDeaths: [],
      pressureWindows: [
        { fromSeconds: 50, totalDamage: DMG_SPIKE_THRESHOLD - 1 },
      ],
      ccTrinketSummaries: [],
      matchDurationSeconds: 120,
    });
    expect(set.size).toBe(0);
  });

  it("刚好达到阈值即构成关键窗口(边界是 >=)", () => {
    const set = buildCriticalWindowSet({
      friendlyDeaths: [],
      enemyDeaths: [],
      pressureWindows: [{ fromSeconds: 50, totalDamage: DMG_SPIKE_THRESHOLD }],
      ccTrinketSummaries: [],
      matchDurationSeconds: 120,
    });
    expect(set.has(50)).toBe(true);
    expect(set.has(45)).toBe(true);
    expect(set.has(55)).toBe(true);
    expect(set.has(44)).toBe(false);
    expect(set.has(56)).toBe(false);
  });

  it("死亡窗口覆盖 [T-10, T],不含 T+1", () => {
    const set = buildCriticalWindowSet({
      friendlyDeaths: [{ atSeconds: 30 }],
      enemyDeaths: [],
      pressureWindows: [],
      ccTrinketSummaries: [],
      matchDurationSeconds: 120,
    });
    expect(set.has(20)).toBe(true);
    expect(set.has(30)).toBe(true);
    expect(set.has(19)).toBe(false);
    expect(set.has(31)).toBe(false);
  });
});
