/**
 * Triage 2026-09-29 missed-cleanse F-C8 (ruling A42 = A): the dispel reach
 * sweep samples the round-relative whole seconds from ceil(applyRel) — never
 * before the CC landed. 95127ab4: fear at 45.793 → 46.000, 47.000, 48.000.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  anyDispellerReachable,
  dispelReachSweepStartMs,
} from "../src/utils/dispelAnalysis";
import { hasLineOfSight } from "../src/utils/losAnalysis";
import { makeAdvancedAction, makeUnit } from "./ported/testHelpers";

describe("dispelReachSweepStartMs (F-C8)", () => {
  it("round-relative, ceil of the apply second", () => {
    const start = 1_700_000_000_317; // the match's own ms remainder must not leak in
    expect(dispelReachSweepStartMs(start + 45_793, start) - start).toBe(46_000);
    expect(dispelReachSweepStartMs(start + 45_000, start) - start).toBe(45_000);
  });
});

describe("anyDispellerReachable — LoS reads raw samples (F-C9, codex review)", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });
  const T0 = 1_700_000_000_000;
  const ZONE = "1505";
  // the dispeller stands still; the target is sampled 4 s apart on either
  // side of the north pillar, both samples in line of sight
  const D = { x: -2054.5, y: 6623.5 };
  const A = { x: -2044.5, y: 6615.5 };
  const B = { x: -2044.5, y: 6631.5 };
  const dispeller = () =>
    makeUnit("d1", {
      advancedActions: [0, 1000, 2000, 3000, 4000].map((ms) =>
        makeAdvancedAction(T0 + ms, D.x, D.y),
      ),
    });
  const target = () =>
    makeUnit("t1", {
      advancedActions: [
        makeAdvancedAction(T0, A.x, A.y),
        makeAdvancedAction(T0 + 4000, B.x, B.y),
      ],
    });
  it("the fixture is what it claims: both samples see the dispeller, the 2 s interpolation does not", () => {
    expect(hasLineOfSight(ZONE, D, A)).toBe(true);
    expect(hasLineOfSight(ZONE, D, B)).toBe(true);
    expect(
      hasLineOfSight(ZONE, D, { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }),
    ).toBe(false);
  });
  it("an interpolated point inside the pillar does not make the window unreachable", () => {
    expect(
      anyDispellerReachable(
        [dispeller() as any],
        target() as any,
        T0 + 100,
        3000,
        ZONE,
        () => 40,
        T0,
      ),
    ).toBe(true);
  });
});
