/**
 * Triage 2026-09-29 enemy-def F-E28 (user ruling A28, 2026-09-30): the
 * `[DEATH] … (PvP Trinket available)` tag says whether a CC worth breaking
 * was on the dying player in the last 10 s (rendered length ≥ 2 s).
 */
import { describe, expect, it } from "vitest";

import {
  breakableCcBeforeDeath,
  renderedCcSeconds,
} from "../src/utils/ccTrinketAnalysis";

const cc = (atSeconds: number, durationSeconds: number) =>
  ({ atSeconds, durationSeconds }) as never;

describe("breakableCcBeforeDeath (F-E28)", () => {
  it("82a2d681: a 1 s Lightning Lasso 5 s before the death is not breakable", () => {
    expect(breakableCcBeforeDeath({ ccInstances: [cc(168.4, 1.2)] }, 173.9)).toBe(false);
  });
  it("539b6ed0: a 5 s Kidney Shot at 1:00 before a 1:07 death is", () => {
    expect(breakableCcBeforeDeath({ ccInstances: [cc(60.3, 5)] }, 67.03)).toBe(true);
  });
  it("reads the render grid: 1.5 s prints as 2s, a span ending exactly 10 s before still counts", () => {
    expect(renderedCcSeconds({ durationSeconds: 1.5 } as never)).toBe(2);
    // prints 0:40 | 2s, death prints 0:52 → 40 + 2 = 42 ≥ 52 − 10
    expect(breakableCcBeforeDeath({ ccInstances: [cc(40.9, 1.5)] }, 52.99)).toBe(true);
    expect(breakableCcBeforeDeath({ ccInstances: [cc(39.9, 1.5)] }, 52.0)).toBe(false);
  });
  it("an unrendered zero-length instance never counts", () => {
    expect(breakableCcBeforeDeath({ ccInstances: [cc(50, 0)] }, 52)).toBe(false);
  });
});
