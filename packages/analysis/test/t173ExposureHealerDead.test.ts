/**
 * T173 (round 14 D18): no `[HEALER EXPOSURE]` window for a dead healer — the
 * `[STATE]` tick's reading, dead from the death's own second.
 */
import { describe, expect, it } from "vitest";

import { healerDeadAtExposureWindow } from "../src/utils/healerExposureAnalysis";
import { makeUnit } from "./ported/testHelpers";

const START = 1_700_000_000_000;
// 95d4affb: the healer dies at 6:41.890, the burst window opens at 6:43
const healer = () =>
  makeUnit("h", {
    deathRecords: [{ timestamp: START + 401_890 }] as any,
  });

describe("healerDeadAtExposureWindow (T173)", () => {
  it("a window after the death is the dead healer's", () => {
    expect(healerDeadAtExposureWindow(healer(), START, 403.2)).toBe(true);
  });
  it("the death's own second reads dead, as the [STATE] tick prints it", () => {
    expect(healerDeadAtExposureWindow(healer(), START, 401.1)).toBe(true);
  });
  it("control: the second before the death, and a healer who never died", () => {
    expect(healerDeadAtExposureWindow(healer(), START, 400.9)).toBe(false);
    expect(healerDeadAtExposureWindow(makeUnit("h"), START, 403.2)).toBe(false);
  });
});
