import { describe, expect, it } from "vitest";

import { medianFinite, toSortedFinite } from "../utils/stats";
import { toPercentiles } from "./metrics";

/**
 * Regression guardrail for percentile monotonicity.
 *
 * Measured on 50 eval matches on 2026-07-20: 11 matches showed p50 > p90 in the
 * `INCOMING DAMAGE BASELINES` table (real instances: Arms Warrior
 * `p50 314k | p75 12k | p90 302k | p95 477k`; MM Hunter
 * `p50 214k | p75 491k | p90 65k | p95 74k`), while hps/dps/matchDuration on the
 * same object were all fine -- so the percentile algorithm itself was not broken.
 *
 * Root cause: NaN got into the sample pool. `(a, b) => a - b` returns NaN for
 * NaN, and V8's sort does not throw on such a comparator -- it **silently
 * leaves the array partially unsorted**; `percentile()` indexes into it and
 * therefore reads out-of-order samples. A single NaN is enough to collapse the
 * quartiles, and the NaN itself becomes null through JSON.stringify and need
 * not land on any of the four selected indices -- so the bad data looks like
 * "all normal numbers", just in the wrong order, which is nearly impossible to
 * spot by eye.
 *
 * What the guardrail locks is the **predicate contract**: every percentile
 * input must pass through toSortedFinite first.
 */
describe("toSortedFinite:非有限值不得污染排序", () => {
  it("丢弃 NaN 与 ±Infinity,其余升序", () => {
    const out = toSortedFinite([5, NaN, 1, Infinity, 3, -Infinity, 2]);
    expect(out).toEqual([1, 2, 3, 5]);
  });

  it("全非有限 → 空数组(而非乱序残留)", () => {
    expect(toSortedFinite([NaN, Infinity, -Infinity])).toEqual([]);
  });

  it("不修改入参", () => {
    const input = [3, 1, 2];
    toSortedFinite(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe("toPercentiles:单调不减是硬约束", () => {
  /**
   * Deterministic reproduction of the production defect. Before the fix this
   * input set always produced p50 > p90 (measured
   * {p50:449769, p75:135545, p90:417232, p95:430964}), the same shape as the
   * Arms Warrior bad data seen in production.
   */
  it("**回归**:样本池混入 NaN 时仍单调 —— 确定性复现", () => {
    const rand = lcg(64);
    const samples = Array.from({ length: 64 }, () =>
      Math.round(rand() * 500_000),
    );
    samples[35] = NaN;

    const p = toPercentiles(samples);

    expect(Number.isFinite(p.p50)).toBe(true);
    expect(p.p50).toBeLessThanOrEqual(p.p75);
    expect(p.p75).toBeLessThanOrEqual(p.p90);
    expect(p.p90).toBeLessThanOrEqual(p.p95);
  });

  it("混入 NaN 的结果 == 事先剔除 NaN 的结果", () => {
    const rand = lcg(64);
    const clean = Array.from({ length: 64 }, () =>
      Math.round(rand() * 500_000),
    );
    const dirty = [...clean];
    dirty.splice(35, 0, NaN);

    expect(toPercentiles(dirty)).toEqual(toPercentiles(clean));
  });

  it("干净样本:多组随机数据全部单调", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rand = lcg(seed);
      const samples = Array.from({ length: 128 }, () => rand() * 500_000);
      const p = toPercentiles(samples);
      expect(p.p50).toBeLessThanOrEqual(p.p75);
      expect(p.p75).toBeLessThanOrEqual(p.p90);
      expect(p.p90).toBeLessThanOrEqual(p.p95);
    }
  });

  it("空样本 → 全零", () => {
    expect(toPercentiles([])).toEqual({ p50: 0, p75: 0, p90: 0, p95: 0 });
  });
});

describe("medianFinite:基于 toSortedFinite 的中位数", () => {
  it("奇数个元素返回正中间的元素", () => {
    expect(medianFinite([3, 1, 2])).toBe(2);
  });

  it("偶数个元素返回中间两个元素的均值", () => {
    expect(medianFinite([1, 2, 3, 4])).toBe(2.5);
  });

  it("过滤非有限值后计算中位数", () => {
    expect(medianFinite([NaN, 10, Infinity, 20, 30, -Infinity])).toBe(20);
  });

  it("无有限元素返回 0", () => {
    expect(medianFinite([])).toBe(0);
    expect(medianFinite([NaN, Infinity, -Infinity])).toBe(0);
  });
});

/** Deterministic pseudo-random source -- seeded for reproducibility, never
 * Math.random. */
function lcg(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}
