import { describe, expect, it } from "vitest";

import { chargeImpossibleAt, recastAggKey } from "../scripts/lib/chargeRecast";

/** the pre-fix pairwise reading (press i against press i − charges) */
const pairwise = (t: number[], cd: number, cap: number, slack: number) =>
  t.filter((x, i) => i >= cap && x - t[i - cap]! < cd - slack);

describe("chargeImpossibleAt — 静态读法按顺序回充", () => {
  it("两层 20 s：0 / 5 / 20 / 25 s，25 s 时没有可用层（codex 59-POSTHOC-11b #1）", () => {
    const t = [0, 5, 20, 25];
    expect(chargeImpossibleAt(t, 20, 2, 0.5)).toEqual([25]);
    // 旧的成对比较两段间隔都是 20 s，放过了它
    expect(pairwise(t, 20, 2, 0.5)).toEqual([]);
  });

  it("两层：第二层 40 s 回来，40 s 的按键合法", () => {
    expect(chargeImpossibleAt([0, 5, 20, 40], 20, 2, 0.5)).toEqual([]);
  });

  it("容差内提前按不算不可能", () => {
    expect(chargeImpossibleAt([0, 19.6], 20, 1, 0.5)).toEqual([]);
    expect(chargeImpossibleAt([0, 19.4], 20, 1, 0.5)).toEqual([19.4]);
  });

  it("一层时和旧的成对比较完全一致（不可能的按键就地重新起算）", () => {
    const cases: number[][] = [
      [0, 10, 25, 30, 61],
      [0, 19.4, 38, 60],
      [3, 4, 5, 40, 41],
    ];
    for (const t of cases)
      expect(chargeImpossibleAt(t, 20, 1, 0.5)).toEqual(
        pairwise(t, 20, 1, 0.5),
      );
  });

  it("不可能的按键之后从它重新起算：两层，0 / 1 / 2 s，下一层 22 s 回来", () => {
    // 0、1 用掉两层；2 s 不可能，回充从 2 s 重新起算（2 → 22）
    expect(chargeImpossibleAt([0, 1, 2, 22], 20, 2, 0.5)).toEqual([2]);
    expect(chargeImpossibleAt([0, 1, 2, 21], 20, 2, 0.5)).toEqual([2, 21]);
  });
});

describe("recastAggKey — 汇总按技能×专精×冷却×层数", () => {
  it("同一技能不同专精 / 冷却分开（Fire 40 s 和 Frost 28 s 的 Dragon's Breath）", () => {
    const fire = recastAggKey("31661", "63", 40, 1);
    const frost = recastAggKey("31661", "64", 28, 1);
    expect(fire).not.toBe(frost);
    expect(recastAggKey("31661", "63", 40, 0)).toBe(fire);
  });
});
