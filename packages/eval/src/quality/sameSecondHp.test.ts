import { describe, expect, it } from "vitest";

import { checkSameSecondHpConsistency } from "./promptQualityCheck";

/**
 * 同秒 HP 一致性门规(A 类)。用例里的行取自真实语料
 * runs/2026-07-20-smoke/prompts/001-be78167b.txt。
 */
describe("checkSameSecondHpConsistency", () => {
  it("**回归**:线上真实矛盾 —— spike 55% vs state 76%", () => {
    const v = checkSameSecondHpConsistency([
      "1:49  [DMG SPIKE]   2(SHunter) (Survival Hunter): 0.87M in 10s (87k DPS) (55% -> 79% HP, +2%/s)",
      "1:49  [STATE]   friends 1(HPriest):99 2(SHunter):76 / enemies 4(AWarrior):90",
    ]);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("Δ21pp");
  });

  it("一致时不报", () => {
    expect(
      checkSameSecondHpConsistency([
        "1:49  [DMG SPIKE]   2(SHunter) (Survival Hunter): 0.87M in 10s (87k DPS) (76% -> 79% HP, +2%/s)",
        "1:49  [STATE]   friends 1(HPriest):99 2(SHunter):76 / enemies 4(AWarrior):90",
      ]),
    ).toEqual([]);
  });

  it("容忍 ≤3pp 的良性抖动", () => {
    expect(
      checkSameSecondHpConsistency([
        "1:49  [DMG SPIKE]   2(SHunter) (X): 0.8M in 10s (80k DPS) (79% -> 90% HP)",
        "1:49  [STATE]   friends 2(SHunter):76",
      ]),
    ).toEqual([]);
  });

  it("超出容忍即报(4pp)", () => {
    expect(
      checkSameSecondHpConsistency([
        "1:49  [DMG SPIKE]   2(SHunter) (X): 0.8M in 10s (80k DPS) (80% -> 90% HP)",
        "1:49  [STATE]   friends 2(SHunter):76",
      ]),
    ).toHaveLength(1);
  });

  it("不同秒不比较", () => {
    expect(
      checkSameSecondHpConsistency([
        "1:49  [DMG SPIKE]   2(SHunter) (X): 0.8M in 10s (80k DPS) (55% -> 79% HP)",
        "1:52  [STATE]   friends 2(SHunter):76",
      ]),
    ).toEqual([]);
  });

  it("STATE 里没有该单位时跳过(死亡后 STATE 不再列出)", () => {
    expect(
      checkSameSecondHpConsistency([
        "1:49  [DMG SPIKE]   2(SHunter) (X): 0.8M in 10s (80k DPS) (55% -> 79% HP)",
        "1:49  [STATE]   friends 1(HPriest):99 / enemies 4(AWarrior):90",
      ]),
    ).toEqual([]);
  });

  it("敌方单位同样受检", () => {
    expect(
      checkSameSecondHpConsistency([
        "0:30  [DMG SPIKE]   4(AWarrior) (Arms Warrior): 0.9M in 10s (90k DPS) (40% -> 20% HP)",
        "0:30  [STATE]   friends 1(HPriest):99 / enemies 4(AWarrior):90",
      ]),
    ).toHaveLength(1);
  });

  it("空输入 → 无违规", () => {
    expect(checkSameSecondHpConsistency([])).toEqual([]);
  });
});
