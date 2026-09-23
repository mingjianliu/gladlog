/**
 * GH #65 item 1 (2026-09-23, user ruling 2026-09-22: empower- and combo-point-
 * scaled durations are one shape): an aura's length set by a parameter of the
 * cast that produced it, read from the log (`castParamAt`), and priced by
 * `buffFullDurationForCaster(…, atMs)` with the talent layer on top.
 */
import {
  CombatUnitPowerType,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { buffFullDurationForCaster } from "../src/utils/buffDuration";
import { CAST_PARAM_WINDOW_MS, castParamAt } from "../src/utils/castParam";
import { makeUnit } from "./ported/testHelpers";

const T = 1_000_000;
const cast = (spellId: string, ms: number) =>
  ({
    spellId,
    logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: ms },
  }) as never;
const sample = (ms: number, cp: number, max = 5) =>
  ({
    timestamp: ms,
    advancedActorPowers: [
      { type: CombatUnitPowerType.ComboPoints, current: cp, max },
    ],
  }) as never;
const empower = (spellId: string, ms: number, level: number) =>
  ({
    spellId,
    level,
    logLine: { event: "SPELL_EMPOWER_END", timestamp: ms },
  }) as never;

describe("castParamAt — the parameter of the producing cast", () => {
  it("combo points: the finisher's own sample, before the cost", () => {
    const feral = {
      spellCastEvents: [cast("1079", T)],
      advancedActions: [sample(T, 5)],
    };
    expect(castParamAt(feral, "1079", T + 50)).toBe(5);
  });

  it("empower level: the SPELL_EMPOWER_END just before the application", () => {
    const evoker = { empowerEnds: [empower("355936", T, 2)] };
    expect(castParamAt(evoker, "355941", T + 10)).toBe(2);
  });

  it("outside the window, a different cast, or no sample → null (never inferred)", () => {
    const u = {
      spellCastEvents: [cast("1079", T)],
      advancedActions: [sample(T, 5)],
      empowerEnds: [empower("357208", T, 1)],
    };
    expect(castParamAt(u, "1079", T + CAST_PARAM_WINDOW_MS + 1)).toBeNull();
    expect(castParamAt(u, "355941", T + 10)).toBeNull(); // Fire Breath press ≠ Dream Breath
    expect(
      castParamAt({ spellCastEvents: [cast("1079", T)] }, "1079", T),
    ).toBeNull();
    expect(castParamAt(u, "774", T)).toBeNull(); // not a cast-parameter aura
  });
});

describe("buffFullDurationForCaster(…, atMs) — formula base + talent layer", () => {
  it("Rip 4 × (CP + 1); Circle of Life and Death × Veinripper MULTIPLY (24 × 0.8 × 1.25 = 24)", () => {
    const CIRCLE = { id1: 82092, id2: 103152, count: 1 };
    const noVeinripper = makeUnit("f1", {
      spec: CombatUnitSpec.Druid_Feral,
      info: { talents: [CIRCLE], pvpTalents: [] },
      spellCastEvents: [cast("1079", T)],
      advancedActions: [sample(T, 5)],
    });
    expect(buffFullDurationForCaster("1079", noVeinripper, T)).toBeCloseTo(
      19.2,
    );
    const cp3 = makeUnit("f3", {
      spec: CombatUnitSpec.Druid_Feral,
      info: { talents: [CIRCLE], pvpTalents: [] },
      spellCastEvents: [cast("1079", T)],
      advancedActions: [sample(T, 3)],
    });
    expect(buffFullDurationForCaster("1079", cp3, T)).toBeCloseTo(12.8);
  });

  it("Rupture 7 CP = 32; Envenom 7 CP = 7", () => {
    const rogue = makeUnit("r1", {
      spec: CombatUnitSpec.Rogue_Subtlety,
      info: { talents: [], pvpTalents: [] },
      spellCastEvents: [cast("1943", T), cast("32645", T + 5000)],
      advancedActions: [sample(T, 7, 7), sample(T + 5000, 7, 7)],
    });
    expect(buffFullDurationForCaster("1943", rogue, T)).toBe(32);
    expect(buffFullDurationForCaster("32645", rogue, T + 5000)).toBe(7);
  });

  it("Dream Breath 20 − 4 × level, Fire Breath 30 − 6 × level", () => {
    // makeUnit does not carry empowerEnds — attach it after
    const evoker = {
      ...makeUnit("e1", {
        spec: CombatUnitSpec.Evoker_Preservation,
        info: { talents: [], pvpTalents: [] },
      }),
      empowerEnds: [empower("355936", T, 1), empower("357208", T + 9000, 3)],
    };
    expect(buffFullDurationForCaster("355941", evoker, T + 5)).toBe(16);
    expect(buffFullDurationForCaster("357209", evoker, T + 9005)).toBe(12);
  });

  it("no atMs, or an unreadable parameter → exactly the previous answer", () => {
    expect(buffFullDurationForCaster("1079", undefined)).toBe(4);
    const blind = makeUnit("b1", { spec: CombatUnitSpec.Rogue_Subtlety });
    expect(buffFullDurationForCaster("1943", blind, T)).toBe(4);
  });
});
