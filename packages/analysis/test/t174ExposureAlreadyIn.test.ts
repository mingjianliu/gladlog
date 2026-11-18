/**
 * T174 (round 13 P4): `[HEALER EXPOSURE] … healer already in X until m:ss`
 * names the control that ends last among those on at the window's start.
 */
import { describe, expect, it } from "vitest";

import { healerControlAtWindow } from "../src/utils/healerExposureAnalysis";

// Intimidation 0:04–0:09 under a Freezing Trap 0:05.9–0:13.9; window at 0:07
const intimidation = {
  atSeconds: 4,
  durationSeconds: 5,
  spellName: "Intimidation",
};
const trap = { atSeconds: 5.9, durationSeconds: 8, spellName: "Freezing Trap" };

describe("healerControlAtWindow (T174)", () => {
  it("two controls on at once: the one that ends last, whatever the order", () => {
    expect(healerControlAtWindow([intimidation, trap], 7)).toBe(trap);
    expect(healerControlAtWindow([trap, intimidation], 7)).toBe(trap);
  });
  it("a control that has not landed yet is not asked", () => {
    expect(healerControlAtWindow([intimidation, trap], 5)).toBe(intimidation);
  });
  it("a control landing on the window's own instant is on; one ending on it is not", () => {
    expect(healerControlAtWindow([trap], 5.9)).toBe(trap);
    expect(healerControlAtWindow([intimidation], 9)).toBe(undefined);
  });
  it("control: nothing on", () => {
    expect(healerControlAtWindow([intimidation, trap], 20)).toBe(undefined);
  });
});
