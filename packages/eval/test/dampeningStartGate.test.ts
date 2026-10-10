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
