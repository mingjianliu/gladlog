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
  isHpTroughWorthPrinting,
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

function friend(points: Record<number, number>, deaths: number[] = []) {
  return {
    id: "F1",
    name: "Victim-Realm",
    reaction: CombatUnitReaction.Friendly,
    class: CombatUnitClass.Druid,
    spec: CombatUnitSpec.Druid_Restoration,
    info: { teamId: "0", specId: "105" },
    advancedActions: walk(points),
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
    // shared-predicate pin: the printed low IS the [STATE] sampler's reading
    const low = gridHpMinInWindow(u as never, T0, 10, 20)!;
    expect(low).toEqual({ pct: 37, atSec: 14 });
    expect(gridHpPct(u as never, T0 + 14_000)).toBe(37);
    expect(isHpTroughWorthPrinting(81, 87, 37)).toBe(true);
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
