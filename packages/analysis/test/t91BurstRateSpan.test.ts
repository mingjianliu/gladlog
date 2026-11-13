/**
 * T91: a burst window's damage is a rate over the seconds the log shows.
 * A window whose last effect's official end runs past the analysed slice's
 * end was divided by its whole span — seconds with no row — and its
 * `damageRatio` read low. The window's own end is not cut.
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  BURST_HEALER_CC_WEIGHT,
  burstWindowRateSpanSeconds,
  reconstructEnemyCDTimeline,
} from "../src/utils/enemyCDs";
import {
  makeAuraEvent,
  makeDamageEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_700_000_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);
const END_S = 100;

beforeAll(async () => {
  await ensureAnalysisData();
});

// a Fury Warrior presses Recklessness (12 s) and Avatar (20 s) `pressS`
// into a 100 s slice; the friendly takes 1,000 a second throughout and
// 4,000 a second from the press on
const round = (
  pressS: number,
  opts: {
    /** damage rows the unit arrays keep after the slice's end */
    afterEnd?: number[];
    /** the friendly is a healer stunned from here to past the slice's end */
    stunnedFromS?: number;
    /** …and the stun is refreshed here */
    refreshedAtS?: number;
  } = {},
) => {
  const enemy = makeUnit("enemy-1", {
    name: "Warrior",
    class: CombatUnitClass.Warrior,
    spec: CombatUnitSpec.Warrior_Fury,
    reaction: CombatUnitReaction.Hostile,
    spellCastEvents: [
      makeSpellCastEvent("1719", at(pressS), "enemy-1", "x", "enemy-1"),
      makeSpellCastEvent("107574", at(pressS), "enemy-1", "x", "enemy-1"),
    ],
  });
  const friend = makeUnit("player-1", {
    name: "Friend",
    ...(opts.stunnedFromS === undefined
      ? {}
      : {
          class: CombatUnitClass.Priest,
          spec: CombatUnitSpec.Priest_Holy,
          auraEvents: [
            makeAuraEvent(
              LogEvent.SPELL_AURA_APPLIED,
              "408",
              at(opts.stunnedFromS),
              "enemy-1",
              "player-1",
            ),
            ...(opts.refreshedAtS === undefined
              ? []
              : [
                  makeAuraEvent(
                    LogEvent.SPELL_AURA_REFRESH,
                    "408",
                    at(opts.refreshedAtS),
                    "enemy-1",
                    "player-1",
                  ),
                ]),
            makeAuraEvent(
              LogEvent.SPELL_AURA_REMOVED,
              "408",
              at(END_S + 3),
              "enemy-1",
              "player-1",
            ),
          ],
        }),
    damageIn: [
      ...Array.from({ length: END_S }, (_, s) =>
        makeDamageEvent(at(s + 0.5), s >= pressS ? 4000 : 1000, "player-1"),
      ),
      ...(opts.afterEnd ?? []).map((s) =>
        makeDamageEvent(at(s), 50_000, "player-1"),
      ),
    ],
  });
  const combat = {
    startTime: T0,
    endTime: at(END_S),
    units: { [enemy.id]: enemy, [friend.id]: friend },
  } as never;
  const windows = reconstructEnemyCDTimeline(
    [enemy as ICombatUnit],
    combat,
    friend,
    [friend],
  ).alignedBurstWindows;
  expect(windows).toHaveLength(1);
  return windows[0]!;
};

describe("T91 — a burst window's rate is over the seconds the log shows", () => {
  it("the span stops at the slice's end and is never under a second", () => {
    expect(burstWindowRateSpanSeconds(10, 30, 100)).toBe(20);
    expect(burstWindowRateSpanSeconds(90, 110, 100)).toBe(10);
    expect(burstWindowRateSpanSeconds(99.8, 110, 100)).toBe(1);
  });

  it("a window inside the slice and one that runs past its end read the same rate", () => {
    const inside = round(40);
    const past = round(90);
    expect(inside.toSeconds).toBeLessThan(END_S);
    // the window itself is not cut
    expect(past.toSeconds).toBeGreaterThan(END_S);
    // 4,000 a second against each slice's own average
    const avg = (pressS: number) =>
      (pressS * 1000 + (END_S - pressS) * 4000) / END_S;
    expect(past.damageRatio).toBeCloseTo(4000 / avg(90), 1);
    // …where the whole 20 s span gave half of it
    expect(past.damageRatio).toBeGreaterThan((4000 * 10) / 20 / avg(90) + 0.5);
    expect(inside.damageRatio).toBeGreaterThan(1.3);
  });

  it("rows the unit arrays keep after the slice's end are in neither rate (codex 85-tk-G-T91-1 #1)", () => {
    // a Solo Shuffle round's endTime is cut at the deciding death; the
    // arrays keep what came after
    const plain = round(90);
    const withTail = round(90, { afterEnd: [100.4, 103, 108] });
    expect(withTail.damageRatio).toBeCloseTo(plain.damageRatio, 6);
    expect(withTail.damageInWindow).toBe(plain.damageInWindow);
  });

  it("a healer controlled for all the slice shows of the window is fully covered (codex 85-tk-G-T91-1 #2)", () => {
    // pressed at 98 s, the healer stunned from 98 s to past the 100 s end:
    // 2 s of 2 s, not 2 s of the window's 20
    const w = round(98, { stunnedFromS: 98 });
    expect(w.healerCCed).toBe(true);
    expect(w.dangerScore / (w.threatScore * w.damageRatio)).toBeCloseTo(
      1 + BURST_HEALER_CC_WEIGHT,
      6,
    );
    // half the shown seconds: half the weight
    const half = round(96, { stunnedFromS: 98 });
    expect(
      half.dangerScore / (half.threatScore * half.damageRatio),
    ).toBeCloseTo(1 + BURST_HEALER_CC_WEIGHT / 2, 6);
  });

  it("a control refreshed inside the window keeps the seconds before the refresh", () => {
    // stunned from 92 s, refreshed at 98 s: all 8 s the slice shows of the
    // window, not the 2 s after the refresh
    const w = round(92, { stunnedFromS: 92, refreshedAtS: 98 });
    expect(w.dangerScore / (w.threatScore * w.damageRatio)).toBeCloseTo(
      1 + BURST_HEALER_CC_WEIGHT,
      6,
    );
  });
});
