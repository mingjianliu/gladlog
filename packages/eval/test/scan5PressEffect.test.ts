/**
 * scan5/pressEffect `noPressButPressed`: a `[no press logged]` line in a
 * second that also holds an unpressed REFRESH (a proc refreshing the aura the
 * press put up) may be that proc's own line (T259 / B192, 11346ea9 r1 1:53) —
 * but only while the press there keeps a line of its own without the tag.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  isProcOwnNoPressLine,
  unpressedRefreshesInSecond,
} from "../scripts/scan5/pressEffect";

const A = LogEvent.SPELL_AURA_APPLIED as string;
const R = LogEvent.SPELL_AURA_REFRESH as string;

describe("scan5/pressEffect unpressedRefreshesInSecond", () => {
  it("a proc REFRESH 0.7 s after the press's APPLIED is an activation of its own", () => {
    // 11346ea9: APPLIED .197, press .198, REFRESH + 382912 at .937
    const auras = [
      { event: A, ts: 113_197 },
      { event: R, ts: 113_937 },
    ];
    expect(unpressedRefreshesInSecond(auras, [113_198], 113_000)).toBe(1);
  });
  it("a REFRESH beside a press, or followed by one, is that press (D27 stays a violation)", () => {
    // 163de8f1 1:00: SotF APPLIED .584, the hunter's own press at .932 refreshing it
    const auras = [
      { event: A, ts: 60_584 },
      { event: R, ts: 60_932 },
    ];
    expect(unpressedRefreshesInSecond(auras, [60_932], 60_000)).toBe(0);
    expect(unpressedRefreshesInSecond(auras, [60_960], 60_000)).toBe(0);
    expect(unpressedRefreshesInSecond(auras, [61_400], 60_000)).toBe(0);
  });
  it("only a REFRESH inside the line's second counts", () => {
    const auras = [
      { event: A, ts: 60_100 },
      { event: R, ts: 61_200 },
    ];
    expect(unpressedRefreshesInSecond(auras, [60_101], 60_000)).toBe(0);
    expect(
      unpressedRefreshesInSecond([{ event: A, ts: 60_500 }], [], 60_000),
    ).toBe(0);
  });
});

describe("scan5/pressEffect isProcOwnNoPressLine", () => {
  it("11346ea9 as rendered: the press keeps its labelled line, the one tagged line is the proc's", () => {
    expect(isProcOwnNoPressLine(0, 1, 1, 1)).toBe(true);
  });
  it("B192 review mutation: the press relabelled [no press logged] beside the proc is still caught", () => {
    // both lines tagged, no labelled line for the logged press
    expect(isProcOwnNoPressLine(0, 1, 0, 1)).toBe(false);
    expect(isProcOwnNoPressLine(1, 1, 0, 1)).toBe(false);
  });
  it("no more tagged lines are exempt than there are unpressed REFRESHes", () => {
    expect(isProcOwnNoPressLine(1, 1, 1, 1)).toBe(false);
    expect(isProcOwnNoPressLine(0, 0, 1, 1)).toBe(false);
  });
});
