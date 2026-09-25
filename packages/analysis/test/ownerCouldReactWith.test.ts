/**
 * `ownerCouldReactWith` — reliability audit A4 (2026-09-24): the reaction
 * window is [castStart + REACTION_WINDOW_S, land); an on-GCD tool also needs
 * an instant of that window off the owner's GCD (INTENT_GUARD_GCD_S ceiling).
 */
import type { ICombatUnit } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  ccCastStartSeconds,
  ownerCouldReactWith,
} from "../src/analysis/candidateFindings";

describe("ownerCouldReactWith", () => {
  it("no reaction window (bar shorter than 1 s) → false, even off-GCD", () => {
    expect(ownerCouldReactWith([], 10, 10.9, false)).toBe(false);
    expect(ownerCouldReactWith([], 10, 11, false)).toBe(false); // empty [11, 11)
  });
  it("a window and no GCD casts → true for both kinds of tool", () => {
    expect(ownerCouldReactWith([], 10, 11.6, true)).toBe(true);
    expect(ownerCouldReactWith([], 10, 11.6, false)).toBe(true);
  });
  it("GCD-locked for the whole window → only an off-GCD tool still works (825ca842 @244 shape)", () => {
    // bar 243.34 → land 244.96; Judgment at 243.50 locks to 245.00
    expect(ownerCouldReactWith([243.5], 243.34, 244.96, true)).toBe(false);
    expect(ownerCouldReactWith([243.5], 243.34, 244.96, false)).toBe(true);
  });
  it("a GCD ending inside the window leaves a free instant", () => {
    expect(ownerCouldReactWith([9.5], 10, 11.6, true)).toBe(true); // free from 11.0
    expect(ownerCouldReactWith([10.2], 10, 12, true)).toBe(true); // free from 11.7
  });
  it("back-to-back GCD casts covering the window → false", () => {
    expect(ownerCouldReactWith([10.2, 11.7], 10, 13, true)).toBe(false);
  });
});

describe("ccCastStartSeconds — the start of the cast that LANDED", () => {
  const T0 = 1_000_000;
  const at = (s: number) => T0 + s * 1000;
  const druid = {
    id: "d",
    castStartEvents: [
      { spellId: "33786", timestamp: at(34.328) },
      { spellId: "33786", timestamp: at(35.469) }, // the NEXT Cyclone
    ],
    spellCastEvents: [
      {
        spellId: "33786",
        timestamp: at(35.468),
        logLine: { event: "SPELL_CAST_SUCCESS" },
      },
    ],
  } as unknown as ICombatUnit;

  it("a chain-caster's next start between the success and the aura is not this cast's bar (823c3f89 r4 @178)", () => {
    expect(
      ccCastStartSeconds(
        [druid],
        [],
        { atSeconds: 35.477, spellId: "33786" },
        T0,
      ),
    ).toBeCloseTo(34.328, 6);
  });

  it("no success event in the log → the latest start before the landing (the old rule)", () => {
    const noSuccess = {
      ...druid,
      spellCastEvents: [],
    } as unknown as ICombatUnit;
    expect(
      ccCastStartSeconds(
        [noSuccess],
        [],
        { atSeconds: 35.477, spellId: "33786" },
        T0,
      ),
    ).toBeCloseTo(35.469, 6);
  });
});
