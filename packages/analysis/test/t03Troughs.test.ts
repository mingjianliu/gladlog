/**
 * FT-T03 (user ruling 2026-10-10, decision D7) — "the 'trough' numbers may
 * leave the whole-second grid and read the true minimum inside their window;
 * the [STATE] point readings, the crisis crossing instants and cd-hoarded's
 * `crisisHpPct` do NOT move".
 *
 * One block per producer family that prints a trough. Each pins three things:
 * the printed low is the true minimum (`hpTroughInWindow`) at the second it
 * happened; the point readings beside it are still `gridHpPct`; and whatever
 * DECIDES something (a candidate's existence, a kind) still reads the grid.
 * The function's own validity rules and the `[DMG SPIKE]` line are in
 * `src/context/matchTimelineSections.trough.test.ts`.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  type ICombatUnit,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  CONSEQ_DROP_MIN_PCT,
  formatObservedConsequences,
  mateHitDuringCc,
  mateHpAcross,
} from "../src/context/observedConsequences";
import { gridHpPct, isTickBelowTrough } from "../src/utils/cooldowns";
import { makeUnit } from "./ported/testHelpers";

const T0 = 1_000_000;
/** One advanced sample of `unitId` at `tSec` (fractional seconds allowed). */
const hp = (unitId: string, tSec: number, cur: number) => ({
  timestamp: T0 + Math.round(tSec * 1000),
  logLine: { timestamp: T0 + Math.round(tSec * 1000) },
  advancedActorId: unitId,
  advancedActorCurrentHp: cur,
  advancedActorMaxHp: 100,
  advancedActorPositionX: 0,
  advancedActorPositionY: 0,
});
/** A sample on every whole second of `[from, to]`, plus the ones in between. */
const track = (
  unitId: string,
  from: number,
  to: number,
  onSecond: (s: number) => number,
  between: Array<[number, number]> = [],
) => {
  const out = [];
  for (let s = from; s <= to; s++) out.push(hp(unitId, s, onSecond(s)));
  for (const [t, v] of between) out.push(hp(unitId, t, v));
  return out.sort((a, b) => a.timestamp - b.timestamp);
};

describe("[CONSEQ] — the low is the true minimum inside the lockout / CC (FT-T03)", () => {
  // 121c7e15's shape: the tick of the low's second reads 32, the unit is at
  // 22 half a second later and back to 37 on the next tick.
  const healer = makeUnit("h", {
    name: "Healer-R",
    spec: CombatUnitSpec.Priest_Holy,
  });
  const mate = (between: Array<[number, number]>) =>
    makeUnit("m", {
      name: "Mate-R",
      advancedActions: track(
        "m",
        55,
        70,
        (s) => (s <= 60 ? 66 : s === 61 ? 50 : s === 62 ? 32 : 37),
        between,
      ),
    });
  const enemy = makeUnit("e", {
    name: "Enemy-R",
    reaction: CombatUnitReaction.Hostile,
  });
  // Fear on the healer 60.3 → 63.5
  const cc = { atSeconds: 60.3, durationSeconds: 3.2, spellName: "Fear" };
  const render = (m: ICombatUnit) =>
    formatObservedConsequences({
      combat: {
        startTime: T0,
        endTime: T0 + 120_000,
        units: { h: healer, m, e: enemy },
      } as never,
      friends: [healer, m],
      enemies: [enemy],
      friendlyCC: [{ playerName: "Healer-R", ccInstances: [cc] }] as never,
      enemyCC: [],
      labels: { friendly: (n) => n, enemy: (n) => n },
    }).join("\n");

  it("a dip between two ticks is the printed low, at the second it happened; the start is still the [STATE] reading", () => {
    const m = mate([[62.5, 22]]);
    expect(render(m)).toContain(
      "in Fear for 3s → during it: Mate-R 66% → low 22% at 1:02",
    );
    // the tick of that second is untouched
    expect(gridHpPct(m, T0 + 62_000)).toBe(32);
    const hpAcross = mateHpAcross(m, T0, 60, 63)!;
    expect(hpAcross.h0).toBe(66);
    expect(hpAcross.lo).toEqual({ pct: 32, atSec: 62 });
    expect(hpAcross.trough).toMatchObject({ pct: 22, atSec: 62 });
  });

  it("without the dip the line is what it was: the low is the lowest tick", () => {
    expect(render(mate([]))).toContain("Mate-R 66% → low 32% at 1:02");
  });

  it("the event's own span bounds the samples: a dip in the same second BEFORE the CC landed, or after it ended, is not `during it`", () => {
    // 60.1 s is before the Fear (60.3); 63.8 s is after it ended (63.5) —
    // both inside the displayed seconds 1:00–1:03
    const m = mate([
      [60.1, 5],
      [63.8, 4],
    ]);
    expect(render(m)).toContain("Mate-R 66% → low 32% at 1:02");
  });

  it("a drop only the trough sees is named — and no tick of the span reads below it", () => {
    // every tick reads 66: on the grid nobody dropped
    const m = makeUnit("m", {
      name: "Mate-R",
      advancedActions: track("m", 55, 70, () => 66, [[61.5, 40]]),
    });
    const text = render(m);
    expect(text).toContain("Mate-R 66% → low 40% at 1:01");
    expect(text).not.toContain("no teammate dropped");
    for (let s = 60; s <= 63; s++)
      expect(isTickBelowTrough(gridHpPct(m, T0 + s * 1000)!, 40)).toBe(false);
  });

  it("the DECISION stays on the grid: `mateHitDuringCc` (death-setup healer-locked) does not see a drop only the trough shows", () => {
    expect(CONSEQ_DROP_MIN_PCT).toBe(10);
    const m = makeUnit("m", {
      name: "Mate-R",
      advancedActions: track("m", 55, 70, () => 66, [[61.5, 40]]),
    });
    expect(mateHitDuringCc(m, T0, cc)).toBe(false);
    // …and a drop the grid sees is one the line names too (trough ≤ grid low)
    const dropped = mate([]);
    expect(mateHitDuringCc(dropped, T0, cc)).toBe(true);
    expect(render(dropped)).not.toContain("no teammate dropped");
  });
});
