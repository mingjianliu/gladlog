import { chargeStateAt } from "@gladlog/analysis/src/utils/cooldowns";
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

  it("容差只管判定，不改回充状态（codex 30-RV-04 #1）", () => {
    // 生产的模拟：19.6 s 用掉第二层，20 s 回一层，20.1 s 又用掉，下一层 40 s；
    // 39.2 s 即便带 0.5 s 容差也不可能。旧代码在 19.6 + 0.5 处把回充提前推进，
    // 池子"满了"，下一层从 19.6 起算到 39.6，放过了 39.2
    expect(chargeImpossibleAt([0, 19.6, 20.1, 39.2], 20, 2, 0.5)).toEqual([
      39.2,
    ]);
    // 反方向：19.6 s 时手里没有层（容差内放过），生产在那里重新起算到 39.6，
    // 39.2 在容差内；旧代码把下一层排到 40，误报 39.2
    expect(chargeImpossibleAt([0, 5, 19.6, 39.2], 20, 2, 0.5)).toEqual([]);
  });

  it("与生产的 chargeStateAt 逐按键一致（判定 = 无层且下一层晚于 p + 容差）", () => {
    const cases: Array<[number[], number, number]> = [
      [[0, 19.6, 20.1, 39.2], 20, 2],
      [[0, 5, 19.6, 39.2], 20, 2],
      [[0, 5, 20, 25], 20, 2],
      [[0, 1, 2, 21, 21.2, 40, 41.6, 60], 20, 2],
      [[0, 0, 1, 9.7, 10, 18, 29.8, 30.1], 10, 3],
      [[0, 10, 19.6, 25, 39.3, 39.9], 20, 1],
    ];
    for (const [t, cd, cap] of cases) {
      const expected = t.filter((p, i) => {
        const st = chargeStateAt(t.slice(0, i), cd, cap, p);
        return st.charges === 0 && st.nextRecharge > p + 0.5;
      });
      expect(chargeImpossibleAt(t, cd, cap, 0.5)).toEqual(expected);
    }
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
