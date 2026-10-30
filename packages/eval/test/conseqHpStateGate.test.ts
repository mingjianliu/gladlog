import { describe, expect, it } from "vitest";

import { checkConseqHpStateConsistency } from "../src/quality/promptQualityCheck";

const state = (t: string, f: string, e = "4(AWarlock):90") =>
  `${t}  [STATE]   friends ${f} / enemies ${e}`;
const CC =
  "1:00  [CONSEQ]   friendly healer 1(HPriest) in Fear for 3s → during it: 2(AWarrior) 80% → low 59% at 1:02";
const QUIET =
  "1:00  [CONSEQ]   friendly healer 1(HPriest) in Fear for 3s → during it: no teammate dropped 10% or more";
const KICK =
  "0:46  [CONSEQ]   enemy healer 5(RDruid) kicked (Regrowth; 4s school lockout) → inside the lockout: 4(AWarlock) 90% → low 70% at 0:48";

describe("checkConseqHpStateConsistency (GH #70 — [CONSEQ] ⟺ [STATE] grid)", () => {
  it("start, low and trough agree with the ticks → passes", () => {
    expect(
      checkConseqHpStateConsistency([
        state("1:00", "1(HPriest):99 2(AWarrior):80"),
        state("1:01", "2(AWarrior):66"),
        state("1:02", "2(AWarrior):59"),
        CC,
      ]),
    ).toEqual([]);
  });
  // user ruling 2026-10-21 (F16 retest idx 15): the start is the reading at
  // the event's own instant, not its second's tick — a different tick is no
  // contradiction; the start must agree with the line's own claim
  it("a start other than the same-second tick passes (0c8b1932: tick 47, landing 64)", () => {
    expect(
      checkConseqHpStateConsistency([state("1:00", "2(AWarrior):84"), CC]),
    ).toEqual([]);
  });
  it("the printed readings must agree with the claim: a drop part under 10, a held reading of 10+ → red", () => {
    const under =
      "1:00  [CONSEQ]   friendly healer 1(HPriest) in Fear for 3s → during it: 2(AWarrior) 80% → low 75% at 1:02";
    expect(checkConseqHpStateConsistency([under])).toHaveLength(1);
    const heldTooFar =
      "1:00  [CONSEQ]   friendly healer 1(HPriest) in Fear for 3s → during it: no teammate dropped 10% or more (2(AWarrior) 64% → low 38% at 1:02)";
    expect(checkConseqHpStateConsistency([heldTooFar])).toHaveLength(1);
    const held =
      "1:00  [CONSEQ]   friendly healer 1(HPriest) in Fear for 3s → during it: no teammate dropped 10% or more (2(AWarrior) 64% → low 58% at 1:02)";
    expect(checkConseqHpStateConsistency([held])).toEqual([]);
    // a held reading's low is a trough too: a tick inside the span below it
    expect(
      checkConseqHpStateConsistency([state("1:02", "2(AWarrior):50"), held]),
    ).toHaveLength(1);
  });
  it("a tick below the printed low inside the span → red", () => {
    const f = checkConseqHpStateConsistency([
      state("1:02", "2(AWarrior):41"),
      CC,
    ]);
    expect(f.some((x) => x.includes("41%"))).toBe(true);
  });
  it("the span's second rendered second is an edge: its tick can read a sample from before the CC landed (fact2)", () => {
    expect(
      checkConseqHpStateConsistency([state("1:01", "2(AWarrior):41"), CC]),
    ).toEqual([]);
  });
  it("enemy side reads the enemies half of [STATE]", () => {
    expect(
      checkConseqHpStateConsistency([
        state("0:46", "2(AWarrior):20", "4(AWarlock):90"),
        state("0:48", "2(AWarrior):20", "4(AWarlock):70"),
        KICK,
      ]),
    ).toEqual([]);
    // the enemy's tick BELOW the printed low → red (the friendly half's 60
    // is another unit's number and is not read)
    expect(
      checkConseqHpStateConsistency([
        state("0:48", "2(AWarrior):60", "4(AWarlock):65"),
        KICK,
      ]),
    ).toHaveLength(1);
  });
  // FT-T03 (user ruling 2026-10-10, D7): the low is a trough — the true
  // minimum inside the span, not the tick of its second.
  it("FT-T03: a low BELOW the tick of its own second → passes (121c7e15: tick 32, low 22)", () => {
    expect(
      checkConseqHpStateConsistency([
        state("1:00", "1(HPriest):99 2(AWarrior):80"),
        state("1:02", "2(AWarrior):70"),
        CC,
      ]),
    ).toEqual([]);
    expect(
      checkConseqHpStateConsistency([
        state("0:48", "2(AWarrior):70", "4(AWarlock):75"),
        KICK,
      ]),
    ).toEqual([]);
  });
  it("FT-T03: a tick below the low at the low's own second is red, past the sure span too", () => {
    // `for 3s` covers 1:00–1:02 for sure; the low is stamped at 1:03
    const LATE = CC.replace("at 1:02", "at 1:03");
    const f = checkConseqHpStateConsistency([
      state("1:03", "2(AWarrior):50"),
      LATE,
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain("低点");
    expect(
      checkConseqHpStateConsistency([state("1:03", "2(AWarrior):64"), LATE]),
    ).toEqual([]);
  });
  it('"no teammate dropped" with a 10+ point drop in the span → red; the healer itself is exempt', () => {
    expect(
      checkConseqHpStateConsistency([
        state("1:00", "1(HPriest):99 2(AWarrior):80"),
        state("1:01", "1(HPriest):50 2(AWarrior):75"),
        QUIET,
      ]),
    ).toEqual([]);
    const f = checkConseqHpStateConsistency([
      state("1:00", "2(AWarrior):80"),
      state("1:02", "2(AWarrior):65"),
      QUIET,
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain("no teammate dropped");
  });
  it('hp-state F-C1 / cc-dr F-CS1: "no surviving teammate dropped" (and a silence line) is checked the same way', () => {
    const SURVIVING =
      "1:00  [CONSEQ]   friendly healer 1(HPriest) in Strangulate (silence) for 3s → during it: no surviving teammate dropped 10% or more; died inside it: 3(RPaladin)";
    // the living teammate held → passes; the dead one has no numeric tick
    expect(
      checkConseqHpStateConsistency([
        state("1:00", "2(AWarrior):80 3(RPaladin):40"),
        state("1:02", "2(AWarrior):78 3(RPaladin):dead"),
        SURVIVING,
      ]),
    ).toEqual([]);
    // the living teammate dropped 15 → red
    expect(
      checkConseqHpStateConsistency([
        state("1:00", "2(AWarrior):80 3(RPaladin):40"),
        state("1:02", "2(AWarrior):65 3(RPaladin):dead"),
        SURVIVING,
      ]),
    ).toHaveLength(1);
  });
  it("dead ticks and seconds without a tick are not failures", () => {
    expect(
      checkConseqHpStateConsistency([state("1:01", "2(AWarrior):dead"), CC]),
    ).toEqual([]);
  });
});
