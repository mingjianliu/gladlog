import { describe, expect, it } from "vitest";

import { TAU, wrap } from "../scripts/facingCalibrationScan";

describe("facingCalibrationScan — wrap and angle normalization (N10)", () => {
  it("normalizes cardinal directions to (-pi, pi]", () => {
    expect(wrap(0)).toBe(0);
    expect(wrap(Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(wrap(Math.PI)).toBeCloseTo(Math.PI);
    expect(wrap((3 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2);
  });

  it("handles 0 and 2pi crossings cleanly", () => {
    expect(wrap(TAU)).toBeCloseTo(0);
    expect(wrap(TAU + 0.25)).toBeCloseTo(0.25);
    expect(wrap(TAU - 0.25)).toBeCloseTo(-0.25);
    expect(wrap(-0.25)).toBeCloseTo(-0.25);
  });

  it("maps -pi to +pi consistently", () => {
    expect(wrap(-Math.PI)).toBeCloseTo(Math.PI);
    expect(wrap(Math.PI)).toBeCloseTo(Math.PI);
  });

  it("is invariant under adding whole turns (+/- k * TAU)", () => {
    const angle = 1.234;
    for (const k of [-3, -2, -1, 1, 2, 3]) {
      expect(wrap(angle + k * TAU)).toBeCloseTo(wrap(angle));
    }
  });

  it("measures angular difference correctly between [0, 2pi) and [-pi, pi)", () => {
    // A WoW facing of 1.75 * TAU (around 5.5 rad, in quadrant 4)
    // and an atan2 result of -0.25 * TAU (around -1.57 rad, quadrant 4)
    const wowFacing = (7 * Math.PI) / 4; // 315 deg
    const atanAngle = -Math.PI / 4; // -45 deg (same direction)
    const diff = Math.abs(wrap(wowFacing - atanAngle));
    expect(diff).toBeCloseTo(0);
  });
});
