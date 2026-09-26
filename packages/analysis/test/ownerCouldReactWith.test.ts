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
  ownerGcdAnchorSeconds,
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

describe("ownerCouldReactWith — the owner's own CC (reliability round 2 W1a)", () => {
  // 9c9d @80: Hex bar 80.622 → 81.707, inside a Maim stun 80.366 → 85.375
  const maim = [{ from: 80.366, to: 85.375 }];

  it("a cast bar entirely inside the owner's stun → no reaction, even off the GCD", () => {
    // the real bar: start 80.622 → window [81.622, 81.707), all inside Maim
    expect(ownerCouldReactWith([], 80.622, 81.707, false, maim)).toBe(false);
    expect(ownerCouldReactWith([], 80.622, 81.707, true, maim)).toBe(false);
  });

  it("free before the stun inside the reaction window → can react", () => {
    // window [79.0 + 1, 81.707): 80.0 is before the stun starts at 80.366
    expect(
      ownerCouldReactWith([], 79.0, 81.707, false, [{ from: 80.5, to: 85 }]),
    ).toBe(true);
  });

  it("a stun that ends inside the window leaves its end as a chance to react", () => {
    expect(
      ownerCouldReactWith([], 78.0, 82.0, false, [{ from: 78.5, to: 80.5 }]),
    ).toBe(true);
  });

  it("a tool usable under CC ignores the owner's CC", () => {
    expect(ownerCouldReactWith([], 80.622, 81.707, false, maim, true)).toBe(
      true,
    );
  });

  it("without blocked intervals the old (GCD-only) answer stands", () => {
    expect(ownerCouldReactWith([], 80.622, 81.707, false)).toBe(true);
  });
});

describe("a hard cast's GCD starts with its bar (reliability round 3 W1a, b12b)", () => {
  // b12bfef4 @79: Naturalize 77.92 (success), Sleep Walk bar started 78.96 and
  // was interrupted by the Cyclone landing at 79.87 — no SPELL_CAST_SUCCESS.
  it("with only the success anchor, 79.42–79.87 reads as free to react", () => {
    expect(ownerCouldReactWith([77.92], 78.2, 79.87, true)).toBe(true);
  });
  it("the bar start is a GCD anchor too: no instant of the window is off the GCD", () => {
    expect(ownerCouldReactWith([77.92, 78.96], 78.2, 79.87, true)).toBe(false);
  });
  it("an off-GCD tool is unaffected by the bar", () => {
    expect(ownerCouldReactWith([77.92, 78.96], 78.2, 79.87, false)).toBe(true);
  });

  it("the production anchor collection takes the interrupted bar's START (no success needed)", () => {
    const T0 = 1_000_000;
    const ev = (event: string, id: string, s: number) => ({
      spellId: id,
      logLine: { event, timestamp: T0 + s * 1000 },
    });
    const owner = {
      spellCastEvents: [ev("SPELL_CAST_SUCCESS", "360823", 77.92)], // Naturalize
      castStartEvents: [ev("SPELL_CAST_START", "360806", 78.96)], // Sleep Walk, interrupted
    };
    const anchors = ownerGcdAnchorSeconds(owner, T0);
    expect(anchors.map((a) => Math.round(a * 100) / 100)).toEqual([
      77.92, 78.96,
    ]);
    expect(ownerCouldReactWith(anchors, 78.2, 79.87, true)).toBe(false);
    expect(ownerCouldReactWith(anchors, 78.2, 79.87, false)).toBe(true);
  });
});
