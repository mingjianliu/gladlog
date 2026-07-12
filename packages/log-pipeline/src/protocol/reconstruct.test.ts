import { describe, expect, it } from "vitest";

import { nextAction } from "./reconstruct";

describe("nextAction (overlap-aware)", () => {
  it("appends the fresh segment starting at currentSize", () => {
    expect(nextAction(0, [{ startOffset: 0, length: 50 }])).toEqual({
      type: "append",
      startOffset: 0,
      length: 50,
    });
  });
  it("prefers the covering segment reaching furthest (re-flush overlap)", () => {
    // 100_50 and 100_200 both start at 100; at size 150 only 100_200 still covers.
    expect(
      nextAction(150, [
        { startOffset: 100, length: 50 },
        { startOffset: 100, length: 200 },
      ]),
    ).toEqual({ type: "append", startOffset: 100, length: 200 });
  });
  it("treats wholly-applied segments as duplicates (done)", () => {
    expect(nextAction(150, [{ startOffset: 100, length: 50 }])).toEqual({
      type: "done",
    });
  });
  it("reports a gap when the next segment starts beyond currentSize", () => {
    expect(nextAction(150, [{ startOffset: 300, length: 20 }])).toEqual({
      type: "gap",
      expected: 150,
      nextAvailable: 300,
    });
  });
});
