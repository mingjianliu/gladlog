/**
 * Triage 2026-09-29 G9, cc-dr F-CI1: a CC clipped to the round end ends at
 * the round-ending death exactly. "Died inside it" (`mateHitDuringCc`, the
 * [CONSEQ] / death-setup predicate) compares whole ms — the float sum
 * `at + duration` can land a hair before the death (92-1: a Polymorph on the
 * healer through the death lost its death-setup on the 605 capture).
 */
import { describe, expect, it } from "vitest";

import { mateHitDuringCc } from "../src/context/observedConsequences";
import { makeUnit } from "./ported/testHelpers";

const START = 1_000_000;

describe("cc-dr F-CI1 — the death at a clipped CC's end is inside it", () => {
  it("compares whole ms, not the float sum at + duration", () => {
    // applied 148.003, clipped to the death at 152.901: 148.003 + 4.898 is
    // 152.90099999999998 in floating point
    const mate = makeUnit("m", {
      deathRecords: [{ timestamp: START + 152_901 }],
    });
    expect(
      mateHitDuringCc(mate, START, {
        atSeconds: 148.003,
        durationSeconds: 4.898,
      }),
    ).toBe(true);
  });

  it("control: a death 1 ms after the end is not inside it", () => {
    const mate = makeUnit("m", {
      deathRecords: [{ timestamp: START + 152_902 }],
    });
    expect(
      mateHitDuringCc(mate, START, {
        atSeconds: 148.003,
        durationSeconds: 4.898,
      }),
    ).toBe(false);
  });
});
