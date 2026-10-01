import { describe, expect, it } from "vitest";

import { PRESS_HP_LINE_TAGS } from "@gladlog/analysis/src/utils/cooldowns";

import { checkSameSecondHpConsistency } from "./promptQualityCheck";

/**
 * Same-second HP consistency gate (class A). The lines in these cases are
 * taken from the real corpus at
 * runs/2026-07-20-smoke/prompts/001-be78167b.txt.
 */
describe("checkSameSecondHpConsistency", () => {
  it("**回归**:线上真实矛盾 —— spike 55% vs state 76%", () => {
    const v = checkSameSecondHpConsistency([
      "1:49–1:59  [DMG SPIKE]   2(SHunter) (Survival Hunter): 0.87M in 10s (87k DPS) (55% -> 79% HP, +2%/s)",
      "1:49  [STATE]   friends 1(HPriest):99 2(SHunter):76 / enemies 4(AWarrior):90",
    ]);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("Δ21pp");
  });

  it("一致时不报", () => {
    expect(
      checkSameSecondHpConsistency([
        "1:49–1:59  [DMG SPIKE]   2(SHunter) (Survival Hunter): 0.87M in 10s (87k DPS) (76% -> 79% HP, +2%/s)",
        "1:49  [STATE]   friends 1(HPriest):99 2(SHunter):76 / enemies 4(AWarrior):90",
      ]),
    ).toEqual([]);
  });

  it("容忍 ≤3pp 的良性抖动", () => {
    expect(
      checkSameSecondHpConsistency([
        "1:49–1:59  [DMG SPIKE]   2(SHunter) (X): 0.8M in 10s (80k DPS) (79% -> 90% HP)",
        "1:49  [STATE]   friends 2(SHunter):76",
      ]),
    ).toEqual([]);
  });

  it("超出容忍即报(4pp)", () => {
    expect(
      checkSameSecondHpConsistency([
        "1:49–1:59  [DMG SPIKE]   2(SHunter) (X): 0.8M in 10s (80k DPS) (80% -> 90% HP)",
        "1:49  [STATE]   friends 2(SHunter):76",
      ]),
    ).toHaveLength(1);
  });

  it("不同秒不比较", () => {
    expect(
      checkSameSecondHpConsistency([
        "1:49–1:59  [DMG SPIKE]   2(SHunter) (X): 0.8M in 10s (80k DPS) (55% -> 79% HP)",
        "1:52  [STATE]   friends 2(SHunter):76",
      ]),
    ).toEqual([]);
  });

  it("STATE 里没有该单位时跳过(死亡后 STATE 不再列出)", () => {
    expect(
      checkSameSecondHpConsistency([
        "1:49–1:59  [DMG SPIKE]   2(SHunter) (X): 0.8M in 10s (80k DPS) (55% -> 79% HP)",
        "1:49  [STATE]   friends 1(HPriest):99 / enemies 4(AWarrior):90",
      ]),
    ).toEqual([]);
  });

  it("敌方单位同样受检", () => {
    expect(
      checkSameSecondHpConsistency([
        "0:30–0:40  [DMG SPIKE]   4(AWarrior) (Arms Warrior): 0.9M in 10s (90k DPS) (40% -> 20% HP)",
        "0:30  [STATE]   friends 1(HPriest):99 / enemies 4(AWarrior):90",
      ]),
    ).toHaveLength(1);
  });

  // C 类行内嵌 HP(线上真实 Δ13pp,023-d17001ce)原本在 [YOU] [CD] 行上受检。
  // 用户裁决 2026-09-30(分诊 A21):按键行的血量取**按下那一刻**(analysis 的
  // hpAtPress),是「血量取渲染整秒网格」的唯一签字例外,这些行不再与同秒 [STATE]
  // 比对。行内嵌判据本身仍在,对非按键行照旧生效。
  it("非按键行的行内嵌 HP 仍受检(Δ13pp)", () => {
    const v = checkSameSecondHpConsistency([
      "1:54  [TEAM] [CD]   2(WMonk) (Windwalker Monk): Chi Burst → 5(DDHunter) (73% HP)",
      "1:54  [STATE]   friends 1(MMonk):88 / enemies 5(DDHunter):86",
    ]);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("行内嵌");
    expect(v[0]).toContain("Δ13pp");
  });

  it("非按键行的行内嵌 HP 一致时不报", () => {
    expect(
      checkSameSecondHpConsistency([
        "1:54  [TEAM] [CD]   2(WMonk) (Windwalker Monk): Chi Burst → 5(DDHunter) (86% HP)",
        "1:54  [STATE]   friends 1(MMonk):88 / enemies 5(DDHunter):86",
      ]),
    ).toEqual([]);
  });

  it("按键行豁免(A21):清单出自 analysis,逐个标签都不与同秒 [STATE] 比对", () => {
    expect([...PRESS_HP_LINE_TAGS]).toEqual([
      "[YOU] [CD]",
      "[YOU] [CC]",
      "[YOU] [PROC]",
      "[YOU] [CAST]",
      "[ENEMY DEF]",
      "[ENEMY TRINKET]",
    ]);
    const state =
      "1:54  [STATE]   friends 1(MMonk):88 / enemies 5(DDHunter):86";
    for (const press of [
      "1:54  [YOU] [CD]   Chi Burst → 5(DDHunter) (73% HP)",
      "1:54  [YOU] [CC]   Paralysis → 5(DDHunter) (40% HP)",
      "1:54  [YOU] [PROC]   Renewing Blaze → 5(DDHunter) (40% HP)",
      "1:54  [YOU] [CAST]   Vivify → 1(MMonk) (8% HP)",
      "1:54  [ENEMY DEF]   5(DDHunter) (Devastation Evoker): Obsidian Scales (30%, 12.0s) (at 5% HP)",
      "1:54  [ENEMY DEF]   4(HPriest) (Holy Priest): Pain Suppression → 5(DDHunter) (target at 5% HP)",
      "1:54  [ENEMY TRINKET]   5(DDHunter) used PvP trinket (target at 5% HP)",
    ])
      expect(checkSameSecondHpConsistency([press, state])).toEqual([]);
  });

  it("空输入 → 无违规", () => {
    expect(checkSameSecondHpConsistency([])).toEqual([]);
  });
});
