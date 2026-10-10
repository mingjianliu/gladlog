/**
 * `[DMG SPIKE]` trough annotation (2026-09-15, first Opus 5 baseline).
 *
 * The line used to summarise a window by its two endpoints only: `81% -> 87%
 * HP — healed through` while the target's own `[STATE]` tick inside the
 * window read 37% (73/309 prompts). The minimum now comes from the `[STATE]`
 * tick's sampler (`gridHpMinInWindow` = `gridHpPct` at every whole second)
 * and "worth printing" from `isHpTroughWorthPrinting` — the eval gate
 * `checkHealedThroughConsistency` re-asks both of the rendered ticks, so the
 * two sides are pinned here through the SAME exported sampler.
 *
 * 2026-10-01 (user ruling A′14, triage hp-state F-N5): "worth printing" is a
 * low at least `HP_TROUGH_MIN_DROP_PTS` (10) under BOTH endpoints — the
 * 09-15 crisis-line rule (≤ 40 %) hid 19 of 32 "healed through" dips of the
 * 60 triage rounds and printed 1-point dips under a falling window.
 *
 * 2026-10-10 (user ruling D7, FT-T03): the low is a TROUGH — the true minimum
 * of every sample inside the displayed seconds (`hpTroughInWindow`), printed
 * at the second it occurred. The `[STATE]` readings (`gridHpPct`, the two
 * endpoints) do not move; the invariant the gate keeps is "no tick of the
 * window reads below the low" (`isTickBelowTrough`).
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { CRISIS_HP_PCT_RENDERED } from "../analysis/crisisDecisionPoints";
import {
  gridHpMinInWindow,
  gridHpPct,
  HP_TROUGH_MIN_DROP_PTS,
  hpTroughInWindow,
  isHpTroughWorthPrinting,
  isTickBelowTrough,
} from "../utils/cooldowns";
import { emitDmgSpikeEntries } from "./matchTimelineSections";

const T0 = 1_000_000;
const hp = (tSec: number, cur: number, actorId = "F1") => ({
  timestamp: T0 + tSec * 1000,
  logLine: { timestamp: T0 + tSec * 1000 },
  advancedActorId: actorId,
  advancedActorCurrentHp: cur,
  advancedActorMaxHp: 100,
  advancedActorPositionX: 0,
  advancedActorPositionY: 0,
});

/** HP at each whole second 0..30 from a sparse `{sec: hp}` walk (held). */
function walk(points: Record<number, number>) {
  const out = [];
  let cur = points[0] ?? 100;
  for (let s = 0; s <= 30; s++) {
    if (points[s] !== undefined) cur = points[s]!;
    out.push(hp(s, cur));
  }
  return out;
}

function friend(
  points: Record<number, number>,
  deaths: number[] = [],
  /** extra samples between the whole seconds: `[second, hp]` */
  between: Array<[number, number]> = [],
) {
  const actions = [...walk(points), ...between.map(([t, v]) => hp(t, v))].sort(
    (a, b) => a.timestamp - b.timestamp,
  );
  return {
    id: "F1",
    name: "Victim-Realm",
    reaction: CombatUnitReaction.Friendly,
    class: CombatUnitClass.Druid,
    spec: CombatUnitSpec.Druid_Restoration,
    info: { teamId: "0", specId: "105" },
    advancedActions: actions,
    damageIn: [],
    healIn: [],
    healOut: [],
    absorbsIn: [],
    spellCastEvents: [],
    auraEvents: [],
    actionIn: [],
    deathRecords: deaths.map((s) => ({ timestamp: T0 + s * 1000 })),
  };
}

/** The unit without its sample on whole second `sec` — that second's tick
 * then reads the nearest sample either side. */
function without(u: ReturnType<typeof friend>, sec: number) {
  return {
    ...u,
    advancedActions: u.advancedActions.filter(
      (a) => a.timestamp !== T0 + sec * 1000,
    ),
  };
}

const PW = {
  fromSeconds: 10,
  toSeconds: 20,
  totalDamage: 500_000,
  targetName: "Victim-Realm",
  targetSpec: "Restoration Druid",
};

function render(unit: ReturnType<typeof friend>) {
  const out: string[] = [];
  emitDmgSpikeEntries({
    pressureWindows: [PW] as never,
    friends: [unit] as never,
    matchStartMs: T0,
    pid: (n) => n.split("-")[0]!,
    addEntry: (_t, ...ls) => out.push(...ls),
  });
  return out.join("\n");
}

describe("[DMG SPIKE] trough — endpoints must not hide a dip of 10 points or more", () => {
  it("a deep dip inside the window prints `low N% @m:ss` and drops the word", () => {
    const u = friend({ 0: 81, 14: 37, 18: 87 });
    const line = render(u as never);
    expect(line).toContain("(81% -> 87% HP");
    expect(line).toContain(", low 37% @0:14)");
    expect(line).not.toContain("healed through");
    // a low that sits ON a whole second is the [STATE] sampler's reading,
    // as before the trough ruling
    const low = hpTroughInWindow(u as never, T0, 10, 20)!;
    expect(low).toEqual({ pct: 37, atSec: 14, atMs: T0 + 14_000 });
    expect(gridHpMinInWindow(u as never, T0, 10, 20)).toEqual({
      pct: 37,
      atSec: 14,
    });
    expect(gridHpPct(u as never, T0 + 14_000)).toBe(37);
    expect(isHpTroughWorthPrinting(81, 87, 37)).toBe(true);
  });

  // FT-T03 (D7) — 141470d0's shape: 33 % on the 4:15 tick, 6 % 0.4 s later,
  // 48 % on the next tick. The grid never sees the 6.
  it("a dip BETWEEN two ticks is the low, at the second it occurred; the ticks keep their own readings", () => {
    const u = friend({ 0: 80, 15: 33, 16: 48, 18: 57 }, [], [[15.4, 6]]);
    const line = render(u as never);
    expect(line).toContain("(80% -> 57% HP");
    expect(line).toContain(", low 6% @0:15)");
    // the [STATE] sampler is untouched: the tick of that second still reads 33
    expect(gridHpPct(u as never, T0 + 15_000)).toBe(33);
    expect(gridHpMinInWindow(u as never, T0, 10, 20)).toEqual({
      pct: 33,
      atSec: 15,
    });
    expect(hpTroughInWindow(u as never, T0, 10, 20)).toEqual({
      pct: 6,
      atSec: 15,
      atMs: T0 + 15_400,
    });
  });

  // 0e0663e6's shape: `82% -> 98% HP — healed through` over 65 % at 0:25.5
  it("a dip the grid cannot see at all takes the word away", () => {
    const u = friend({ 0: 82, 18: 98 }, [], [[15.5, 65]]);
    // every whole second has its own sample, so no tick reads the 15.5 s one
    expect(gridHpMinInWindow(u as never, T0, 10, 20)!.pct).toBe(82);
    const line = render(u as never);
    expect(line).toContain("(82% -> 98% HP, +2%/s, low 65% @0:15)");
    expect(line).not.toContain("healed through");
  });

  it("the gate's invariant holds by construction: no tick of the window reads below the trough", () => {
    for (const u of [
      friend({ 0: 80, 15: 33, 16: 48, 18: 57 }, [], [[15.4, 6]]),
      friend({ 0: 82, 18: 98 }, [], [[15.5, 65]]),
      // rising through the window: the lowest reading is the first tick's,
      // read from a sample BEFORE the window opened (9.8 s)
      without(friend({ 0: 90, 11: 60, 12: 70, 14: 90 }, [], [[9.8, 40]]), 10),
    ]) {
      const low = hpTroughInWindow(u as never, T0, 10, 20)!;
      for (let s = 10; s <= 20; s++) {
        const tick = gridHpPct(u as never, T0 + s * 1000)!;
        expect(isTickBelowTrough(tick, low.pct)).toBe(false);
      }
    }
  });

  it("no dip → the labelBias outcome word stays", () => {
    const line = render(friend({ 0: 81, 18: 87 }) as never);
    expect(line).toContain("(81% -> 87% HP, +1%/s — healed through)");
    expect(line).not.toContain("low ");
  });

  it("a dip above the crisis line is a trough too (A′14: no ≤ 40 % condition) — 0777a8e0's 82 → 82 over 43", () => {
    const dip = CRISIS_HP_PCT_RENDERED + 3;
    const line = render(friend({ 0: 82, 14: dip, 18: 82 }) as never);
    expect(line).toContain(`(82% -> 82% HP, 0%/s, low ${dip}% @0:14)`);
    expect(line).not.toContain("healed through");
    expect(isHpTroughWorthPrinting(82, 82, dip)).toBe(true);
  });

  it("the cut is 10 points under BOTH endpoints: 9 under the lower one is not a trough", () => {
    expect(HP_TROUGH_MIN_DROP_PTS).toBe(10);
    expect(isHpTroughWorthPrinting(81, 87, 71)).toBe(true);
    expect(isHpTroughWorthPrinting(81, 87, 72)).toBe(false);
    expect(isHpTroughWorthPrinting(87, 81, 72)).toBe(false);
    const line = render(friend({ 0: 81, 14: 72, 18: 87 }) as never);
    expect(line).toContain("— healed through");
    expect(line).not.toContain("low ");
  });

  it("a small dip under a falling window is no longer printed, even below the crisis line (121c7e15: 99 → 24, low 22)", () => {
    const line = render(friend({ 0: 99, 15: 22, 18: 24 }) as never);
    expect(line).toContain("(99% -> 24% HP");
    expect(line).not.toContain("low ");
    expect(line).not.toContain("healed through");
  });

  it("a window that ends at its own minimum has nothing hidden — no `low`, no word", () => {
    const line = render(friend({ 0: 81, 15: 60, 18: 30 }) as never);
    expect(line).toContain("(81% -> 30% HP");
    expect(line).not.toContain("low ");
    expect(line).not.toContain("healed through");
  });

  it("the trough scan stops at death — a `dead` tick is not a number", () => {
    // dies at 0:16; the window's HP pair itself is unavailable after death,
    // so only the sampler's contract is pinned here
    const u = friend({ 0: 81, 14: 40, 15: 5 }, [16]);
    expect(gridHpMinInWindow(u as never, T0, 10, 20)).toEqual({
      pct: 5,
      atSec: 15,
    });
  });
});

describe("hpTroughInWindow — the true minimum, on the grid sampler's own validity rules (FT-T03, D7)", () => {
  it("reads the displayed seconds [from.000, (to+1).000): a sample in the last second counts, one after it does not", () => {
    const u = friend(
      { 0: 90 },
      [],
      [
        [20.9, 30],
        [21.2, 5],
      ],
    );
    expect(hpTroughInWindow(u as never, T0, 10, 20)).toEqual({
      pct: 30,
      atSec: 20,
      atMs: T0 + 20_900,
    });
  });

  it("a window's own tick is part of the minimum even when its sample lies outside the window", () => {
    // the 0:10 tick reads the 9.8 s sample (40 %); every sample inside the
    // window is higher. The trough is that tick — never above a [STATE] number.
    const u = without(
      friend({ 0: 90, 11: 60, 12: 70, 14: 90 }, [], [[9.8, 40]]),
      10,
    );
    expect(gridHpPct(u as never, T0 + 10_000)).toBe(40);
    expect(hpTroughInWindow(u as never, T0, 10, 20)).toEqual({
      pct: 40,
      atSec: 10,
      atMs: T0 + 9_800,
    });
  });

  it("several lines on one timestamp: the LAST is the state at that instant (GH #100) — a same-ms transient is not a low", () => {
    // 121c7e15's shape: a hit to 22 % and a heal back to 37 % on one stamp
    const u = friend({ 0: 66 });
    u.advancedActions.push(hp(15.573, 22), hp(15.573, 37));
    u.advancedActions.sort((a, b) => a.timestamp - b.timestamp);
    expect(hpTroughInWindow(u as never, T0, 10, 20)).toEqual({
      pct: 37,
      atSec: 15,
      atMs: T0 + 15_573,
    });
  });

  it("an instant whose last line is not the unit's own reading, or has no max HP, gives no reading", () => {
    const u = friend({ 0: 66 });
    u.advancedActions.push(hp(15.2, 5, "PET"), {
      ...hp(15.6, 0),
      advancedActorMaxHp: 0,
    });
    u.advancedActions.sort((a, b) => a.timestamp - b.timestamp);
    expect(hpTroughInWindow(u as never, T0, 10, 20)!.pct).toBe(66);
  });

  it("nothing is read from the death second on — the killing blow is a death, not a low", () => {
    // dies at 16.5: the 0:16 tick reads `dead`, so 16.2 s (3 %) is not a low
    const u = friend(
      { 0: 81, 14: 40 },
      [16.5],
      [
        [15.7, 12],
        [16.2, 3],
      ],
    );
    expect(hpTroughInWindow(u as never, T0, 10, 20)).toEqual({
      pct: 12,
      atSec: 15,
      atMs: T0 + 15_700,
    });
  });

  it("`skipSec` leaves out a second's samples exactly as it leaves out its tick", () => {
    const u = friend({ 0: 90, 13: 50 }, [], [[12.5, 20]]);
    // second 12 skipped: neither its tick nor the 12.5 s sample is read
    expect(
      hpTroughInWindow(u as never, T0, 10, 20, (s) => s === 12),
    ).toMatchObject({ pct: 50, atSec: 13 });
    expect(hpTroughInWindow(u as never, T0, 10, 20)).toMatchObject({
      pct: 20,
      atSec: 12,
    });
  });

  it("equal values resolve to the earliest second; clamped at 100 like the tick", () => {
    const u = friend(
      { 0: 100 },
      [],
      [
        [12.3, 55],
        [17.3, 55],
      ],
    );
    expect(hpTroughInWindow(u as never, T0, 10, 20)).toMatchObject({
      pct: 55,
      atSec: 12,
    });
    const over = friend({ 0: 130 });
    expect(hpTroughInWindow(over as never, T0, 10, 20)!.pct).toBe(100);
  });

  it("`span`: only the samples of the event's own span are read; the window's ticks are read regardless", () => {
    const u = friend(
      { 0: 90, 13: 50 },
      [],
      [
        [10.2, 5], // before the span opens (10.4)
        [12.5, 30],
        [20.7, 4], // after it closed (20.4)
      ],
    );
    const span = { fromMs: T0 + 10_400, toMs: T0 + 20_400 };
    expect(
      hpTroughInWindow(u as never, T0, 10, 20, undefined, span),
    ).toMatchObject({ pct: 30, atSec: 12 });
    // without it, the displayed seconds: both edge dips are inside
    expect(hpTroughInWindow(u as never, T0, 10, 20)!.pct).toBe(4);
    // a span with nothing lower than the ticks → the lowest tick
    expect(
      hpTroughInWindow(u as never, T0, 10, 20, undefined, {
        fromMs: T0 + 14_100,
        toMs: T0 + 20_400,
      }),
    ).toMatchObject({ pct: 50, atSec: 13 });
  });

  it("`span` may open before the first tick: the fraction of a second before `fromSec` is read, its tick is not", () => {
    // STAYED IN's shape: window 10.4 → 20.4, first tick inside it is 0:11.
    // 10.0 s (5 %) is the 0:10 tick's sample and before the window; 10.6 s
    // (25 %) is inside the window, before the first tick.
    const u = friend({ 0: 90, 10: 5, 11: 90 }, [], [[10.6, 25]]);
    expect(
      hpTroughInWindow(u as never, T0, 11, 20, undefined, {
        fromMs: T0 + 10_400,
        toMs: T0 + 20_400,
      }),
    ).toEqual({ pct: 25, atSec: 10, atMs: T0 + 10_600 });
  });

  it("no sample in reach → null", () => {
    const u = { ...friend({ 0: 90 }), advancedActions: [] };
    expect(hpTroughInWindow(u as never, T0, 10, 20)).toBeNull();
  });
});
