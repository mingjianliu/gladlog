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

import { positionMistakeEvents } from "../src/analysis/candidateFindings";
import {
  CONSEQ_DROP_MIN_PCT,
  formatObservedConsequences,
  mateHitDuringCc,
  mateHpAcross,
} from "../src/context/observedConsequences";
import {
  gridHpPct,
  hpTroughInWindow,
  isTickBelowTrough,
} from "../src/utils/cooldowns";
import {
  computeOwnerPositionEvents,
  formatPositionEventsForContext,
  type IPositionEvent,
  STAYED_IN_NEAR_DEATH_PCT,
  stayedInHadRealCost,
} from "../src/utils/positionAnalysis";
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

describe("STAYED IN / position-mistake — the printed minimum is the trough; the cost gate keeps the whole-second minimum (FT-T03)", () => {
  // The owner stands 3 yd from an enemy through a burst window 10.4 → 20.4:
  // a sample every half second for the positions, HP from `hpAt`.
  const mk = (
    id: string,
    name: string,
    x: number,
    hpAt: (s: number) => number,
  ) => {
    const advancedActions = [];
    for (let ms = 0; ms <= 60_000; ms += 500)
      advancedActions.push({
        timestamp: T0 + ms,
        logLine: { timestamp: T0 + ms },
        advancedActorId: id,
        advancedActorCurrentHp: hpAt(ms / 1000),
        advancedActorMaxHp: 100,
        advancedActorPositionX: x,
        advancedActorPositionY: 0,
        advancedActorPowers: [],
      });
    return {
      id,
      name,
      spec: CombatUnitSpec.Paladin_Holy,
      advancedActions,
      deathRecords: [],
      damageOut: [],
      damageIn: [],
    };
  };
  const burst = {
    fromSeconds: 10.4,
    toSeconds: 20.4,
    activeCDs: [],
    threatScore: 1,
    threatLabel: "High",
    dangerScore: 1,
    dangerLabel: "High",
    dampeningPct: 0,
    damageInWindow: 0,
    damageRatio: 0,
    healerCCed: false,
  };
  const stay = (hpAt: (s: number) => number) => {
    const owner = mk("o", "Owner-R-US", 0, hpAt);
    const ev = computeOwnerPositionEvents({
      owner: owner as never,
      enemies: [mk("e1", "Dk-R-US", 3, () => 100)] as never,
      combat: { startTime: T0, endTime: T0 + 60_000 } as never,
      burstWindows: [burst] as never,
      ownerCooldowns: [],
      isHealer: true,
      ownerIsMelee: false,
    }).find((e) => e.type === "STAYED_IN")!;
    return { owner, ev };
  };
  const line = (e: IPositionEvent) =>
    formatPositionEventsForContext([e]).find((l) => l.includes(" burst] "))!;

  it("engine: a dip on a half second is the low; the whole-second minimum does not move", () => {
    // whole seconds read 90 → 60 from 0:15; 20 % at 15.5 only
    const hpAt = (s: number) => (s === 15.5 ? 20 : s >= 15 ? 60 : 90);
    const { owner, ev } = stay(hpAt);
    expect(ev.ownerHpStartPct).toBe(90);
    expect(ev.ownerHpMinPct).toBe(60);
    expect(ev.ownerHpLowPct).toBe(20);
    // the ticks inside the window keep their readings, none below the low
    for (let s = 11; s <= 20; s++)
      expect(
        isTickBelowTrough(gridHpPct(owner as never, T0 + s * 1000)!, 20),
      ).toBe(false);
    expect(gridHpPct(owner as never, T0 + 15_000)).toBe(60);
  });

  it("engine: the window bounds the samples — a dip in the start second BEFORE the window opened, or after it closed, is not its minimum", () => {
    // 10.0 s is before the window (10.4); 20.5 s is after it (20.4)
    const hpAt = (s: number) =>
      s === 10 || s === 20.5 ? 5 : s >= 15 ? 60 : 90;
    const { owner, ev } = stay(hpAt);
    expect(ev.ownerHpLowPct).toBe(60);
    expect(ev.ownerHpMinPct).toBe(60);
    // (the function alone, asked for those displayed seconds, would see both)
    expect(hpTroughInWindow(owner as never, T0, 10, 20)!.pct).toBe(5);
  });

  const ev = (over: Partial<IPositionEvent>): IPositionEvent => ({
    type: "STAYED_IN",
    atSeconds: 174,
    toSeconds: 184,
    startDistanceYards: 7.7,
    endDistanceYards: 2.9,
    nearestEnemyName: "Enemy-R-US",
    dangerLabel: "High",
    ownerHpStartPct: 90,
    ownerHpMinPct: 60,
    ...over,
  });

  it("line: prints the low; `stayed at or above` only when it is true of the printed number", () => {
    expect(STAYED_IN_NEAR_DEATH_PCT).toBe(35);
    // both above the line → the fact tag, about the low
    expect(line(ev({ ownerHpLowPct: 50 }))).toContain(
      "your HP 90%→50% (min over window) (HP stayed at or above 35%)",
    );
    // ticks stayed above the line, the trough went under it → neither tag:
    // "stayed at or above 35%" would be false, and "the stay was costly" is
    // the menu gate's verdict, which reads the whole-second minimum
    const mixed = line(ev({ ownerHpLowPct: 20 }));
    expect(mixed).toContain("your HP 90%→20% (min over window)");
    expect(mixed).not.toContain("stayed at or above");
    expect(mixed).not.toContain("near-death");
    // the whole-second minimum under the line → the verdict tag, as before
    expect(line(ev({ ownerHpMinPct: 30, ownerHpLowPct: 12 }))).toContain(
      "your HP 90%→12% (min over window) (near-death — the stay was costly)",
    );
    // no trough on the event (hand-built, older callers) → the old line
    expect(line(ev({}))).toContain(
      "your HP 90%→60% (min over window) (HP stayed at or above 35%)",
    );
  });

  it("menu: `hpMin` is the low, but WHICH stays are listed is still the whole-second minimum's call", () => {
    const owner = { id: "o", name: "Owner-R-US" };
    const listed = positionMistakeEvents(
      [ev({ ownerHpMinPct: 30, ownerHpLowPct: 12 })],
      owner,
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]!.facts.hpStart).toBe("90");
    expect(listed[0]!.facts.hpMin).toBe("12");
    // a trough under the cost line with a whole-second minimum above it is
    // NOT a candidate: the ruling adds no position-mistake
    expect(stayedInHadRealCost(20)).toBe(true);
    expect(
      positionMistakeEvents(
        [ev({ ownerHpMinPct: 60, ownerHpLowPct: 20 })],
        owner,
      ),
    ).toEqual([]);
    // …and the order under the cap is the decision's too
    const two = positionMistakeEvents(
      [
        ev({ atSeconds: 10, ownerHpMinPct: 30, ownerHpLowPct: 5 }),
        ev({ atSeconds: 50, ownerHpMinPct: 20, ownerHpLowPct: 18 }),
      ],
      owner,
    );
    expect(two.map((e) => e.facts.hpMin)).toEqual(["18", "5"]);
  });
});
