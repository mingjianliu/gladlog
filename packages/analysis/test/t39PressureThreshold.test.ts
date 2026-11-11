/**
 * T39: `getPressureThreshold` reads the largest logged max HP once per
 * advanced-action list — with `Math.max`'s own semantics (codex
 * 85-tk-H-T39-1: an unreadable max HP is NaN, and one NaN makes the whole
 * answer NaN, so the role's fallback threshold stands).
 */
import { describe, expect, it } from "vitest";

import { getPressureThreshold } from "../src/utils/cooldowns";

const unit = (maxHps: number[], spec = "71") =>
  ({
    spec,
    advancedActions: maxHps.map((advancedActorMaxHp) => ({
      advancedActorMaxHp,
    })),
  }) as never;
const old = (maxHps: number[]) => Math.max(...maxHps);

describe("T39 — the cached max HP reads as Math.max did", () => {
  it("finite readings: the largest one prices the threshold", () => {
    const hps = [900_000, 1_000_000, 950_000];
    const u = unit(hps);
    const first = getPressureThreshold(u);
    expect(first / old(hps)).toBeCloseTo(
      getPressureThreshold(unit([1_000_000])) / 1_000_000,
    );
    // the cached answer is the same answer
    expect(getPressureThreshold(u)).toBe(first);
  });

  it("one NaN reading: the role's fallback, as before", () => {
    const fallback = getPressureThreshold(unit([]));
    expect(Number.isNaN(old([1_000_000, NaN]))).toBe(true);
    expect(getPressureThreshold(unit([1_000_000, NaN]))).toBe(fallback);
    expect(getPressureThreshold(unit([NaN, 1_000_000]))).toBe(fallback);
  });

  it("all-zero readings: the role's fallback", () => {
    expect(getPressureThreshold(unit([0, 0]))).toBe(
      getPressureThreshold(unit([])),
    );
  });
});
