import { formatDampeningForContext } from "@gladlog/analysis";
import { describe, expect, it } from "vitest";

import { checkDampeningStartConsistency } from "../src/quality/promptQualityCheck";

/**
 * FT-T13 (D10): the DAMPENING header and the `| dampening: N%` notes of the
 * timeline are one reading — one prompt never states two start values.
 * The failing shape is the 14055cb2 prompt of the 60-match re-eval: header
 * `started at 30%`, press line at 0:04 `dampening: 10%`, at 0:17 `42%`.
 */
const HEADER_30 = "DAMPENING (2v2): started at 30%, ended at 63% at match end";

describe("checkDampeningStartConsistency", () => {
  it("fails on a press line that reads below the header's start before any death", () => {
    const out = checkDampeningStartConsistency([
      HEADER_30,
      "0:00  [DAMPENING ALERT: 30%]",
      "0:04  [YOU] [CD]   Frozen Orb (self: 100% HP, 0%/s, 0k DPS) | dampening: 10%, next spike in 18s on 1(FMage)",
      "0:17  [YOU] [CD]   Ice Barrier (self: 79% HP, -1%/s, 44k DPS) | dampening: 42%, next spike in 5s on 1(FMage)",
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("line 3");
    expect(out[0]).toContain("30%");
    expect(out[0]).toContain("10%");
  });

  it("passes when every note before the first death is at or above the header", () => {
    expect(
      checkDampeningStartConsistency([
        HEADER_30,
        "0:04  [YOU] [CD]   Frozen Orb (self: 100% HP, 0%/s, 0k DPS) | dampening: 30%, next spike in 18s on 1(FMage)",
        "0:17  [YOU] [CD]   Ice Barrier (self: 79% HP, -1%/s, 44k DPS) | dampening: 42%",
        "0:20  [DEATH]  2(FMage) (Frost Mage — friendly) | dampening: 42%",
      ]),
    ).toEqual([]);
  });

  it("reads the [DEATH] note too", () => {
    const out = checkDampeningStartConsistency([
      "DAMPENING (2v2): started at 30%, ended at 44% at match end",
      "0:07  [YOU] [CD]   Barkskin (self: 60% HP, -9%/s, 80k DPS) | dampening: 30%",
      "0:08  [DEATH]  4(FMage) (Frost Mage — enemy) | dampening: 10%",
    ]);
    // the death line itself is not "before the first death" — only what
    // precedes its second is bound
    expect(out).toEqual([]);
    const earlier = checkDampeningStartConsistency([
      "DAMPENING (2v2): started at 30%, ended at 44% at match end",
      "0:05  [YOU] [PROC]   Nature's Guardian (self: 30% HP, -20%/s, 90k DPS) | dampening: 10%",
      "0:08  [DEATH]  4(FMage) (Frost Mage — enemy) | dampening: 30%",
    ]);
    expect(earlier).toHaveLength(1);
  });

  it("does not bind the lines from the first death's second on — the stack drops on the survivors after a death", () => {
    // 95127ab4: 51 → 32 on a SPELL_AURA_REMOVED_DOSE after a player died
    expect(
      checkDampeningStartConsistency([
        HEADER_30,
        "0:15  [DEATH]  2(FMage) (Frost Mage — friendly) | dampening: 42%",
        "0:15  [YOU] [CD]   Ice Barrier (self: 79% HP, -1%/s, 44k DPS) | dampening: 28%",
        "0:19  [YOU] [CD]   Alter Time (self: 60% HP, -1%/s, 44k DPS) | dampening: 28%",
      ]),
    ).toEqual([]);
  });

  it("is silent without a `started at` header (the short-match n/a line)", () => {
    expect(
      checkDampeningStartConsistency([
        "DAMPENING (3v3): n/a — match ended (36s) before dampening ramped (10% at end)",
        "0:04  [YOU] [CD]   Frozen Orb (self: 100% HP, 0%/s, 0k DPS) | dampening: 10%",
      ]),
    ).toEqual([]);
  });

  it("3v3 / Solo Shuffle: started at 10%, every note 10% or more", () => {
    expect(
      checkDampeningStartConsistency([
        "DAMPENING (Rated Solo Shuffle): started at 10%, ended at 58% at match end",
        "0:14  [YOU] [CD]   Alter Time (self: 100% HP, 0%/s, 2k DPS) | dampening: 10%, next spike in 14s on 3(FMage)",
        "1:17  [YOU] [CD]   Ring of Frost (self: 82% HP, +4%/s, 5k DPS) | dampening: 16%",
      ]),
    ).toEqual([]);
  });
});

/**
 * FT-T13 (D11, re-opening O10): a 2v2 prompt's start is derived from the
 * round's first logged stack — the header says `started at N% (derived: one
 * 1% step below the first logged stack, M% at m:ss …)`, N = M − 1, and every
 * dampening value stamped before m:ss reads N.
 */
const HEADER_DERIVED =
  "DAMPENING (2v2): started at 41% (derived: one 1% step below the first logged stack, 42% at 0:11 — the log prints no value before that), ended at 63% at match end";

describe("checkDampeningStartConsistency — a derived start (2v2)", () => {
  it("passes when every value before the first logged second is the derived one", () => {
    expect(
      checkDampeningStartConsistency([
        HEADER_DERIVED,
        "0:00  [DAMPENING ALERT: 30%]",
        "0:04  [YOU] [CD]   Frozen Orb (self: 100% HP, 0%/s, 0k DPS) | dampening: 41%, next spike in 18s on 1(FMage)",
        "0:08  [DEATH]  4(FMage) (Frost Mage — enemy) | dampening: 41%",
        "0:11  [YOU] [CD]   Ice Barrier (self: 79% HP, -1%/s, 44k DPS) | dampening: 42%",
        "0:17  [YOU] [CD]   Alter Time (self: 79% HP, +1%/s, 16k DPS) | dampening: 42%, next spike in 4s on 1(FMage)",
        "2:27  [MATCH END]   damp: 63%",
      ]),
    ).toEqual([]);
  });

  it("fails on every value before it that is not the derived one — the old table's 30 and 10, the first stack itself — once each", () => {
    const out = checkDampeningStartConsistency([
      HEADER_DERIVED,
      "0:04  [YOU] [CD]   Frozen Orb (self: 100% HP, 0%/s, 0k DPS) | dampening: 30%, next spike in 18s on 1(FMage)",
      "0:08  [DEATH]  4(FMage) (Frost Mage — enemy) | dampening: 41%",
      "0:09  [YOU] [PROC]   Nature's Guardian (self: 30% HP, -20%/s, 90k DPS) | dampening: 10%",
      "0:10  [YOU] [CD]   Ice Barrier (self: 79% HP, -1%/s, 44k DPS) | dampening: 42%",
      "0:17  [YOU] [CD]   Alter Time (self: 79% HP, +1%/s, 16k DPS) | dampening: 42%",
    ]);
    expect(out).toHaveLength(3);
    expect(out[0]).toContain("line 2");
    expect(out[0]).toContain("| dampening: 30%");
    expect(out[1]).toContain("line 4");
    expect(out[1]).toContain("| dampening: 10%");
    expect(out[2]).toContain("line 5");
    for (const f of out) expect(f).toContain("41%");
  });

  it("re-does the step: a start that is not the first logged stack minus one dose fails on the header", () => {
    const off = HEADER_DERIVED.replace("started at 41%", "started at 30%");
    const out = checkDampeningStartConsistency([off]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("line 1");
    expect(
      checkDampeningStartConsistency([
        HEADER_DERIVED.replace("one 1% step", "one 2% step"),
      ]),
    ).toHaveLength(1);
  });

  it("reads the header's second, not a fixed one", () => {
    const header =
      "DAMPENING (2v2): started at 21% (derived: one 1% step below the first logged stack, 22% at 0:12 — the log prints no value before that), ended at 31% at match end";
    expect(
      checkDampeningStartConsistency([
        header,
        "0:11  [YOU] [CD]   Barkskin (self: 60% HP, -9%/s, 80k DPS) | dampening: 22%",
      ]),
    ).toHaveLength(1);
    expect(
      checkDampeningStartConsistency([
        header,
        "0:11  [YOU] [CD]   Barkskin (self: 60% HP, -9%/s, 80k DPS) | dampening: 21%",
        "0:12  [YOU] [CD]   Barkskin (self: 60% HP, -9%/s, 80k DPS) | dampening: 22%",
      ]),
    ).toEqual([]);
  });

  it("review 40-FT-56: the clamp is the producer's — a first stack of 0 derives 0, not −1", () => {
    const zero =
      "DAMPENING (2v2): started at 0% (derived: one 1% step below the first logged stack, 0% at 0:11 — the log prints no value before that), ended at 9% at match end";
    expect(checkDampeningStartConsistency([zero])).toEqual([]);
  });

  it("review 40-FT-56: a first logged line that is a stack drop states no start — no number before its second", () => {
    const header =
      "DAMPENING (2v2): first logged 28% at 0:09 (a stack drop; the log prints no value before that), ended at 29% at match end";
    expect(
      checkDampeningStartConsistency([
        header,
        "0:04  [YOU] [CD]   Frozen Orb (self: 100% HP, 0%/s, 0k DPS) | next spike in 18s on 1(FMage)",
        "0:09  [YOU] [CD]   Ice Barrier (self: 79% HP, -1%/s, 44k DPS) | dampening: 28%",
      ]),
    ).toEqual([]);
    const out = checkDampeningStartConsistency([
      header,
      "0:00  [DAMPENING ALERT: 30%]",
      "0:04  [YOU] [CD]   Frozen Orb (self: 100% HP, 0%/s, 0k DPS) | dampening: 27%",
    ]);
    expect(out).toHaveLength(2);
  });

  it("a round without a logged stack: no dampening number anywhere in the timeline", () => {
    const header =
      "DAMPENING (2v2): n/a — no dampening stack was logged in this round (8s)";
    expect(
      checkDampeningStartConsistency([
        header,
        "0:04  [YOU] [CD]   Frozen Orb (self: 100% HP, 0%/s, 0k DPS) | next spike in 2s on 1(FMage)",
        "0:07  [DEATH]  2(FMage) (Frost Mage — friendly)",
        "0:08  [MATCH END]",
      ]),
    ).toEqual([]);
    const out = checkDampeningStartConsistency([
      header,
      "0:04  [YOU] [CD]   Frozen Orb (self: 100% HP, 0%/s, 0k DPS) | dampening: 10%",
      "0:08  [MATCH END]   damp: 10%",
    ]);
    expect(out).toHaveLength(2);
    expect(out[1]).toContain("damp: 10%");
  });

  // The gate keys on the header's wording. These run the PRODUCER's header
  // through it, so a reworded header cannot silently stop binding the lines.
  describe("the producer's own header is the one the gate reads", () => {
    const START = 1_000_000;
    const unit = (stacksAtS: Array<[number, number]>) =>
      ({
        type: 1, // CombatUnitType.Player
        auraEvents: stacksAtS.map(([s, stacks]) => {
          const parameters: unknown[] = [];
          parameters[12] = stacks;
          return {
            spellId: "110310",
            timestamp: START + s * 1000,
            logLine: { event: "SPELL_AURA_APPLIED_DOSE", parameters },
          };
        }),
      }) as never;
    const early =
      "0:04  [YOU] [CD]   Frozen Orb (self: 100% HP, 0%/s, 0k DPS) | dampening: 30%";

    it("a derived start — a 2v2 round with stacks", () => {
      const [header] = formatDampeningForContext(
        "2v2",
        [
          unit([
            [11.4, 42],
            [21.4, 43],
          ]),
        ],
        START,
        START + 100_000,
      );
      expect(header).toContain(
        "started at 41% (derived: one 1% step below the first logged stack, 42% at 0:11",
      );
      // the header alone passes: the producer's step is the gate's
      expect(checkDampeningStartConsistency([header])).toEqual([]);
      expect(checkDampeningStartConsistency([header, early])).toHaveLength(1);
      expect(
        checkDampeningStartConsistency([header, early.replace("30%", "41%")]),
      ).toEqual([]);
    });

    it("a first line that is a stack drop — the producer's header binds the lines before it", () => {
      const doseLine = (event: string, s: number, stacks: number) => {
        const parameters: unknown[] = [];
        parameters[12] = stacks;
        return {
          spellId: "110310",
          timestamp: START + s * 1000,
          logLine: { event, parameters },
        };
      };
      const dropFirst = {
        type: 1,
        auraEvents: [
          doseLine("SPELL_AURA_REMOVED_DOSE", 9, 28),
          doseLine("SPELL_AURA_APPLIED_DOSE", 19, 29),
        ],
      } as never;
      const [header] = formatDampeningForContext(
        "2v2",
        [dropFirst],
        START,
        START + 100_000,
      );
      expect(header).toContain("first logged 28% at 0:09 (a stack drop");
      expect(checkDampeningStartConsistency([header])).toEqual([]);
      expect(checkDampeningStartConsistency([header, early])).toHaveLength(1);
    });

    it("no stack at all — a 2v2 round without a logged one", () => {
      const [header] = formatDampeningForContext(
        "2v2",
        [unit([])],
        START,
        START + 8_000,
      );
      expect(checkDampeningStartConsistency([header, early])).toHaveLength(1);
    });

    it("`started at` — 3v3", () => {
      const [header] = formatDampeningForContext(
        "3v3",
        [unit([[200, 11]])],
        START,
        START + 240_000,
      );
      expect(header).toContain("started at 10%");
      expect(
        checkDampeningStartConsistency([header, early.replace("30%", "9%")]),
      ).toHaveLength(1);
      expect(
        checkDampeningStartConsistency([header, early.replace("30%", "10%")]),
      ).toEqual([]);
    });
  });

  it("the other short-match n/a line (a stated 10% that never ramped) binds nothing", () => {
    expect(
      checkDampeningStartConsistency([
        "DAMPENING (Rated Solo Shuffle): n/a — match ended (36s) before dampening ramped (10% at end)",
        "0:04  [YOU] [CD]   Frozen Orb (self: 100% HP, 0%/s, 0k DPS) | dampening: 10%",
        "0:36  [MATCH END]   damp: 10%",
      ]),
    ).toEqual([]);
  });
});
