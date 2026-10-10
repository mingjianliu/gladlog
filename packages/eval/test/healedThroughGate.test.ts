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
      TROUGH.replace("low 37% @0:14", "low 75% @0:14"),
    ]);
    expect(fails.some((f) => f.includes("不满足低谷判据"))).toBe(true);
  });

  // User ruling 2026-09-30 (triage A′14, hp-state F-N5): a trough is a low
  // ≥ 10 points under BOTH endpoints, with no ≤ 40 % condition — the gate
  // imports the renderer's predicate, so both move together.
  it("A′14: a tick 10+ points under both endpoints with the word → red, above the crisis line too", () => {
    const fails = checkHealedThroughConsistency([
      "0:10–0:20  [DMG SPIKE]   2(AWarrior) (Arms Warrior): 0.50M in 10s (82% -> 82% HP, 0%/s — healed through)",
      state("0:14", 43),
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("0:14 [STATE] 报 43%");
  });

  it("A′14: a tick 9 points under the lower endpoint is not a trough → the word stands", () => {
    expect(
      checkHealedThroughConsistency([
        "0:10–0:20  [DMG SPIKE]   2(AWarrior) (Arms Warrior): 0.50M in 10s (81% -> 87% HP, +1%/s — healed through)",
        state("0:14", 72),
      ]),
    ).toEqual([]);
  });

  it("A′14: a printed low under 10 points below a falling window's end → red (the old crisis-line rule printed it)", () => {
    const fails = checkHealedThroughConsistency([
      "0:10–0:20  [DMG SPIKE]   2(AWarrior) (Arms Warrior): 0.80M in 10s (99% -> 24% HP, -8%/s, low 22% @0:19)",
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

// FT-T03 (user ruling 2026-10-10, D7): the low is a TROUGH — the true minimum
// inside the window (`hpTroughInWindow`), not the lowest whole-second tick.
// The tick of the printed second need not equal it; no tick may be below it.
describe("checkHealedThroughConsistency — the low is a trough, off the grid (FT-T03)", () => {
  // 141470d0: `low 6% @4:15` beside a 4:15 tick of 33 and a 4:16 tick of 48
  const DEEP =
    "0:10–0:20  [DMG SPIKE]   2(AWarrior) (Arms Warrior): 0.50M in 10s (80% -> 57% HP, -2%/s, low 6% @0:15)";
  it("a low BELOW the tick of its own second → passes (the tick is the start of that second)", () => {
    expect(
      checkHealedThroughConsistency([
        state("0:10", 80),
        DEEP,
        state("0:15", 33),
        state("0:16", 48),
        state("0:20", 57),
      ]),
    ).toEqual([]);
  });
  it("a tick below the low is still red — at the low's own second too", () => {
    const fails = checkHealedThroughConsistency([DEEP, state("0:15", 4)]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("标注 low 6% 但 0:15 [STATE] 报 4%");
  });
  it("a low on a second that unit's tick reads `dead` → red", () => {
    const fails = checkHealedThroughConsistency([DEEP, state("0:15", "dead")]);
    expect(fails.some((f) => f.includes("该秒 [STATE] 报 dead"))).toBe(true);
  });
  it("no low printed over a tick that is a trough → still red (the trough is at or below every tick)", () => {
    const fails = checkHealedThroughConsistency([
      DEEP.replace(", low 6% @0:15", ""),
      state("0:15", 33),
    ]);
    expect(fails.some((f) => f.includes("未标注低谷"))).toBe(true);
  });
});

// T12 ① c (user ruling 2026-10-10): a bucket closes at its victim's death and
// reads 0 % there; the gate asks the renderer's own `isSpikeHealedThrough`.
describe("checkHealedThroughConsistency — a window that ends on a death (T12 ① c)", () => {
  const DIED =
    "0:39–0:45  [DMG SPIKE]   2(AWarlock) (Affliction Warlock): 0.60M in 6s (100k DPS) (33% -> 0% HP, -6%/s)";
  /** a bucket opened in the death second: Δ = 0, and still a death */
  const DIED_AT_OPEN =
    "0:45–0:45  [DMG SPIKE]   2(AWarlock) (Affliction Warlock): 0.60M in 0s (600k DPS) (0% -> 0% HP, 0%/s)";

  it("`N% -> 0% HP` without the word → passes, beside its `dead` tick", () => {
    expect(
      checkHealedThroughConsistency([
        state("0:39", 33),
        DIED,
        state("0:45", "dead"),
      ]),
    ).toEqual([]);
  });

  it("`0% -> 0% HP` without the word → passes (Δ = 0 is not `healed through` at 0 %)", () => {
    expect(checkHealedThroughConsistency([DIED_AT_OPEN])).toEqual([]);
  });

  it("the word on a window that ends at 0 % → red", () => {
    const fails = checkHealedThroughConsistency([
      DIED_AT_OPEN.replace("0%/s)", "0%/s — healed through)"),
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("终点 HP 为 0%");
  });

  it("Δ = 0 above 0 % still needs the word (the two-sided rule is unchanged)", () => {
    const fails = checkHealedThroughConsistency([
      "0:10–0:20  [DMG SPIKE]   x (50% -> 50% HP, +0%/s)",
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("Δ0 ≥ 0");
  });
});
