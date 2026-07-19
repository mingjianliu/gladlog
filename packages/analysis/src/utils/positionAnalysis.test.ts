import { describe, expect, it } from "vitest";

import {
  STAYED_IN_NO_COST_MAX_DROP_PCT,
  STAYED_IN_NO_COST_MIN_HP_PCT,
  stayedInHadRealCost,
} from "./positionAnalysis";

/**
 * 这个谓词是 context formatter 的 "(no real cost)" 标签与深挖可教信号门的
 * **共用**判据(周度复核 P1#1)。两边同源是硬要求:门那边曾靠一句
 * 「STAYED_IN 已经只在掉血时触发」的注释假设它成立,而源头从未按 HP 过滤。
 */
describe("stayedInHadRealCost(STAYED_IN 代价判据单源)", () => {
  it("站到濒死 / 跌幅够大 → 有代价", () => {
    expect(stayedInHadRealCost(12, 100)).toBe(true);
    expect(stayedInHadRealCost(84, 100)).toBe(true); // 跌 16 ≥ 15
  });

  it("血线高且跌幅小 → 无代价(干净窗口,不该开深挖门)", () => {
    expect(stayedInHadRealCost(98, 100)).toBe(false);
    expect(stayedInHadRealCost(90, 100)).toBe(false); // 跌 10 < 15
  });

  it("边界正好落在阈值上", () => {
    // hpMin 恰为 85 且跌幅恰为 14 → 仍算无代价
    expect(stayedInHadRealCost(STAYED_IN_NO_COST_MIN_HP_PCT, 99)).toBe(false);
    // 跌幅恰好等于 15 → 算有代价(判据是 < DROP 才免责)
    expect(
      stayedInHadRealCost(
        STAYED_IN_NO_COST_MIN_HP_PCT,
        STAYED_IN_NO_COST_MIN_HP_PCT + STAYED_IN_NO_COST_MAX_DROP_PCT,
      ),
    ).toBe(true);
    // hpMin 低于下限 → 无论跌幅多小都算有代价
    expect(stayedInHadRealCost(STAYED_IN_NO_COST_MIN_HP_PCT - 1, 85)).toBe(
      true,
    );
  });

  it("无 HP 数据 → 视为有代价(保持改动前行为,便于 eval 归因)", () => {
    expect(stayedInHadRealCost(null, 100)).toBe(true);
    expect(stayedInHadRealCost(undefined, undefined)).toBe(true);
  });

  it("缺 hpStart 时按满血起算", () => {
    expect(stayedInHadRealCost(98, null)).toBe(false); // 100→98
    expect(stayedInHadRealCost(80, null)).toBe(true); // 100→80
  });
});
