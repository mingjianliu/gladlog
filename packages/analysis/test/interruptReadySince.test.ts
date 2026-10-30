import {
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  interruptCooldownRemainingMs,
  interruptCooldownSeconds,
  interruptReadySinceMs,
} from "../src/utils/enemyInterrupts";
import { makeUnit } from "./ported/testHelpers";

/**
 * Triage 2026-09-29, kick-priority F-P5 (ruling A′3): `kickReadyForS` reads
 * `interruptReadySinceMs`, which must be the same predicate as
 * `interruptCooldownRemainingMs` — at every instant, "ready since T" exactly
 * when the remaining cooldown is 0, and T is where it reached 0.
 */

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const cast = (spellId: string, s: number) => ({
  spellId,
  spellName: "x",
  timestamp: T0 + s * 1000,
  logLine: {
    event: LogEvent.SPELL_CAST_SUCCESS,
    timestamp: T0 + s * 1000,
    parameters: [],
  },
});

const COUNTER_SHOT = "147362";
const hunter = (casts: number[]) =>
  makeUnit("H", {
    class: CombatUnitClass.Hunter,
    spec: CombatUnitSpec.Hunter_BeastMastery,
    spellCastEvents: casts.map((s) => cast(COUNTER_SHOT, s)) as never,
  });

describe("interruptReadySinceMs", () => {
  it("never cast before → null (the caller says kickNeverUsed)", () => {
    expect(
      interruptReadySinceMs(hunter([]), COUNTER_SHOT, T0 + 50_000),
    ).toBeNull();
    // a cast AFTER the instant does not count
    expect(
      interruptReadySinceMs(hunter([60]), COUNTER_SHOT, T0 + 50_000),
    ).toBeNull();
  });

  it("single charge: last cast + the unit's cooldown; null while still on cooldown", () => {
    const u = hunter([10]);
    const cd = interruptCooldownSeconds(COUNTER_SHOT, u)!;
    expect(cd).toBeGreaterThan(0);
    const backMs = T0 + (10 + cd) * 1000;
    expect(interruptReadySinceMs(u, COUNTER_SHOT, backMs - 1)).toBeNull();
    expect(interruptReadySinceMs(u, COUNTER_SHOT, backMs)).toBe(backMs);
    expect(interruptReadySinceMs(u, COUNTER_SHOT, backMs + 760)).toBe(backMs);
  });

  it("agrees with interruptCooldownRemainingMs at every sampled instant", () => {
    const u = hunter([10, 40, 95]);
    for (let s = 0; s <= 200; s += 0.7) {
      const at = T0 + Math.round(s * 1000);
      const remaining = interruptCooldownRemainingMs(u, COUNTER_SHOT, at);
      const since = interruptReadySinceMs(u, COUNTER_SHOT, at);
      const castBefore = [10, 40, 95].some((c) => T0 + c * 1000 <= at);
      if (remaining > 0 || !castBefore) expect(since).toBeNull();
      else {
        expect(since).not.toBeNull();
        expect(since!).toBeLessThanOrEqual(at);
        // it was still on cooldown a millisecond before it came back
        expect(
          interruptCooldownRemainingMs(u, COUNTER_SHOT, since! - 1),
        ).toBeGreaterThan(0);
      }
    }
  });

  it("a reduced cooldown (Storm Conduit: each Lightning Bolt −1 s on Wind Shear) moves the ready instant with it", () => {
    const WIND_SHEAR = "57994";
    const shaman = {
      id: "Player-S",
      name: "Sham-R-US",
      class: 7,
      spec: "262",
      info: { pvpTalents: ["1217092"], talents: [] },
      spellCastEvents: [
        cast(WIND_SHEAR, 10),
        cast("188196", 12),
        cast("188196", 14),
        cast("188196", 16),
      ],
      petSpellCastEvents: [],
    } as never;
    const plain = {
      ...(shaman as object),
      spellCastEvents: [cast(WIND_SHEAR, 10)],
    } as never;
    const at = T0 + 40_000;
    const reduced = interruptReadySinceMs(shaman, WIND_SHEAR, at)!;
    const unreduced = interruptReadySinceMs(plain, WIND_SHEAR, at)!;
    expect(unreduced - reduced).toBe(3_000);
    for (let s = 10; s <= 40; s += 0.5) {
      const t = T0 + s * 1000;
      const remaining = interruptCooldownRemainingMs(shaman, WIND_SHEAR, t);
      const since = interruptReadySinceMs(shaman, WIND_SHEAR, t);
      if (remaining > 0) expect(since).toBeNull();
      else expect(since).toBe(reduced);
    }
  });
});
