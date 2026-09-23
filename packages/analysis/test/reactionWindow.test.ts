/**
 * Reaction window for "X was ready and you did not press it" claims — user
 * ruling 2026-09-23 (GH #103 #216/#253): a cooldown that came back within 1 s
 * of the moment is not a real option. `cdAvailableAt` (the state) is
 * unchanged; `cdReadyInTimeAt` (the accusation gate) requires readiness at
 * t − REACTION_WINDOW_S and no press through t's rendered instant.
 */
import { describe, expect, it } from "vitest";

import {
  cdAvailableAt,
  cdReadyInTimeAt,
  REACTION_WINDOW_S,
} from "../src/utils/cooldowns";
import { toRenderSecond } from "../src/utils/renderGrid";

const cd = (casts: number[], cooldownSeconds = 90, charges?: number) => ({
  casts: casts.map((timeSeconds) => ({ timeSeconds })) as never,
  cooldownSeconds,
  neverUsed: casts.length === 0,
  charges,
});

describe("cdReadyInTimeAt (REACTION_WINDOW_S = 1, user ruling 2026-09-23)", () => {
  it("the #216 shape: back 0.03 s after the death is not an option", () => {
    // Ironbark cast at 90.881 (cd 90) → back at 180.881; death at 180.852
    const ironbark = cd([90.881]);
    expect(cdAvailableAt(ironbark, 180.852)).toBe(true); // the state (slack)
    expect(cdReadyInTimeAt(ironbark, 180.852)).toBe(false);
  });

  it("back 0.9 s before the moment is still not an option; 1.1 s is", () => {
    const x = cd([10]); // back at 100
    expect(cdReadyInTimeAt(x, 100.9)).toBe(false);
    expect(cdReadyInTimeAt(x, 101.1)).toBe(true);
  });

  it("pressed at the moment (within the rendered-second slack) is pressed", () => {
    const x = cd([10, 150.3]); // back at 100, pressed again at 150.3
    expect(cdReadyInTimeAt(x, 150)).toBe(false);
  });

  it("never used → ready", () => {
    expect(cdReadyInTimeAt(cd([]), 30)).toBe(true);
  });

  it("charges: one charge up at t − 1 and still one after the casts", () => {
    // 2 charges, 30 s recharge: casts at 0 and 1 → first back at 30
    const roll = cd([0, 1], 30, 2);
    expect(cdReadyInTimeAt(roll, 30.5)).toBe(false);
    expect(cdReadyInTimeAt(roll, 31.2)).toBe(true);
  });

  it("every claim it admits, the [RES] ledger instant also shows ready", () => {
    // ledger instant = toRenderSecond(t) + CD_INSTANT_SLACK_S; sweep t
    for (let back = 100; back <= 102; back += 0.037)
      for (let t = 99; t <= 104; t += 0.013) {
        const x = cd([back - 90]);
        if (cdReadyInTimeAt(x, t))
          expect(cdAvailableAt(x, toRenderSecond(t))).toBe(true);
      }
    expect(REACTION_WINDOW_S).toBe(1);
  });
});
