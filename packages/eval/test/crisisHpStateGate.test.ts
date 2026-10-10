import { describe, expect, it } from "vitest";

import {
  checkCrisisHpStateConsistency,
  checkCrisisStateTickPresent,
  crisisHpProbeMismatch,
  crisisHpStateProbes,
} from "../src/quality/promptQualityCheck";

/**
 * 11th hardFailure class (2026-08-30): a cd-hoarded / crisis-no-response menu
 * line's HP claim must equal the same-second [STATE] tick's reading for the
 * same unit. Measured before the analysis-side render-grid anchor
 * (crisisDecisionPoints' `anchorToRenderGrid` + the shared `gridHpPct`
 * sampler): cd-hoarded 155/167 covered lines, crisis-no-response 7/8, over the
 * 309-prompt A/B corpus.
 */
const ROSTER = [
  '  <unit id="1" name="Heals-R" spec="Restoration Shaman" role="log owner">',
  '  <unit id="2" name="Tank-T" spec="Fury Warrior" role="teammate">',
  '  <unit id="4" name="Foe-F" spec="Marksmanship Hunter" role="enemy">',
];
const STATE_27 = "0:27  [STATE]   friends 1(RShaman):71 2(FWarrior):38";
const STATE_77 = "1:17  [STATE]   friends 1(RShaman):39 2(FWarrior):64";

const cdHoarded = (t: string, unit: string, hpPct: string) =>
  `  - id=cd-hoarded:P1:P2:${t} type=cd-hoarded t=${t}s units=Heals-R/${unit} ` +
  `facts={t=${t}, crisisUnit=${unit}, crisisHpPct=${hpPct}, dmg2sPct=23, readyCds=Spirit Link Totem, own=no, refDeathSpent=4.5, refDeathHeld=11.4, refN=16960}`;
const crisisNoResponse = (t: string, unit: string, hpPct: string) =>
  `  - id=crisis-no-response:P1:${t} type=crisis-no-response t=${t}s units=${unit} ` +
  `facts={t=${t}, unit=${unit}, hpPct=${hpPct}, dmg2sPct=24, attackers=1, burst=yes, cellKey=3v3|healer|>=20%, fellBack=no}`;

describe("checkCrisisHpStateConsistency (11th hardFailure class)", () => {
  it("fact HP equal to the same-second [STATE] tick → passes", () => {
    expect(
      checkCrisisHpStateConsistency([
        ...ROSTER,
        STATE_27,
        STATE_77,
        cdHoarded("27", "Tank-T", "38"),
        crisisNoResponse("77.0", "Heals-R", "39"),
      ]),
    ).toEqual([]);
  });

  it("planted mismatch: cd-hoarded says 39% while the 0:27 [STATE] tick says 38% → red", () => {
    const fails = checkCrisisHpStateConsistency([
      ...ROSTER,
      STATE_27,
      cdHoarded("27", "Tank-T", "39"),
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("cd-hoarded");
    expect(fails[0]).toContain("Tank-T");
    expect(fails[0]).toContain("0:27");
    expect(fails[0]).toContain("39%");
    expect(fails[0]).toContain("38%");
  });

  it("planted mismatch: crisis-no-response's fractional t floors onto the [STATE] grid before comparing (77.9 → 1:17)", () => {
    const fails = checkCrisisHpStateConsistency([
      ...ROSTER,
      STATE_77,
      crisisNoResponse("77.9", "Heals-R", "35"),
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("crisis-no-response");
    expect(fails[0]).toContain("1:17");
  });

  it("a `dead` [STATE] tick against a numeric HP fact is a failure too", () => {
    const fails = checkCrisisHpStateConsistency([
      ...ROSTER,
      "0:27  [STATE]   friends 1(RShaman):71 2(FWarrior):dead",
      cdHoarded("27", "Tank-T", "38"),
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("dead");
  });

  it("no [STATE] tick at that second, or none carrying the unit, is NOT a failure — STATE is emitted only inside critical windows", () => {
    expect(
      checkCrisisHpStateConsistency([
        ...ROSTER,
        STATE_27,
        // 0:31 has no STATE line at all
        cdHoarded("31", "Tank-T", "12"),
        // 0:27's tick does not carry id 4 (enemy, outside a critical window)
        cdHoarded("27", "Foe-F", "12"),
      ]),
    ).toEqual([]);
    // …but both lines are still counted as scanned, so the standing
    // measurement can report coverage rather than silently shrinking its
    // denominator.
    const probes = crisisHpStateProbes([
      ...ROSTER,
      STATE_27,
      cdHoarded("31", "Tank-T", "12"),
      cdHoarded("27", "Foe-F", "12"),
    ]);
    expect(probes).toHaveLength(2);
    expect(probes.every((p) => p.stateHp === null)).toBe(true);
  });

  it("`ghost` (Spirit of Redemption) is a third state no HP fact can equal — reported as uncovered, never as a mismatch", () => {
    const lines = [
      ...ROSTER,
      "0:27  [STATE]   friends 1(RShaman):ghost 2(FWarrior):38",
      crisisNoResponse("27", "Heals-R", "35"),
    ];
    expect(checkCrisisHpStateConsistency(lines)).toEqual([]);
    expect(crisisHpStateProbes(lines)[0]!.stateHp).toBeNull();
  });

  it("a unit missing from the <unit id=…> roster cannot be cross-checked and is not accused", () => {
    expect(
      checkCrisisHpStateConsistency([
        STATE_27,
        cdHoarded("27", "Tank-T", "99"),
      ]),
    ).toEqual([]);
  });
});

// FT-T03 (user ruling 2026-10-10, D7): "the 'trough' numbers may leave the
// whole-second grid and read the true minimum inside their window; the
// [STATE] point readings, the crisis crossing instants and cd-hoarded's
// `crisisHpPct` do NOT move".
describe("checkCrisisHpStateConsistency — a trough fact is not a point reading (FT-T03)", () => {
  const kickEaten = (ourLowPct: string, ourLowT: string) =>
    `  - id=kick-eaten:P1:26.4 type=kick-eaten t=26.4s units=Heals-R ` +
    `facts={t=26.4, interrupted=Healing Wave, lockout=3, ourLowUnit=Tank-T, ourLowPct=${ourLowPct}, ourLowT=${ourLowT}, enemyBurst=Trueshot}`;

  it("kick-eaten: a low BELOW the tick of its own second → passes (the tick is the start of that second)", () => {
    // 0:27 tick: Tank-T 38; the lowest reading inside that second was 12
    expect(
      checkCrisisHpStateConsistency([
        ...ROSTER,
        STATE_27,
        kickEaten("12", "27"),
      ]),
    ).toEqual([]);
    expect(
      checkCrisisHpStateConsistency([
        ...ROSTER,
        STATE_27,
        kickEaten("38", "27"),
      ]),
    ).toEqual([]);
  });

  it("kick-eaten: a tick below the low → red; a `dead` tick → red", () => {
    const fails = checkCrisisHpStateConsistency([
      ...ROSTER,
      STATE_27,
      kickEaten("40", "27"),
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("kick-eaten");
    expect(fails[0]).toContain("40%");
    expect(fails[0]).toContain("38%");
    expect(
      checkCrisisHpStateConsistency([
        ...ROSTER,
        "0:27  [STATE]   friends 1(RShaman):71 2(FWarrior):dead",
        kickEaten("12", "27"),
      ]),
    ).toHaveLength(1);
  });

  it("slow-defensive-response: `pressuredHpPct` is a trough too — below its `pressuredHpT` tick passes, above it is red", () => {
    const slow = (hp: string) =>
      `  - id=slow-defensive-response:P1:20 type=slow-defensive-response t=20s units=Heals-R ` +
      `facts={t=20, leadCd=Deathmark, pressured=Tank-T, pressuredHpPct=${hp}, pressuredHpT=27, diedInWindow=no}`;
    // 0:27 tick: Tank-T 38
    expect(
      checkCrisisHpStateConsistency([...ROSTER, STATE_27, slow("9")]),
    ).toEqual([]);
    expect(
      checkCrisisHpStateConsistency([...ROSTER, STATE_27, slow("38")]),
    ).toEqual([]);
    const fails = checkCrisisHpStateConsistency([
      ...ROSTER,
      STATE_27,
      slow("41"),
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("slow-defensive-response");
    expect(
      crisisHpStateProbes([...ROSTER, STATE_27, slow("9")])[0]!.trough,
    ).toBe(true);
  });

  it("the point readings did not move: cd-hoarded one point under its tick is still red", () => {
    expect(
      checkCrisisHpStateConsistency([
        ...ROSTER,
        STATE_27,
        cdHoarded("27", "Tank-T", "37"),
      ]),
    ).toHaveLength(1);
  });

  it("the probe says which kind it is, and one predicate judges both (the scan script's count)", () => {
    const probes = crisisHpStateProbes([
      ...ROSTER,
      STATE_27,
      cdHoarded("27", "Tank-T", "37"),
      kickEaten("12", "27"),
    ]);
    expect(probes.map((p) => [p.type, p.trough])).toEqual([
      ["cd-hoarded", false],
      ["kick-eaten", true],
    ]);
    expect(probes.map(crisisHpProbeMismatch)).toEqual([true, false]);
  });
});

// triage 2026-09-29 H18: the crisis second always has a [STATE] tick
describe("checkCrisisStateTickPresent", () => {
  it("a tick carrying the crisis unit → passes", () => {
    expect(
      checkCrisisStateTickPresent([
        ...ROSTER,
        STATE_27,
        STATE_77,
        cdHoarded("27", "Tank-T", "38"),
        crisisNoResponse("77.0", "Heals-R", "39"),
      ]),
    ).toEqual([]);
  });

  it("no tick at the crisis second, or one without the unit → red", () => {
    const fails = checkCrisisStateTickPresent([
      ...ROSTER,
      STATE_27,
      cdHoarded("31", "Tank-T", "12"),
      "0:40  [STATE]   friends 1(RShaman):71",
      cdHoarded("40", "Tank-T", "33"),
    ]);
    expect(fails).toHaveLength(2);
    expect(fails[0]).toContain("0:31");
    expect(fails[1]).toContain("0:40");
  });

  it("other crisis-HP types (slow-defensive-response's window minimum) are not anchors → not checked", () => {
    expect(
      checkCrisisStateTickPresent([
        ...ROSTER,
        "  - id=slow-defensive-response:P1:40 type=slow-defensive-response t=40s units=Heals-R facts={t=40, pressured=Tank-T, pressuredHpPct=31, pressuredHpT=45}",
      ]),
    ).toEqual([]);
  });
});
