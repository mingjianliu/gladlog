import { describe, expect, it } from "vitest";

import { toSortedFinite } from "../utils/stats";
import { toPercentiles } from "./metrics";

/**
 * 百分位单调性的回归护栏。
 *
 * 2026-07-20 的 50 场 eval 实证:`INCOMING DAMAGE BASELINES` 表里 11 场出现
 * p50 > p90(线上实例:Arms Warrior `p50 314k | p75 12k | p90 302k | p95 477k`;
 * MM Hunter `p50 214k | p75 491k | p90 65k | p95 74k`),而同一对象里的
 * hps/dps/matchDuration 全部正常 —— 所以不是百分位算法坏。
 *
 * 根因:样本池里混进了 NaN。`(a, b) => a - b` 对 NaN 返回 NaN,V8 的排序遇到
 * 这种比较器不会抛错,而是**静默留下部分未排序的数组**;`percentile()` 按索引
 * 取值,于是取到乱序样本。单个 NaN 就足以让四分位塌陷,且 NaN 本身经
 * JSON.stringify 变成 null,不一定出现在被选中的四个索引上 —— 所以坏数据
 * 看起来「全是正常数字」,只是顺序不对,肉眼极难发现。
 *
 * 护栏锁的是**谓词契约**:任何百分位输入都必须先过 toSortedFinite。
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
   * 线上缺陷的确定性复现。这组入参在修复前必然产出 p50 > p90
   * (实测 {p50:449769, p75:135545, p90:417232, p95:430964}),
   * 与 Arms Warrior 的线上坏数据同型。
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

/** 确定性伪随机源 —— 用种子固定复现,不用 Math.random。 */
function lcg(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}
