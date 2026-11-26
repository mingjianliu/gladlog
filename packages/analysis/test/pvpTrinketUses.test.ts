/**
 * Triage 2026-09-29 enemy-def F-E19 + res-readiness F-C15 (G7-P2): one
 * "used the PvP trinket" predicate — the Medallion's 336126 cast, or
 * Adaptation's 283167 trigger aura (the old 195756 cast id is dead), with
 * Adaptation's return read from its 336139 lockout interval.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  analyzePlayerCCAndTrinket,
  pvpTrinketRemainingSecondsAt,
} from "../src/utils/ccTrinketAnalysis";
import { getTrinketStateAtTime } from "../src/utils/killWindowTargetSelection";
import {
  pvpTrinketUses,
  trinketUseRemainingSeconds,
} from "../src/utils/pvpTrinketUses";

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;
const aura = (spellId: string, event: string, s: number) => ({
  spellId,
  spellName: spellId,
  srcUnitId: "P",
  destUnitId: "P",
  timestamp: at(s),
  logLine: { event, timestamp: at(s) },
});
// 483f7433: 283167 APPLIED 28.783; 336139 28.882 → 88.883
const adaptationPriest: any = {
  id: "P",
  spellCastEvents: [],
  auraEvents: [
    aura("283167", LogEvent.SPELL_AURA_APPLIED, 28.783),
    aura("336139", LogEvent.SPELL_AURA_APPLIED, 28.882),
    aura("283167", LogEvent.SPELL_AURA_REMOVED, 28.883),
    aura("336139", LogEvent.SPELL_AURA_REMOVED, 88.883),
  ],
};

describe("pvpTrinketUses", () => {
  it("Adaptation: the trigger aura is the use; the lockout's REMOVED is when it is back", () => {
    expect(pvpTrinketUses(adaptationPriest)).toEqual([
      { atMs: at(28.783), readyAtMs: at(88.883), kind: "adaptation" },
    ]);
  });
  it("a lockout still up at the round's end reads Infinity; the Medallion reads its cast", () => {
    const open: any = {
      ...adaptationPriest,
      auraEvents: adaptationPriest.auraEvents.slice(0, 3),
    };
    expect(pvpTrinketUses(open)[0]!.readyAtMs).toBe(Number.POSITIVE_INFINITY);
    const medal: any = {
      id: "M",
      auraEvents: [],
      spellCastEvents: [
        {
          spellId: "336126",
          logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: at(10) },
        },
      ],
    };
    expect(pvpTrinketUses(medal)).toEqual([
      { atMs: at(10), kind: "medallion" },
    ]);
  });
  it("F-C15: remaining at 64 = 24.9 s from the log interval, not the cooldown constant", () => {
    const remaining = pvpTrinketRemainingSecondsAt(
      {
        trinketType: "Adaptation",
        trinketUseTimes: [28.783],
        trinketReadyAt: [88.883],
        trinketCooldownSeconds: 90,
      },
      64,
    );
    expect(remaining).toBeCloseTo(24.883, 3);
  });
  it("F-E19: the KA trinket state reads the same uses", () => {
    expect(getTrinketStateAtTime(adaptationPriest, 64, T0, true)).toBe(false);
    expect(getTrinketStateAtTime(adaptationPriest, 89, T0, true)).toBe(true);
    expect(getTrinketStateAtTime(adaptationPriest, 20, T0, true)).toBe(true);
  });
  it("KA reads the state at the attempt's raw start: a same-second trinket is the response, not a spent trinket", () => {
    // the 28.783 s proc answers an opener that started at 28.2 s — the target
    // HAD its trinket when the attempt began ("trinket up … FAILED: target
    // trinketed out"); from 28.783 on it is spent
    expect(getTrinketStateAtTime(adaptationPriest, 28.2, T0, true)).toBe(true);
    expect(getTrinketStateAtTime(adaptationPriest, 28.9, T0, true)).toBe(false);
    // one primitive, two modes: exact time for KA, the render grid for the
    // peel / bookmark lines (a use counts from the second it prints at)
    const uses = [{ atSeconds: 28.783, readyAtSeconds: 88.883 }];
    expect(trinketUseRemainingSeconds(uses, 90, 28.2, false)).toBe(0);
    expect(trinketUseRemainingSeconds(uses, 90, 28, true)).toBeGreaterThan(0);
    expect(
      pvpTrinketRemainingSecondsAt(
        {
          trinketType: "Adaptation",
          trinketUseTimes: [28.783],
          trinketReadyAt: [88.883],
          trinketCooldownSeconds: 90,
        },
        28,
        { renderGrid: true },
      ),
    ).toBe(trinketUseRemainingSeconds(uses, 90, 28, true));
  });
  it("codex review: an observed Adaptation proc counts even when the equipment is unknown", () => {
    // no `info.equipment` → detectTrinketType reads "Unknown"
    const summary = analyzePlayerCCAndTrinket(
      {
        ...adaptationPriest,
        name: "P-R-US",
        damageIn: [],
        actionIn: [],
        actionOut: [],
        healIn: [],
        absorbsIn: [],
        advancedActions: [],
        deathRecords: [],
      },
      [],
      { startTime: T0, endTime: at(112), startInfo: { zoneId: "1505" } },
    );
    expect(summary.trinketType).toBe("Unknown");
    expect(summary.trinketUseTimes).toEqual([28.783]);
  });
});
