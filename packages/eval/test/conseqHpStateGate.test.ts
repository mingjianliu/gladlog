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
  it("a start that disagrees with the same-second tick → red", () => {
    const f = checkConseqHpStateConsistency([
      state("1:00", "2(AWarrior):84"),
      CC,
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain("起点");
  });
  it("a tick below the printed low inside the span → red", () => {
    const f = checkConseqHpStateConsistency([
      state("1:01", "2(AWarrior):41"),
      CC,
    ]);
    expect(f.some((x) => x.includes("41%"))).toBe(true);
  });
  it("enemy side reads the enemies half of [STATE]", () => {
    expect(
      checkConseqHpStateConsistency([
        state("0:46", "2(AWarrior):20", "4(AWarlock):90"),
        state("0:48", "2(AWarrior):20", "4(AWarlock):70"),
        KICK,
      ]),
    ).toEqual([]);
    expect(
      checkConseqHpStateConsistency([
        state("0:48", "2(AWarrior):70", "4(AWarlock):75"),
        KICK,
      ]),
    ).toHaveLength(1);
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
  it("dead ticks and seconds without a tick are not failures", () => {
    expect(
      checkConseqHpStateConsistency([state("1:01", "2(AWarrior):dead"), CC]),
    ).toEqual([]);
  });
});
