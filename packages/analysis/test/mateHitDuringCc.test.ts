/**
 * `mateHitDuringCc` — the `[CONSEQ]` line's "did the teammate pay for the
 * healer's CC" test, shared with death-setup `healer-locked` (reliability
 * round 2 W1c, be835950: Kidney Shot on the healer, the victim 84 % → 80 %
 * during it, the menu still said the healer was CC'd through the kill window).
 */
import type { ICombatUnit } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  CONSEQ_DROP_MIN_PCT,
  mateHitDuringCc,
} from "../src/context/observedConsequences";

const T0 = 1_000_000;
const hp = (tSec: number, cur: number) => ({
  timestamp: T0 + tSec * 1000,
  logLine: { timestamp: T0 + tSec * 1000 },
  advancedActorId: "V",
  advancedActorCurrentHp: cur,
  advancedActorMaxHp: 100,
  advancedActorPositionX: 0,
  advancedActorPositionY: 0,
});
const mate = (samples: Array<[number, number]>, deathSec?: number) =>
  ({
    id: "V",
    name: "Victim-R",
    advancedActions: samples.map(([s, v]) => hp(s, v)),
    deathRecords:
      deathSec === undefined ? [] : [{ timestamp: T0 + deathSec * 1000 }],
  }) as unknown as ICombatUnit;
const cc = { atSeconds: 137.6, durationSeconds: 5 };
const track = (from: number, to: number, f: (s: number) => number) => {
  const out: Array<[number, number]> = [];
  for (let s = from; s <= to; s++) out.push([s, f(s)]);
  return out;
};

describe("mateHitDuringCc", () => {
  it("a drop smaller than the [CONSEQ] line's floor is not a hit (be835950: 84 → 80)", () => {
    expect(CONSEQ_DROP_MIN_PCT).toBe(10);
    const v = mate(
      track(130, 150, (s) => (s <= 137 ? 84 : s <= 142 ? 80 : 20)),
    );
    expect(mateHitDuringCc(v, T0, cc)).toBe(false);
  });

  it("a drop of at least the floor inside the CC is a hit", () => {
    const v = mate(track(130, 150, (s) => (s <= 137 ? 84 : 60)));
    expect(mateHitDuringCc(v, T0, cc)).toBe(true);
  });

  it("dying inside the CC is a hit even with no HP sample", () => {
    expect(mateHitDuringCc(mate([], 140.2), T0, cc)).toBe(true);
  });

  it("no HP sample and no death → not a hit", () => {
    expect(mateHitDuringCc(mate([]), T0, cc)).toBe(false);
  });
});
