/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * fact11 (F26) class 7 — a span reading that ran past the round, and a
 * trough's second. D1: the STAYED IN top damager stops at the round's end
 * (`topEnemyDamagerInSpan`, the trough's clamp). D13: two readings that print
 * the same whole percent are told apart by the unrounded one.
 */
import { describe, expect, it } from "vitest";

import { hpTroughInWindow } from "../src/utils/cooldowns";
import { topEnemyDamagerInSpan } from "../src/utils/positionAnalysis";
import { makeUnit } from "./ported/testHelpers";

const T0 = 1_000_000;

describe("fact11 D1 — the top damager stops at the round's end", () => {
  const hit = (s: number, amount: number): any => ({
    logLine: { timestamp: T0 + s * 1000 },
    srcUnitId: "e",
    effectiveAmount: -amount,
  });
  const enemies = [{ id: "e", name: "Sanyssa" }];
  // 0815382c r0: 1:02–1:12 printed, first death 1:09.366
  const owner = { damageIn: [hit(63, 326_000), hit(70, 102_000), hit(71.5, 19_000)] };
  it("hits after the first death are in no round", () => {
    expect(
      topEnemyDamagerInSpan(owner, enemies, [], T0, 62, 72, T0 + 69_366),
    ).toEqual({ name: "Sanyssa", damage: 326_000 });
  });
  it("no round end: the whole rendered span, as before", () => {
    expect(topEnemyDamagerInSpan(owner, enemies, [], T0, 62, 72)).toEqual({
      name: "Sanyssa",
      damage: 447_000,
    });
  });
});

describe("fact11 D13 — the trough's second is the true minimum's", () => {
  const row = (tSec: number, cur: number) => ({
    timestamp: T0 + Math.round(tSec * 1000),
    logLine: { timestamp: T0 + Math.round(tSec * 1000) },
    advancedActorId: "u",
    advancedActorCurrentHp: cur,
    advancedActorMaxHp: 1_108_080,
    advancedActorPositionX: 0,
    advancedActorPositionY: 0,
  });
  it("16bc5861 5:12–5:34: 70.30 % at 5:25.998 and 69.64 % at 5:28.568 both print 70 — the low is at 5:28", () => {
    const u = makeUnit("u", {
      advancedActions: [
        row(312, 1_000_000),
        row(325.998, 778_980), // 70.30 %
        row(327, 900_000),
        row(328.568, 771_629), // 69.64 %
        row(330, 950_000),
      ] as never,
    });
    const t = hpTroughInWindow(u as never, T0, 312, 334);
    expect(t?.pct).toBe(70);
    expect(t?.atSec).toBe(328);
  });
  it("an exact tie keeps the earlier second", () => {
    // a reading on every second, so each tick reads its own second
    const u = makeUnit("u", {
      advancedActions: Array.from({ length: 23 }, (_, i) =>
        row(312 + i, i === 8 || i === 16 ? 778_980 : 1_000_000),
      ) as never,
    });
    expect(hpTroughInWindow(u as never, T0, 312, 334)?.atSec).toBe(320);
  });
});
