/**
 * scan5/pressEffect `noPressButPressed`: a `[no press logged]` line may be a
 * proc's own line (T259 / B192, 11346ea9 r1 1:53: Frenzied Regeneration
 * pressed at .198, then a Well-Honed Instincts proc REFRESH at .937) — only
 * when the second's lines pair one to one, in order, with its activations and
 * the tagged line's activation is an unpressed REFRESH.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  activationsInSecond,
  isProcOwnNoPressLine,
} from "../scripts/scan5/pressEffect";

const A = LogEvent.SPELL_AURA_APPLIED as string;
const R = LogEvent.SPELL_AURA_REFRESH as string;

// 11346ea9: APPLIED .197, press .198, REFRESH + 382912 at .937
const druid = activationsInSecond(
  [
    { event: R, ts: 113_937 },
    { event: A, ts: 113_197 },
  ],
  [113_198],
  [113_937],
  113_000,
);

describe("scan5/pressEffect activationsInSecond", () => {
  it("orders the second's APPLIED / REFRESH rows and marks which a press explains", () => {
    expect(druid).toEqual([
      { refresh: false, pressed: true, proc: false },
      { refresh: true, pressed: false, proc: true },
    ]);
  });
  it("a REFRESH beside a press, or followed by one, is pressed (D27 163de8f1 1:00)", () => {
    const sotf = [
      { event: A, ts: 60_584 },
      { event: R, ts: 60_932 },
    ];
    for (const p of [60_932, 60_960])
      expect(activationsInSecond(sotf, [p], [], 60_000)[1]!.pressed).toBe(true);
    // a press in the next second: its line sits at its cast (B192 review 8)
    expect(activationsInSecond(sotf, [61_400], [], 61_000)).toEqual([
      { refresh: true, pressed: true, proc: false },
    ]);
  });
  it("only rows inside the line's second count", () => {
    const rows = [
      { event: A, ts: 60_100 },
      { event: R, ts: 61_200 },
    ];
    expect(activationsInSecond(rows, [], [], 60_000)).toHaveLength(1);
  });
  it("B192 review 3, 11dfa802 r3: one press goes to one activation — the nearest", () => {
    // APPLIED .906, press .907, REFRESH .921 (the producer's proc row; marker .922)
    const acts = activationsInSecond(
      [
        { event: A, ts: 57_906 },
        { event: R, ts: 57_921 },
      ],
      [57_907],
      [57_921],
      57_000,
    );
    expect(acts.map((a) => [a.pressed, a.proc])).toEqual([
      [true, false],
      [false, true],
    ]);
    expect(isProcOwnNoPressLine(1, 2, acts)).toBe(true);
  });
  it("B192 review 4, bf679e40 r1: a press beside its own row in the next second is that row's", () => {
    // proc APPLIED + marker 52.172; press 53.500 beside its REFRESH 53.500
    const acts = activationsInSecond(
      [
        { event: A, ts: 52_172 },
        { event: R, ts: 53_500 },
      ],
      [53_500],
      [52_172],
      52_000,
    );
    expect(acts).toEqual([{ refresh: false, pressed: false, proc: true }]);
    expect(isProcOwnNoPressLine(0, 1, acts)).toBe(true);
  });
  it("B192 review 7 (constructed): a press 1 ms before the proc's row is never the proc's", () => {
    // APPLIED .170, press .199, REFRESH + fresh marker .200 (the producer's proc row)
    const acts = activationsInSecond(
      [
        { event: A, ts: 10_170 },
        { event: R, ts: 10_200 },
      ],
      [10_199],
      [10_200],
      10_000,
    );
    expect(acts.map((a) => [a.pressed, a.proc])).toEqual([
      [true, false],
      [false, true],
    ]);
    expect(isProcOwnNoPressLine(1, 2, acts)).toBe(true);
    expect(isProcOwnNoPressLine(0, 2, acts)).toBe(false);
  });
  it("B192 review 7 (constructed): a re-listed marker is no proc — the press's REFRESH stays pressed", () => {
    // proc 10.000 (the producer's proc row); 11.000 cast + REFRESH + a re-listed marker
    const acts = activationsInSecond(
      [
        { event: A, ts: 10_000 },
        { event: R, ts: 11_000 },
      ],
      [11_000],
      [10_000],
      11_000,
    );
    expect(acts).toEqual([{ refresh: true, pressed: true, proc: false }]);
    expect(isProcOwnNoPressLine(0, 1, acts)).toBe(false);
  });
  it("B192 review 8 (constructed): lines in rendered order — a press's line sits at its cast", () => {
    // APPLIED .170, the proc's REFRESH .200, the cast .201: the proc line renders first
    const acts = activationsInSecond(
      [
        { event: A, ts: 10_170 },
        { event: R, ts: 10_200 },
      ],
      [10_201],
      [10_200],
      10_000,
    );
    expect(acts.map((a) => [a.pressed, a.proc])).toEqual([
      [false, true],
      [true, false],
    ]);
    expect(isProcOwnNoPressLine(0, 2, acts)).toBe(true);
    expect(isProcOwnNoPressLine(1, 2, acts)).toBe(false);
  });
  it("B192 review 8 (constructed): one proc row in a millisecond with two rows marks one", () => {
    // APPLIED + REFRESH + fresh marker at .200, the cast .201
    const acts = activationsInSecond(
      [
        { event: A, ts: 10_200 },
        { event: R, ts: 10_200 },
      ],
      [10_201],
      [10_200],
      10_000,
    );
    expect(acts.map((a) => [a.pressed, a.proc])).toEqual([
      [false, true],
      [true, false],
    ]);
    expect(isProcOwnNoPressLine(1, 2, acts)).toBe(false);
  });
});

describe("scan5/pressEffect isProcOwnNoPressLine", () => {
  it("11346ea9 as rendered: press line untagged, the second (proc) line tagged — exempt", () => {
    expect(isProcOwnNoPressLine(1, 2, druid)).toBe(true);
  });
  it("B192 review 1: both lines tagged — the press's tagged line is not exempt", () => {
    expect(isProcOwnNoPressLine(0, 2, druid)).toBe(false);
  });
  it("B192 review 2: tags swapped — the press's tagged line is not exempt", () => {
    expect(isProcOwnNoPressLine(0, 2, druid)).toBe(false);
  });
  it("B192 review 3 (constructed): an unmarked REFRESH a press missed by 83 ms exempts nothing", () => {
    // Blur: APPLIED 130.167 + cast .168; cast .570, its REFRESH .653
    const acts = activationsInSecond(
      [
        { event: A, ts: 130_167 },
        { event: R, ts: 130_653 },
      ],
      [130_168, 130_570],
      [],
      130_000,
    );
    expect(isProcOwnNoPressLine(1, 2, acts)).toBe(false);
  });
  it("lines and activations that do not pair one to one exempt nothing", () => {
    expect(isProcOwnNoPressLine(1, 3, druid)).toBe(false);
    expect(isProcOwnNoPressLine(0, 1, druid.slice(1))).toBe(true);
    expect(isProcOwnNoPressLine(0, 1, druid)).toBe(false);
    expect(isProcOwnNoPressLine(-1, 2, druid)).toBe(false);
  });
});
