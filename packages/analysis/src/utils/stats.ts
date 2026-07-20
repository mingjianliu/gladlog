/**
 * 顺序统计量的共享谓词。
 *
 * **任何要按索引取分位/中位数的地方,都必须先过 toSortedFinite,不要各自 sort。**
 *
 * 起因(2026-07-20,50 场 healer eval):`INCOMING DAMAGE BASELINES` 表里 11 场
 * 出现 p50 > p90(如 MM 猎人 `p50 214k | p90 65k`)。根因不是百分位算法 ——
 * 是样本池混进了 NaN:`(a, b) => a - b` 对 NaN 返回 NaN,V8 遇到这种比较器
 * 不报错,而是静默留下**部分未排序**的数组,按索引取值于是取到乱序样本。
 *
 * 这类坏数据格外阴险:NaN 经 JSON.stringify 变 null、未必落在被选中的索引上,
 * 所以输出看起来「全是正常数字」,只是顺序不对。
 */

/** 数值升序排序,丢弃非有限值(NaN / ±Infinity)。不修改入参。 */
export function toSortedFinite(values: readonly number[]): number[] {
  const finite = values.filter((v) => Number.isFinite(v));
  finite.sort((a, b) => a - b);
  return finite;
}

/** 中位数;无有限样本时返回 0。 */
export function medianFinite(values: readonly number[]): number {
  const sorted = toSortedFinite(values);
  if (sorted.length === 0) return 0;
  const half = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) return sorted[half];
  return (sorted[half - 1] + sorted[half]) / 2;
}
