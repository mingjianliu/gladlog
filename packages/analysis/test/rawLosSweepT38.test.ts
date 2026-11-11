/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Pipeline T38 (GH #206, #141 item 4, #148 item 6b): the whole-second reach
 * and exposure readings test line of sight on the two units' nearest RAW
 * samples, never on a point interpolated between two samples. The fixture is
 * `dispelReachGrid.test`'s: zone 1505, a unit sampled 4 s apart on either
 * side of the north pillar, both samples in sight of a unit standing still.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  getUnitPositionAtTime,
  hasLineOfSight,
  rawLosSweepInSight,
} from "../src/utils/losAnalysis";
import { LOS_SWEEP_GAP_MS } from "../src/utils/positionSampling";
import { canReachTargetAt } from "../src/utils/rootReachability";
import { makeAdvancedAction, makeUnit } from "./ported/testHelpers";

const T0 = 1_700_000_000_000;
const ZONE = "1505";
const D = { x: -2054.5, y: 6623.5 };
const A = { x: -2044.5, y: 6615.5 };
const B = { x: -2044.5, y: 6631.5 };
const MID = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };

const still = (at: { x: number; y: number }, id = "d1") =>
  makeUnit(id, {
    advancedActions: [0, 1000, 2000, 3000, 4000].map((ms) =>
      makeAdvancedAction(T0 + ms, at.x, at.y),
    ),
  }) as any;
/** sampled only at 0 s and 4 s, on either side of the pillar */
const crossing = () =>
  makeUnit("t1", {
    advancedActions: [
      makeAdvancedAction(T0, A.x, A.y),
      makeAdvancedAction(T0 + 4000, B.x, B.y),
    ],
  }) as any;

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("the fixture", () => {
  it("both samples see the standing unit; the interpolated midpoint does not", () => {
    expect(hasLineOfSight(ZONE, D, A)).toBe(true);
    expect(hasLineOfSight(ZONE, D, B)).toBe(true);
    expect(hasLineOfSight(ZONE, D, MID)).toBe(false);
  });
});

describe("canReachTargetAt — LoS on raw samples for every caller", () => {
  it("a target whose interpolated point is inside the pillar is reachable: neither sample is behind it", () => {
    const from = still(D);
    const target = crossing();
    const t = T0 + 2000;
    const p = getUnitPositionAtTime(from, t, LOS_SWEEP_GAP_MS)!;
    expect(canReachTargetAt(p, target, t, ZONE, 40, true, from)).toBe(true);
  });
  it("a target standing behind the pillar on its raw samples is not", () => {
    const from = still(D);
    const target = still(MID, "t2");
    const t = T0 + 2000;
    const p = getUnitPositionAtTime(from, t, LOS_SWEEP_GAP_MS)!;
    expect(canReachTargetAt(p, target, t, ZONE, 40, true, from)).toBe(false);
  });
  it("range still reads the interpolated points, and melee reach has no LoS test", () => {
    const from = still(D);
    const target = still(MID, "t2");
    const t = T0 + 2000;
    const p = getUnitPositionAtTime(from, t, LOS_SWEEP_GAP_MS)!;
    expect(canReachTargetAt(p, target, t, ZONE, 5, true, from)).toBe(false);
    expect(canReachTargetAt(p, target, t, ZONE, 40, false, from)).toBe(true);
  });
});

describe("rawLosSweepInSight — the [HEALER EXPOSURE] sweep and its gate", () => {
  it("in sight when a raw pair of the sweep is, though every swept interpolated point is blocked", () => {
    // sweep of 2 s ± 2 s: the crossing unit's raw samples are A (0–2 s) and
    // B (2–4 s), both in sight
    expect(rawLosSweepInSight(ZONE, still(D), crossing(), T0 + 2000)).toBe(
      true,
    );
  });
  it("blocked when every raw pair is", () => {
    expect(
      rawLosSweepInSight(ZONE, still(D), still(MID, "t2"), T0 + 2000),
    ).toBe(false);
  });
  it("null with no raw pair inside the sweep; an unmapped arena counts as in sight", () => {
    expect(
      rawLosSweepInSight(ZONE, still(D), still(MID, "t2"), T0 + 60_000),
    ).toBeNull();
    expect(
      rawLosSweepInSight("no-such-zone", still(D), still(MID, "t2"), T0 + 2000),
    ).toBe(true);
  });
});
