import { describe, expect, it } from "vitest";

import {
  filterRealPresses,
  FORM_COOLDOWN_BUFF_PAIR_MS,
  isCompanionCastRow,
  isFormReshiftCast,
  isNoPressRow,
} from "./castPress";

const ev = (spellId: string, t: number) => ({
  spellId,
  logLine: { timestamp: t },
});

describe("filterRealPresses — one press, one record (#36(a))", () => {
  it("drops copy ids outright (Twin Flames set proc)", () => {
    const out = filterRealPresses([
      ev("356995", 1000), // Disintegrate-ish real press
      ev("1265980", 1000), // Twin Flames — 100% same-instant proc
    ]);
    expect(out.map((e) => e.spellId)).toEqual(["356995"]);
  });

  it("collapses the same-instant double record (Power Infusion form)", () => {
    const out = filterRealPresses([ev("10060", 5000), ev("10060", 5000)]);
    expect(out).toHaveLength(1);
  });

  it("collapses tick-spaced runs of one spellId to the first event", () => {
    // 1.00s spacing = channel ticks (Sanctified-Ground-style same-id repeats)
    const out = filterRealPresses([
      ev("289655", 1000),
      ev("289655", 2000),
      ev("289655", 3000),
    ]);
    expect(out).toHaveLength(1);
  });

  it("keeps real filler cadence: 1.4s apart are two presses — do not loosen", () => {
    const out = filterRealPresses([ev("2060", 1000), ev("2060", 2400)]);
    expect(out).toHaveLength(2);
  });

  it("keeps two genuine sub-second-ish presses of DIFFERENT spells", () => {
    const out = filterRealPresses([ev("774", 1000), ev("8936", 1200)]);
    expect(out).toHaveLength(2);
  });

  it("unsorted input still dedupes correctly and preserves original order", () => {
    // 0.6s apart = one press double-recorded slightly apart; the EARLIER event
    // survives regardless of input order.
    const a = ev("289655", 3000);
    const b = ev("289655", 2400);
    const out = filterRealPresses([a, b]);
    expect(out).toEqual([b]);
  });
});

// mutationProbe.ts (2026-10-24): 7 of 18 mutants of castPress.ts survived
// every test in the repo — each case below kills one.
describe("castPress — the lines no test pinned", () => {
  const T = 100_000;
  const PAIR = FORM_COOLDOWN_BUFF_PAIR_MS;
  const treeOfLife = (auras: Array<[string, number]>) => ({
    id: "d1",
    auraEvents: auras.map(([event, at]) => ({
      spellId: "117679",
      destUnitId: "d1",
      logLine: { event, timestamp: at },
    })),
  });
  const cast = { spellId: "33891", logLine: { timestamp: T } };
  const APPLIED = "SPELL_AURA_APPLIED";
  const REMOVED = "SPELL_AURA_REMOVED";

  it("form re-shift: an aura applied exactly PAIR ms after the cast is this cast's own", () => {
    expect(
      isFormReshiftCast(
        treeOfLife([
          [APPLIED, T - 20_000],
          [APPLIED, T + PAIR],
        ]) as never,
        cast,
      ),
    ).toBe(false);
  });
  it("form re-shift: an aura applied exactly PAIR ms before the cast is this cast's own", () => {
    expect(
      isFormReshiftCast(treeOfLife([[APPLIED, T - PAIR]]) as never, cast),
    ).toBe(false);
  });
  it("form re-shift: a buff REMOVED before the cast is not up — the cast is a press", () => {
    expect(
      isFormReshiftCast(
        treeOfLife([
          [APPLIED, T - 20_000],
          [REMOVED, T - 10_000],
        ]) as never,
        cast,
      ),
    ).toBe(false);
    // and the positive case the shape is for
    expect(
      isFormReshiftCast(treeOfLife([[APPLIED, T - 20_000]]) as never, cast),
    ).toBe(true);
  });

  const row = (spellId: string, at: number, destUnitId = "t1") => ({
    spellId,
    destUnitId,
    logLine: { timestamp: at },
  });
  it("a companion row rides only a press at the SAME target", () => {
    const rejuv = row("774", T, "t1");
    expect(isCompanionCastRow(rejuv, [rejuv, row("155777", T, "t1")])).toBe(
      true,
    );
    expect(isCompanionCastRow(rejuv, [rejuv, row("155777", T, "t2")])).toBe(
      false,
    );
  });
  it("isNoPressRow: an ordinary cast is a press; a copy id is not", () => {
    const ordinary = row("2061", T);
    expect(isNoPressRow(ordinary, [ordinary])).toBe(false);
    const copy = row("1271980", T);
    expect(isNoPressRow(copy, [copy])).toBe(true);
  });
  it("two casts of one spell exactly 1.05 s apart are two presses", () => {
    expect(filterRealPresses([ev("1", 0), ev("1", 1050)])).toHaveLength(2);
  });
});
