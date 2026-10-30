import { describe, expect, it } from "vitest";

import {
  BRIGHT_PIXEL_LUMINANCE_THRESHOLD,
  BRIGHT_RATIO_THRESHOLD,
  judgeBlackFrame,
  MEAN_LUMINANCE_THRESHOLD,
} from "./blackFrame";

/** Builds a flat luminance array of `n` pixels, each at `value` (0-255),
 * with `brightCount` of them bumped to a fixed bright value — lets tests
 * hit an exact mean/ratio without hand-writing thousands of numbers. */
function makeFrame(
  n: number,
  darkValue: number,
  brightCount: number,
  brightValue: number,
): number[] {
  const px = new Array<number>(n).fill(darkValue);
  for (let i = 0; i < brightCount; i++) px[i] = brightValue;
  return px;
}

describe("judgeBlackFrame — 黑帧判定(design doc §7.1/task-4 brief 规则 8)", () => {
  it("all-black frame: mean well under 8/255, zero bright pixels → black", () => {
    const px = makeFrame(1000, 0, 0, 0);
    const r = judgeBlackFrame(px);
    expect(r.black).toBe(true);
    expect(r.meanLuminance).toBe(0);
    expect(r.brightRatio).toBe(0);
  });

  it("normal bright scene: mean far above threshold → not black", () => {
    const px = makeFrame(1000, 120, 0, 0);
    const r = judgeBlackFrame(px);
    expect(r.black).toBe(false);
    expect(r.meanLuminance).toBe(120);
  });

  it("dark-but-real scene: mean under 8 yet bright-pixel ratio >= 0.5% (e.g. a lit UI sliver in an otherwise-black frame) → not black", () => {
    // 10000 px, 60 of them bright (0.6% > 0.5% threshold), rest pure black.
    // Mean stays low (60*200/10000 = 1.2 << 8) so only the ratio condition
    // is what keeps this from being misjudged as black.
    const px = makeFrame(10_000, 0, 60, 200);
    const r = judgeBlackFrame(px);
    expect(r.meanLuminance).toBeLessThan(MEAN_LUMINANCE_THRESHOLD);
    expect(r.brightRatio).toBeGreaterThanOrEqual(BRIGHT_RATIO_THRESHOLD);
    expect(r.black).toBe(false);
  });

  it("boundary: mean exactly at threshold is NOT black (strict <)", () => {
    const px = makeFrame(1000, MEAN_LUMINANCE_THRESHOLD, 0, 0);
    const r = judgeBlackFrame(px);
    expect(r.black).toBe(false);
  });

  it("boundary: bright ratio exactly at threshold is NOT black (strict <)", () => {
    const n = 10_000;
    const brightCount = Math.round(n * BRIGHT_RATIO_THRESHOLD); // exactly at threshold
    const px = makeFrame(
      n,
      0,
      brightCount,
      BRIGHT_PIXEL_LUMINANCE_THRESHOLD + 1,
    );
    const r = judgeBlackFrame(px);
    expect(r.brightRatio).toBeCloseTo(BRIGHT_RATIO_THRESHOLD, 5);
    expect(r.black).toBe(false);
  });

  it("empty input is treated as black (no signal = worst case, not a false 'active')", () => {
    const r = judgeBlackFrame([]);
    expect(r.black).toBe(true);
  });
});
