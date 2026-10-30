/**
 * F17 batch 6a — the cooldown model's readers on one reading.
 *  - codex 59-POSTHOC-11d #1 / 60-POSTHOC-10a #1: a press's "back in hand"
 *    instant counts every rate window, the later ones too — the transitions
 *    helper agrees with `cdAvailableAt` at every instant;
 *  - codex 59-POSTHOC-11e #5: a per-press reset happens at its real instant
 *    on the warped clock, not early;
 *  - codex 20-F17-04 #2 / 60-POSTHOC-04b #2 / 07c #2: a charge entry's own
 *    per-press effects reach the readers that filter presses themselves.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { selfAuraUpAt } from "../src/data/talentScriptedCooldowns";
import {
  applyEventReductions,
  cdAvailableAt,
  cdChargesAvailableAt,
  cdRealisedSecondsUntilReady,
  entryAvailabilityTransitions,
  type ICooldownCast,
  type IMajorCooldownInfo,
  warpClock,
} from "../src/utils/cooldowns";

beforeAll(async () => {
  await ensureAnalysisData();
});

const entry = (over: Partial<IMajorCooldownInfo>): IMajorCooldownInfo =>
  ({
    spellId: "357170",
    spellName: "Time Dilation",
    tag: "External",
    cooldownSeconds: 60,
    charges: 1,
    casts: [{ timeSeconds: 0 }],
    neverUsed: false,
    isProcOnly: false,
    availableWindows: [],
    ...over,
  }) as IMajorCooldownInfo;

describe("rate windows: the realised return counts the later windows", () => {
  // a ×3 recovery 20–23 s: 6 s of extra recovery → back at 54 s, not 60
  const cd = entry({
    rateWindows: [{ fromSeconds: 20, toSeconds: 23, mult: 3 }],
  });
  it("cdRealisedSecondsUntilReady at the press: 54 s", () => {
    expect(cdRealisedSecondsUntilReady(cd, 0)).toBeCloseTo(54, 3);
  });
  it("entryAvailabilityTransitions agrees with cdAvailableAt", () => {
    const flips = entryAvailabilityTransitions(cd, 100);
    const back = flips.find((f) => f.available)!;
    expect(back.atSeconds).toBeCloseTo(54, 3);
    expect(cdAvailableAt(cd, 53)).toBe(false);
    expect(cdAvailableAt(cd, 55)).toBe(true);
  });
});

describe("a per-press reset on the warped clock", () => {
  // pressed at 0 (cd 180), ×2 recovery 10–25 s, Preparation at 40 s
  const windows = [{ fromSeconds: 10, toSeconds: 25, mult: 2 }];
  const casts: ICooldownCast[] = [{ timeSeconds: 0 }];
  applyEventReductions(
    casts,
    180,
    [{ atSeconds: 40, seconds: Number.POSITIVE_INFINITY }],
    0,
    warpClock(windows),
  );
  const cd = entry({
    spellId: "13750",
    spellName: "Adrenaline Rush",
    cooldownSeconds: 180,
    rateWindows: windows,
    casts,
  });
  it("is not in hand before the reset, and is from it on", () => {
    expect(cdAvailableAt(cd, 31)).toBe(false);
    expect(cdAvailableAt(cd, 41)).toBe(true);
    const back = entryAvailabilityTransitions(cd, 100).find((f) => f.available);
    expect(back?.atSeconds).toBeCloseTo(40, 3);
  });
});

describe("a charge entry's own effects", () => {
  it("cdChargesAvailableAt applies the entry's reductions", () => {
    const cd = entry({
      cooldownSeconds: 180,
      charges: 2,
      chargeEffects: {
        reductions: Array.from({ length: 10 }, (_, i) => ({
          atSeconds: 20 + i * 5,
          seconds: 3,
        })),
      },
    });
    // two presses at 10 / 12: without the reductions the first charge is
    // back at 190 s; with 30 s off it is back by 160 s
    expect(cdChargesAvailableAt(cd, [10, 12], 165)).toBe(1);
    expect(
      cdChargesAvailableAt({ ...cd, chargeEffects: undefined }, [10, 12], 165),
    ).toBe(0);
  });
});

describe("selfAuraUpAt — a lost REMOVED is capped, a logged one is the end", () => {
  const row = (event: string, t: number) => ({
    spellId: "194249",
    srcUnitId: "P",
    destUnitId: "P",
    timestamp: t,
    logLine: { event, timestamp: t },
  });
  it("Voidform extended 0:21–0:57 is up at 0:50 (its REMOVED, past the official 20 s)", () => {
    const unit = {
      id: "P",
      auraEvents: [
        row("SPELL_AURA_APPLIED", 21_000),
        row("SPELL_AURA_REMOVED", 57_000),
      ],
    };
    expect(selfAuraUpAt(unit as never, "194249", 50_000)).toBe(true);
    expect(selfAuraUpAt(unit as never, "194249", 58_000)).toBe(false);
  });
  it("with no REMOVED it ends at its official length", () => {
    const unit = { id: "P", auraEvents: [row("SPELL_AURA_APPLIED", 21_000)] };
    expect(selfAuraUpAt(unit as never, "194249", 30_000)).toBe(true);
    expect(selfAuraUpAt(unit as never, "194249", 120_000)).toBe(false);
  });
});
