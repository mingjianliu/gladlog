import { describe, expect, it } from "vitest";

import {
  COPY_CAST_IDS,
  filterRealPresses,
  FORM_COOLDOWN_BUFF_PAIR_MS,
  isCompanionCastRow,
  isFormReshiftCast,
  isNoPressRow,
} from "./castPress";
import { isInstantCast } from "./spellMechanics";

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
  it("Evangelism's own Radiance row rides the Evangelism press; a lone Radiance is a press", () => {
    const radiance = row("194509", T - 1, "t1");
    expect(isNoPressRow(radiance, [radiance, row("472433", T, "t1")])).toBe(
      true,
    );
    expect(isNoPressRow(radiance, [radiance])).toBe(false);
    expect(
      isNoPressRow(radiance, [radiance, row("472433", T + 2_000, "t1")]),
    ).toBe(false);
    // a busy log writes it up to 63 ms ahead of the Evangelism row …
    expect(
      isNoPressRow(radiance, [radiance, row("472433", T + 63, "t1")]),
    ).toBe(true);
    // … never after it, and never at another target
    expect(
      isNoPressRow(radiance, [radiance, row("472433", T - 20, "t1")]),
    ).toBe(false);
    expect(isNoPressRow(radiance, [radiance, row("472433", T, "t2")])).toBe(
      false,
    );
  });
  it("a hard-cast Radiance completed just before Evangelism stays a press (codex r1)", () => {
    const hard = row("194509", T - 50, "t1");
    const own = row("194509", T - 1, "t1");
    const rows = [hard, own, row("472433", T, "t1")];
    expect(isNoPressRow(hard, rows)).toBe(false);
    expect(isNoPressRow(own, rows)).toBe(true);
    expect(filterRealPresses(rows)).toHaveLength(2);
  });
  it("two Radiance rows at one distance: one is the companion, one a press (codex r2)", () => {
    const a = row("194509", T - 1, "t1");
    const b = row("194509", T - 1, "t1");
    const rows = [a, b, row("472433", T, "t1")];
    expect([isNoPressRow(a, rows), isNoPressRow(b, rows)]).toEqual([
      true,
      false,
    ]);
  });
  it("Germination's companion keeps its own 5 ms both ways", () => {
    const rejuv = row("774", T, "t1");
    expect(isCompanionCastRow(rejuv, [rejuv, row("155777", T + 5, "t1")])).toBe(
      true,
    );
    expect(
      isCompanionCastRow(rejuv, [rejuv, row("155777", T + 20, "t1")]),
    ).toBe(false);
    expect(isCompanionCastRow(rejuv, [rejuv, row("155777", T - 5, "t1")])).toBe(
      true,
    );
  });
  it("isNoPressRow: an ordinary cast is a press; a copy id is not", () => {
    const ordinary = row("2061", T);
    expect(isNoPressRow(ordinary, [ordinary])).toBe(false);
    const copy = row("1271980", T);
    expect(isNoPressRow(copy, [copy])).toBe(true);
  });
  // fact7 r1, 59978653 r1 0:30: 450215 sat in the table as a channel tick for
  // its 1 s spacing, and its four casts into Pain Suppression left ABILITIES
  // INTO. Chained hard casts under haste space like ticks; a tick has no bar.
  it("Void Blast is a press: a hard cast chained at tick spacing is no tick", () => {
    const voidBlast = row("450215", T);
    expect(isNoPressRow(voidBlast, [voidBlast])).toBe(false);
  });
  it("no not-a-press row carries a cast time of its own (DB2)", () => {
    expect(
      [...COPY_CAST_IDS.keys()].filter((id) => !isInstantCast(id)),
    ).toEqual([]);
  });
  it("two casts of one spell exactly 1.05 s apart are two presses", () => {
    expect(filterRealPresses([ev("1", 0), ev("1", 1050)])).toHaveLength(2);
  });
});
