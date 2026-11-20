/**
 * scan5/pets `acceptedControlInstants`: which instants a summon's landed
 * control may be printed at. A press that made the control keeps
 * precedence; the summon's own instant is a truth only for a pulse no
 * press made (user ruling R90). Constructed cases (codex
 * 85-tk-CD-T184-3) — no corpus row is needed to state the rule.
 */
import { describe, expect, it } from "vitest";

import { acceptedControlInstants } from "../scripts/scan5/pets";

describe("scan5 pets acceptedControlInstants", () => {
  it("an owner press that made the control is the only accepted time, summon row or not", () => {
    // guardian summoned at 90 s, the owner casts the control at 101 s, it
    // lands at 102 s: a line printed at the summon (10 s before a 100 s
    // opener) must NOT pass
    const got = acceptedControlInstants({
      auraMs: 102_000,
      ownerPressMs: 101_000,
      summonedMs: 90_000,
      relocationMs: [],
    });
    expect(got).toEqual([101_000]);
    expect(got).not.toContain(90_000);
  });
  it("the summon's own cast of the control, with no owner press, is the time", () => {
    expect(
      acceptedControlInstants({
        auraMs: 102_000,
        sourcePressMs: 101_500,
        summonedMs: 90_000,
        relocationMs: [95_000],
      }),
    ).toEqual([101_500]);
  });
  it("a pulse no press made: the aura, the summon and every relocation since", () => {
    expect(
      acceptedControlInstants({
        auraMs: 40_799,
        summonedMs: 24_812,
        relocationMs: [30_000],
      }),
    ).toEqual([40_799, 24_812, 30_000]);
  });
  it("no summon row: the aura's own instant alone", () => {
    expect(
      acceptedControlInstants({
        auraMs: 12_000,
        summonedMs: null,
        relocationMs: [],
      }),
    ).toEqual([12_000]);
  });
});
