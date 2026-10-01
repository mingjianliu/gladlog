import {
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The multi-charge branch of `interruptReadySinceMs` (triage kick-priority
 * F-P5). No interrupt in the 12.1 catalog has two charges for a bare unit, so
 * the charge cap is injected: every other export of `cooldowns` stays real.
 * Not in `vitest.shared.json` (it mocks a module).
 */
vi.mock("../src/utils/cooldowns", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/utils/cooldowns")>();
  return {
    ...actual,
    unitCooldownOf: vi.fn(
      (...args: Parameters<typeof actual.unitCooldownOf>) => {
        const real = actual.unitCooldownOf(...args);
        return real ? { ...real, charges: 2 } : real;
      },
    ),
  };
});

import { ensureAnalysisData } from "../src/data/ensure";
import {
  interruptCooldownRemainingMs,
  interruptCooldownSeconds,
  interruptReadySinceMs,
} from "../src/utils/enemyInterrupts";
import { makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const COUNTER_SHOT = "147362";
const cast = (s: number) => ({
  spellId: COUNTER_SHOT,
  spellName: "x",
  timestamp: T0 + s * 1000,
  logLine: {
    event: LogEvent.SPELL_CAST_SUCCESS,
    timestamp: T0 + s * 1000,
    parameters: [],
  },
});
const hunter = (casts: number[]) =>
  makeUnit("H", {
    class: CombatUnitClass.Hunter,
    spec: CombatUnitSpec.Hunter_BeastMastery,
    spellCastEvents: casts.map(cast) as never,
  });
const at = (s: number) => T0 + s * 1000;

describe("interruptReadySinceMs — two charges", () => {
  it("never ran out → null: ready since before its first logged cast", () => {
    const u = hunter([0]);
    expect(interruptCooldownRemainingMs(u, COUNTER_SHOT, at(5))).toBe(0);
    expect(interruptReadySinceMs(u, COUNTER_SHOT, at(5))).toBeNull();
  });

  it("ran out → ready since the first recharge; null again while empty", () => {
    const cd = interruptCooldownSeconds(COUNTER_SHOT, hunter([]))!;
    // both charges gone at 1 s; the recharge that started at 0 s ends at cd
    const u = hunter([0, 1]);
    expect(interruptReadySinceMs(u, COUNTER_SHOT, at(cd - 0.5))).toBeNull();
    expect(interruptReadySinceMs(u, COUNTER_SHOT, at(cd + 3))).toBe(at(cd));
    // that charge is spent again at cd + 1: empty until the second recharge,
    // which runs sequentially and ends at 2 × cd
    const v = hunter([0, 1, cd + 1]);
    expect(interruptReadySinceMs(v, COUNTER_SHOT, at(cd + 3))).toBeNull();
    expect(interruptReadySinceMs(v, COUNTER_SHOT, at(2 * cd + 2))).toBe(
      at(2 * cd),
    );
  });

  it("agrees with interruptCooldownRemainingMs at every instant", () => {
    const cd = interruptCooldownSeconds(COUNTER_SHOT, hunter([]))!;
    const u = hunter([0, 1, cd + 1, cd + 30]);
    for (let s = 0.35; s < 3 * cd + 40; s += 0.7) {
      const remaining = interruptCooldownRemainingMs(u, COUNTER_SHOT, at(s));
      const since = interruptReadySinceMs(u, COUNTER_SHOT, at(s));
      if (remaining > 0) expect(since, `t=${s}`).toBeNull();
      if (since !== null) {
        expect(since, `t=${s}`).toBeLessThanOrEqual(at(s));
        // it reached 0 exactly there: still on cooldown a moment before
        expect(
          interruptCooldownRemainingMs(u, COUNTER_SHOT, since - 1),
          `t=${s}`,
        ).toBeGreaterThan(0);
        expect(interruptCooldownRemainingMs(u, COUNTER_SHOT, since)).toBe(0);
      }
    }
  });
});
