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
  113_000,
);

describe("scan5/pressEffect activationsInSecond", () => {
  it("orders the second's APPLIED / REFRESH rows and marks which a press explains", () => {
    expect(druid).toEqual([
      { refresh: false, pressed: true },
      { refresh: true, pressed: false },
    ]);
  });
  it("a REFRESH beside a press, or followed by one, is pressed (D27 163de8f1 1:00)", () => {
    const sotf = [
      { event: A, ts: 60_584 },
      { event: R, ts: 60_932 },
    ];
    for (const p of [60_932, 60_960, 61_400])
      expect(activationsInSecond(sotf, [p], 60_000)[1]!.pressed).toBe(true);
  });
  it("only rows inside the line's second count", () => {
    const rows = [
      { event: A, ts: 60_100 },
      { event: R, ts: 61_200 },
    ];
    expect(activationsInSecond(rows, [], 60_000)).toHaveLength(1);
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
  it("lines and activations that do not pair one to one exempt nothing", () => {
    expect(isProcOwnNoPressLine(1, 3, druid)).toBe(false);
    expect(isProcOwnNoPressLine(0, 1, druid.slice(1))).toBe(true);
    expect(isProcOwnNoPressLine(0, 1, druid)).toBe(false);
    expect(isProcOwnNoPressLine(-1, 2, druid)).toBe(false);
  });
});
