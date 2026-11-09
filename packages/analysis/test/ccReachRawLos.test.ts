/**
 * T31 (codex review of batch B5): `ccReachAt` reads line of sight on the two
 * units' nearest RAW samples (`rawLineOfSightAt`, the `losAnalysis`
 * contract), distance on the interpolated points. Zone 1505: the owner at
 * y 6623.5 at 69 s and 6643.5 at 71 s, the target at (-2034.5, 6623.5) — at
 * 70 s the raw pair is pillar-blocked, the interpolated point is not.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { ccReachAt } from "../src/utils/ccTargetState";
import { hasLineOfSight } from "../src/utils/losAnalysis";
import { makeAdvancedAction, makeUnit } from "./ported/testHelpers";

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;
const ZONE = "1505";

beforeAll(async () => {
  await ensureAnalysisData();
});

const owner = () =>
  makeUnit("o", {
    name: "Owner",
    advancedActions: [
      makeAdvancedAction(at(69), -2054.5, 6623.5),
      makeAdvancedAction(at(71), -2054.5, 6643.5),
    ],
  }) as unknown as Parameters<typeof ccReachAt>[0];
const target = () =>
  makeUnit("t", {
    name: "Target",
    advancedActions: [69, 70, 71].map((s) =>
      makeAdvancedAction(at(s), -2034.5, 6623.5),
    ),
  }) as unknown as Parameters<typeof ccReachAt>[1];

describe("ccReachAt line of sight (T31)", () => {
  it("the geometry the case stands on: raw pair blocked, interpolated point in sight", () => {
    const tPos = { x: -2034.5, y: 6623.5 };
    expect(hasLineOfSight(ZONE, { x: -2054.5, y: 6623.5 }, tPos)).toBe(false);
    expect(hasLineOfSight(ZONE, { x: -2054.5, y: 6633.5 }, tPos)).not.toBe(
      false,
    );
  });

  it("reads the raw samples for LoS and the interpolated point for distance", () => {
    expect(ccReachAt(owner(), target(), 30, ZONE, at(70))).toEqual({
      ok: false,
      reason: "los",
    });
    // out of reach is still decided on the interpolated distance (22.4 yd)
    expect(ccReachAt(owner(), target(), 20, ZONE, at(70))).toEqual({
      ok: false,
      reason: "out-of-range",
    });
    // an unmapped arena: LoS not disproven
    const free = ccReachAt(owner(), target(), 30, "0", at(70));
    expect(free.ok).toBe(true);
    if (free.ok) expect(free.distanceYards).toBeCloseTo(Math.hypot(20, 10), 5);
  });
});
