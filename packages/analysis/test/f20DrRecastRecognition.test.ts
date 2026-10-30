/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * F20 dr residual + codex re-review of c7304a60a (P2): a control whose cast
 * applies it only through a talent trigger (Terror of the Skies 372245 from
 * Deep Breath 433874 / 357210) or only sometimes (a stealth Rake 1822 stuns
 * with 163505) was missing from `castEffectAuraGenerated.json`, so
 * `ccRecastBetween` never saw the recast and read its cast-backed REFRESH as
 * the same application. 114a4df7 r4: Deep Breath 11.477 → Terror 13.500,
 * Deep Breath 15.323 → Terror REFRESH 16.343 (ends 17.844, half of 3 s) —
 * two stuns, printed as one.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  LogEvent,
} from "@gladlog/parser-compat";

import { castsOfEffectAura } from "../src/data/castEffectAuras";
import {
  analyzeOutgoingCCChains,
  ccRecastBetween,
} from "../src/utils/drAnalysis";
import { makeUnit } from "./ported/testHelpers";

const T0 = 1_000_000;
const S = (sec: number) => T0 + sec * 1000;
const COMBAT = {
  startTime: T0,
  endTime: T0 + 300_000,
  startInfo: { zoneId: "0" },
} as any;

const aura = (event: LogEvent, spellId: string, sec: number, src: string) => ({
  logLine: { event, timestamp: S(sec), parameters: [] },
  timestamp: S(sec),
  spellId,
  spellName: spellId,
  srcUnitId: src,
  srcUnitName: src,
  destUnitId: "sham",
  destUnitName: "Sham",
  auraType: "DEBUFF",
  effectiveAmount: 0,
});
const cast = (spellId: string, sec: number, dest = "sham") => ({
  spellId,
  destUnitId: dest,
  timestamp: S(sec),
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: S(sec) },
});

describe("cast → effect aura: trigger-only and sometimes-applied controls", () => {
  it("Terror of the Skies 372245 is applied by Deep Breath (433874, 357210)", () => {
    expect(castsOfEffectAura("372245")).toEqual(
      expect.arrayContaining(["433874", "357210"]),
    );
  });
  it("Rake's stun 163505 is applied by Rake 1822", () => {
    expect(castsOfEffectAura("163505")).toContain("1822");
  });
});

describe("ccRecastBetween: a press row logged just after its aura", () => {
  // b3dea9f6 r1: stealth Rake stun REFRESH 19.0498, its cast row 19.0508
  const druid = (sec: number) =>
    makeUnit("druid", { spellCastEvents: [cast("1822", sec)] });
  it("1 ms after the REFRESH is its press", () => {
    expect(
      ccRecastBetween([druid(19.0508)], "163505", "sham", S(10), S(19.0498)),
    ).toBe(true);
  });
  it("past CAST_ROW_LAG_MAX_MS it is not", () => {
    expect(
      ccRecastBetween([druid(19.2)], "163505", "sham", S(10), S(19.0498)),
    ).toBe(false);
  });
});

describe("outgoing DR: a Deep Breath recast's Terror REFRESH is a new stun (codex P2)", () => {
  const run = (casts: any[]) => {
    const sham = makeUnit("sham", {
      spec: CombatUnitSpec.Shaman_Restoration,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "372245", 13.5, "evoker"),
        aura(LogEvent.SPELL_AURA_REFRESH, "372245", 16.343, "evoker"),
        aura(LogEvent.SPELL_AURA_REMOVED, "372245", 17.844, "evoker"),
      ],
    });
    (sham as any).type = CombatUnitType.Player;
    const evoker = makeUnit("evoker", { spellCastEvents: casts });
    return analyzeOutgoingCCChains([evoker] as any, [sham] as any, {
      ...COMBAT,
      units: { evoker, sham },
    })[0]!.applications.map((a) => a.drInfo.level);
  };
  it("114a4df7 r4: two Deep Breaths, two stuns (Full, 50 %)", () => {
    expect(
      run([cast("433874", 11.477, ""), cast("433874", 15.323, "")]),
    ).toEqual(["Full", "50%"]);
  });
  it("one Deep Breath: the REFRESH is a DR step all the same (F20 dr, measured)", () => {
    expect(run([cast("433874", 11.477, "")])).toEqual(["Full", "50%"]);
  });
});
