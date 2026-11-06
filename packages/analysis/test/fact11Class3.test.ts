/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * fact11 (F26) class 3, rest — a press's observed effect span stops at a
 * re-application the timeline lists as an occurrence of its own (D24 / D30 /
 * D41). The corpus check is `packages/eval/scripts/scan5/fact11.ts`
 * allyOverlapPastAura. D33: a re-press inside the pairing window of the
 * start splits the run when the log pairs both presses tightly (scan5
 * savePressRunsOverlap).
 */
import {
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { isButtonPress } from "../src/utils/castCommitSpans";
import { isPassiveProcCast } from "../src/utils/cooldowns";
import { reconstructEnemyCDTimeline } from "../src/utils/enemyCDs";
import {
  absorbedDuring,
  splitAtRepressRefresh,
} from "../src/utils/enemyDefensives";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const SOUL_IMMOLATION = "1241937";
const row = (event: LogEvent, s: number) => ({
  spellId: SOUL_IMMOLATION,
  spellName: "Soul Immolation",
  srcUnitId: "dh",
  srcUnitName: "DH",
  destUnitId: "dh",
  destUnitName: "DH",
  timestamp: T0 + s * 1000,
  logLine: { event, timestamp: T0 + s * 1000 },
});
const dh = (auras: Array<[LogEvent, number]>, presses: number[]) => ({
  id: "dh",
  name: "DH",
  type: 1,
  class: CombatUnitClass.DemonHunter,
  spec: CombatUnitSpec.DemonHunter_Devourer,
  spellCastEvents: presses.map((s) => row(LogEvent.SPELL_CAST_SUCCESS, s)),
  auraEvents: auras.map(([e, s]) => row(e, s)),
  damageIn: [],
  damageOut: [],
  healOut: [],
  healIn: [],
  absorbsIn: [],
  absorbsOut: [],
  actionIn: [],
  actionOut: [],
  deathRecords: [],
});
const spans = (u: any) =>
  reconstructEnemyCDTimeline([u as never], {
    startTime: T0,
    endTime: T0 + 150_000,
    units: { dh: u },
  } as never)
    .players[0]!.offensiveCDs.filter((c) => /Soul Immolation/.test(c.spellName))
    .map((c) => [
      c.spellName,
      Number(c.castTimeSeconds.toFixed(3)),
      Number(c.buffEndSeconds.toFixed(3)),
    ]);

describe("fact11 D24 / D30 / D41 — a press's span stops at a (no press) re-application", () => {
  it("be1686eb 1:04: the press ends at its own REMOVED, each proc is its own", () => {
    const u = dh(
      [
        [LogEvent.SPELL_AURA_APPLIED, 64.061],
        [LogEvent.SPELL_AURA_REMOVED, 69.06],
        [LogEvent.SPELL_AURA_APPLIED, 69.317],
        [LogEvent.SPELL_AURA_REMOVED, 74.327],
        [LogEvent.SPELL_AURA_APPLIED, 74.579],
        [LogEvent.SPELL_AURA_REMOVED, 79.577],
      ],
      [64.061],
    );
    expect(spans(u)).toEqual([
      ["Soul Immolation", 64.061, 69.06],
      ["Soul Immolation (no press)", 69.317, 74.327],
      ["Soul Immolation (no press)", 74.579, 79.577],
    ]);
  });
  it("8114d8f6 1:42: a proc a later press refreshed is counted once", () => {
    const u = dh(
      [
        [LogEvent.SPELL_AURA_APPLIED, 96.912],
        [LogEvent.SPELL_AURA_REMOVED, 101.912],
        [LogEvent.SPELL_AURA_APPLIED, 102.169],
        [LogEvent.SPELL_AURA_REFRESH, 104.405],
        [LogEvent.SPELL_AURA_REMOVED, 110.179],
      ],
      [96.912, 104.406],
    );
    expect(spans(u)).toEqual([
      ["Soul Immolation", 96.912, 101.912],
      ["Soul Immolation (no press)", 102.169, 104.406],
      ["Soul Immolation", 104.406, 110.179],
    ]);
  });
  it("a re-application its press made still continues the chain", () => {
    // pressed 2 s before the re-application: the press's own (no `(no press)`
    // occurrence), the Dragonrage shape the chain exists for
    const u = dh(
      [
        [LogEvent.SPELL_AURA_APPLIED, 10],
        [LogEvent.SPELL_AURA_REMOVED, 11.5],
        [LogEvent.SPELL_AURA_APPLIED, 11.7],
        [LogEvent.SPELL_AURA_REMOVED, 16.7],
      ],
      [10],
    );
    expect(spans(u)).toEqual([["Soul Immolation", 10, 16.7]]);
  });
});

describe("fact11 D33 — an Ice Barrier re-pressed 0.74 s in", () => {
  // c73ff2b4 0:32: APPLIED + cast 32.385, cast 33.126 with its REFRESH at
  // 33.125, REMOVED 37.140; 145,677 absorbed before the refresh, 205,236 after
  const ICE_BARRIER = "11426";
  const S = 1_000_000;
  const aura = (event: LogEvent, s: number) => ({
    spellId: ICE_BARRIER,
    spellName: "Ice Barrier",
    srcUnitId: "m",
    srcUnitName: "Mage",
    destUnitId: "m",
    timestamp: S + s * 1000,
    logLine: { event, timestamp: S + s * 1000 },
  });
  const hit = (s: number, amount: number) => ({
    spellId: ICE_BARRIER,
    srcUnitId: "m",
    absorbedAmount: amount,
    timestamp: S + s * 1000,
    logLine: { event: LogEvent.SPELL_ABSORBED, timestamp: S + s * 1000 },
  });
  const mage = (refreshS: number) =>
    ({
      id: "m",
      name: "Mage",
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, 32.385),
        aura(LogEvent.SPELL_AURA_REFRESH, refreshS),
        aura(LogEvent.SPELL_AURA_REMOVED, 37.14),
      ],
      absorbsIn: [hit(32.6, 145_677), hit(34, 105_236), hit(36, 100_000)],
    }) as any;
  const iv = {
    spellId: ICE_BARRIER,
    spellName: "Ice Barrier",
    srcUnitName: "Mage",
    srcUnitId: "m",
    fromS: 32.385,
    toS: 37.14,
    inferredStart: false,
    inferredEnd: false,
  };
  it("two runs, each with what it absorbed", () => {
    const u = mage(33.125);
    const out = splitAtRepressRefresh([iv], u, S, () => [32.385, 33.126]);
    expect(out.map((x) => [x.fromS, x.toS])).toEqual([
      [32.385, 33.125],
      [33.125, 37.14],
    ]);
    expect(out.map((x) => absorbedDuring(u, x, S))).toEqual([
      145_677, 205_236,
    ]);
  });
  it("control: the start's own press landing on a copy (no press beside the APPLIED) stays one run", () => {
    const u = mage(33.125);
    const out = splitAtRepressRefresh([iv], u, S, () => [33.126]);
    expect(out.map((x) => [x.fromS, x.toS])).toEqual([[32.385, 37.14]]);
  });
  it("control: a REFRESH with no press beside it stays one run", () => {
    const u = mage(33.125);
    const out = splitAtRepressRefresh([iv], u, S, () => [32.385, 33.4]);
    expect(out.map((x) => [x.fromS, x.toS])).toEqual([[32.385, 37.14]]);
  });
});

describe("fact11 D3 — Sanctified Ground's rows are a passive's", () => {
  it("no button (no SpellCooldowns row), so no press", () => {
    expect(isButtonPress("289655")).toBe(false);
    expect(isPassiveProcCast({ spellId: "289655" })).toBe(true);
    // the press it follows stays one
    expect(isPassiveProcCast({ spellId: "2050" })).toBe(false);
  });
});
