import { describe, expect, it } from "vitest";

import { checkHealedThroughConsistency } from "../src/quality/promptQualityCheck";

const UP =
  "0:10–0:20  [DMG SPIKE]   2(AWarrior) (Arms Warrior): 0.50M in 10s (62% -> 71% HP, +1%/s — healed through)";
const DOWN =
  "0:30–0:40  [DMG SPIKE]   2(AWarrior) (Arms Warrior): 0.80M in 10s (71% -> 38% HP, -3%/s)";
/** the 2026-09-15 shape: endpoints fine, a crisis-line dip inside the window */
const TROUGH =
  "0:10–0:20  [DMG SPIKE]   2(AWarrior) (Arms Warrior): 0.50M in 10s (81% -> 87% HP, +1%/s, low 37% @0:14)";
const state = (t: string, hp: number | "dead") =>
  `${t}  [STATE]   friends 1(RShaman):99 2(AWarrior):${hp} / enemies 6(RShaman):68`;

describe("checkHealedThroughConsistency (GH #36 item 5 — 9th hardFailure class)", () => {
  it("word ⟺ Δ ≥ 0 on both shapes → passes", () => {
    expect(checkHealedThroughConsistency([UP, DOWN])).toEqual([]);
  });
  it("equal HP counts as healed through (Δ = 0 keeps the word)", () => {
    expect(
      checkHealedThroughConsistency([
        "0:10–0:20  [DMG SPIKE]   x (50% -> 50% HP, +0%/s — healed through)",
      ]),
    ).toEqual([]);
  });
  it("stray word on a negative delta → red", () => {
    const fails = checkHealedThroughConsistency([
      DOWN.replace(")", " — healed through)"),
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("Δ-33 < 0");
  });
  it("missing word on a non-negative delta → red (two-sided)", () => {
    const fails = checkHealedThroughConsistency([
      UP.replace(" — healed through", ""),
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("Δ9 ≥ 0");
  });
  it("lines without the HP pair and non-[DMG SPIKE] lines are out of scope", () => {
    expect(
      checkHealedThroughConsistency([
        "0:10–0:20  [DMG SPIKE]   x: 0.50M in 10s",
        "1:00  [KILL WINDOW] … healed through",
      ]),
    ).toEqual([]);
  });
});

describe("checkHealedThroughConsistency — trough half (2026-09-15)", () => {
  it("`low N%` replaces the word; ticks at or above N inside the window agree → passes", () => {
    expect(
      checkHealedThroughConsistency([
        state("0:10", 81),
        TROUGH,
        state("0:14", 37),
        state("0:18", 80),
      ]),
    ).toEqual([]);
  });

  it("the word next to a visible crisis-line tick → red (the 73/309 shape)", () => {
    const fails = checkHealedThroughConsistency([
      "0:10–0:20  [DMG SPIKE]   2(AWarrior) (Arms Warrior): 0.50M in 10s (81% -> 87% HP, +1%/s — healed through)",
      state("0:14", 37),
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("未标注低谷");
    expect(fails[0]).toContain("0:14 [STATE] 报 37%");
  });

  it("a tick below the printed low → red; a tick outside the window is ignored", () => {
    expect(
      checkHealedThroughConsistency([TROUGH, state("0:16", 30)])[0],
    ).toContain("标注 low 37% 但 0:16 [STATE] 报 30%");
    expect(checkHealedThroughConsistency([TROUGH, state("0:25", 30)])).toEqual(
      [],
    );
  });

  it("a printed low that is not a trough by the shared predicate → red", () => {
    const fails = checkHealedThroughConsistency([
      TROUGH.replace("low 37% @0:14", "low 60% @0:14"),
    ]);
    expect(fails.some((f) => f.includes("不满足低谷判据"))).toBe(true);
  });

  it("a low stamped outside its own window → red", () => {
    const fails = checkHealedThroughConsistency([
      TROUGH.replace("@0:14", "@0:25"),
    ]);
    expect(fails.some((f) => f.includes("落在窗口"))).toBe(true);
  });

  it("word and low together → red; a `dead` tick is not a number", () => {
    expect(
      checkHealedThroughConsistency([
        TROUGH.replace("@0:14)", "@0:14 — healed through)"),
      ]).some((f) => f.includes("同时标注")),
    ).toBe(true);
    expect(
      checkHealedThroughConsistency([TROUGH, state("0:19", "dead")]),
    ).toEqual([]);
  });
});
