/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * F15 / fact1215 R4 + C4: who broke an aura, and the caster-side link aura of
 * Blessing of Sacrifice. Shapes from the audited rounds: 06356dd9 (a
 * Desperate Soul's Wrath of Nathreza on a BROKEN_SPELL row naming the
 * holder), 2abc1934 (a Psychic Scream on a paladin broken by the damage his
 * own Blessing moved off the hunter), 0f894aee (the paladin's own 6940 link
 * stacked with Time Dilation).
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { stackedDefensivePairs } from "../src/analysis/stackedDefensives";
import {
  breakerOfBrokenRow,
  BREAKING_HIT_LOOKBACK_MS,
  isCasterSideLinkAura,
} from "../src/utils/brokenRowBreaker";
import { analyzeCcBreaks } from "../src/utils/ccBreakAnalysis";
import { auraBreakAtRemoval } from "../src/utils/ccTrinketAnalysis";

const T0 = 1_000_000;
const HOWL = "5484";
const WRATH = "1278047"; // Wrath of Nathreza (Desperate Soul)
const BOS = "6940";
const SOUL_LINK = "108446";
const SCREAM = "8122";

let line = 0;
const row = (
  event: string,
  atMs: number,
  spellId: string,
  src: [string, string],
  dest: string,
  extra?: [string, string],
): any => ({
  timestamp: T0 + atMs,
  spellId,
  spellName: spellId,
  srcUnitId: src[0],
  srcUnitName: src[1],
  destUnitId: dest,
  logLine: {
    event,
    timestamp: T0 + atMs,
    // log order follows time; same-ms rows keep construction order
    lineIndex: atMs * 1000 + ++line,
    parameters: extra ? Object.assign([], { 11: extra[0], 12: extra[1] }) : [],
  },
});
const hit = (
  atMs: number,
  spellId: string,
  src: [string, string],
  ev = "SPELL_DAMAGE",
) => ({
  ...row(ev, atMs, spellId, src, "H"),
  amount: -100,
  effectiveAmount: -100,
});
const holderWith = (auraEvents: any[], damageIn: any[] = []) =>
  ({ id: "H", name: "Holder", auraEvents, damageIn }) as any;

describe("breakerOfBrokenRow", () => {
  it("a row naming the holder: the other unit whose hit of the spell landed just before (R4, 06356dd9)", () => {
    const brk = row(
      LogEvent.SPELL_AURA_BROKEN_SPELL,
      5012,
      HOWL,
      ["H", "Holder"],
      "H",
      [WRATH, "Wrath of Nathreza"],
    );
    const h = holderWith(
      [row(LogEvent.SPELL_AURA_APPLIED, 0, HOWL, ["W", "Warlock"], "H"), brk],
      [hit(5000, WRATH, ["G", "Desperate Soul"])],
    );
    expect(breakerOfBrokenRow(h, brk)).toEqual({
      unitId: "G",
      name: "Desperate Soul",
    });
  });
  it("…not a hit older than the look-back", () => {
    const brk = row(
      LogEvent.SPELL_AURA_BROKEN_SPELL,
      5000 + BREAKING_HIT_LOOKBACK_MS + 1,
      HOWL,
      ["H", "Holder"],
      "H",
      [WRATH, "x"],
    );
    const h = holderWith([brk], [hit(5000, WRATH, ["G", "Desperate Soul"])]);
    expect(breakerOfBrokenRow(h, brk)).toEqual({ unitId: "H", name: "Holder" });
  });
  it("a row naming the holder with no hit: the caster of the damage-over-time ticking on it", () => {
    const DOT = "1287663";
    const brk = row(
      LogEvent.SPELL_AURA_BROKEN_SPELL,
      6000,
      HOWL,
      ["H", "Holder"],
      "H",
      [DOT, "Rune"],
    );
    const h = holderWith([
      row(LogEvent.SPELL_AURA_APPLIED, 1000, DOT, ["E", "Enemy"], "H"),
      brk,
    ]);
    expect(breakerOfBrokenRow(h, brk)).toEqual({ unitId: "E", name: "Enemy" });
  });
  it("…a damage-over-time already removed is not it", () => {
    const DOT = "1287663";
    const brk = row(
      LogEvent.SPELL_AURA_BROKEN_SPELL,
      6000,
      HOWL,
      ["H", "Holder"],
      "H",
      [DOT, "Rune"],
    );
    const h = holderWith([
      row(LogEvent.SPELL_AURA_APPLIED, 1000, DOT, ["E", "Enemy"], "H"),
      row(LogEvent.SPELL_AURA_REMOVED, 3000, DOT, ["E", "Enemy"], "H"),
      brk,
    ]);
    expect(breakerOfBrokenRow(h, brk)).toEqual({ unitId: "H", name: "Holder" });
  });
  it("the holder's own mechanic (Stagger): the holder, as logged", () => {
    const brk = row(
      LogEvent.SPELL_AURA_BROKEN_SPELL,
      6000,
      HOWL,
      ["H", "Holder"],
      "H",
      ["124255", "Stagger"],
    );
    const h = holderWith(
      [brk],
      [hit(5990, "124255", ["H", "Holder"], "SPELL_PERIODIC_DAMAGE")],
    );
    expect(breakerOfBrokenRow(h, brk)).toEqual({ unitId: "H", name: "Holder" });
  });
  it("Blessing of Sacrifice damage moved onto the paladin: the paladin's own spell broke it (C4, 2abc1934)", () => {
    const brk = row(
      LogEvent.SPELL_AURA_BROKEN_SPELL,
      9000,
      SCREAM,
      ["A", "Hunter"],
      "H",
      [BOS, "Blessing of Sacrifice"],
    );
    const h = holderWith(
      [
        row(LogEvent.SPELL_AURA_APPLIED, 1000, BOS, ["H", "Holder"], "H"),
        row(LogEvent.SPELL_AURA_APPLIED, 8000, SCREAM, ["P", "Priest"], "H"),
        brk,
      ],
      [hit(8990, BOS, ["A", "Hunter"], LogEvent.DAMAGE_SPLIT)],
    );
    expect(breakerOfBrokenRow(h, brk)).toEqual({ unitId: "H", name: "Holder" });
  });
  it("…Soul Link's split names the warlock, whose spell it is: as logged", () => {
    const brk = row(
      LogEvent.SPELL_AURA_BROKEN_SPELL,
      9000,
      SCREAM,
      ["W", "Warlock"],
      "H",
      [SOUL_LINK, "Soul Link"],
    );
    const h = holderWith(
      [brk],
      [hit(8995, SOUL_LINK, ["W", "Warlock"], LogEvent.DAMAGE_SPLIT)],
    );
    expect(breakerOfBrokenRow(h, brk)).toEqual({
      unitId: "W",
      name: "Warlock",
    });
  });
  it("an ordinary row: its source; a row with no source: none", () => {
    const brk = row(
      LogEvent.SPELL_AURA_BROKEN_SPELL,
      9000,
      SCREAM,
      ["E", "Enemy"],
      "H",
      ["133", "Fireball"],
    );
    expect(breakerOfBrokenRow(holderWith([brk]), brk)).toEqual({
      unitId: "E",
      name: "Enemy",
    });
    const none = row(
      LogEvent.SPELL_AURA_BROKEN_SPELL,
      9000,
      SCREAM,
      ["0000000000000000", ""],
      "H",
      ["32409", "Shadow Word: Death"],
    );
    expect(breakerOfBrokenRow(holderWith([none]), none)).toBeUndefined();
  });
});

describe("codex 20-F15-19", () => {
  const noLine = (r: any) => ({
    ...r,
    logLine: { ...r.logLine, lineIndex: undefined },
  });
  it("without line indexes, a hit in the row's own ms is not read (it may have come after the row)", () => {
    const a = noLine(hit(5000, WRATH, ["A", "Caster A"]));
    const brk = noLine(
      row(LogEvent.SPELL_AURA_BROKEN_SPELL, 5000, HOWL, ["H", "Holder"], "H", [
        WRATH,
        "x",
      ]),
    );
    const b = noLine(hit(5000, WRATH, ["B", "Caster B"]));
    expect(breakerOfBrokenRow(holderWith([brk], [a, b]), brk)).toEqual({
      unitId: "H",
      name: "Holder",
    });
  });
  it("a damage-over-time the log never closed is its caster's only for its official length", () => {
    const DOT = "1287663"; // 8 s
    const brk = row(
      LogEvent.SPELL_AURA_BROKEN_SPELL,
      180_000,
      HOWL,
      ["H", "Holder"],
      "H",
      [DOT, "Rune"],
    );
    const stale = holderWith([
      row(LogEvent.SPELL_AURA_APPLIED, 1000, DOT, ["E", "Enemy"], "H"),
      brk,
    ]);
    expect(breakerOfBrokenRow(stale, brk)).toEqual({
      unitId: "H",
      name: "Holder",
    });
    // closed by its own REMOVED after the break: it was up
    const closed = holderWith([
      row(LogEvent.SPELL_AURA_APPLIED, 1000, DOT, ["E", "Enemy"], "H"),
      brk,
      row(LogEvent.SPELL_AURA_REMOVED, 181_000, DOT, ["E", "Enemy"], "H"),
    ]);
    expect(breakerOfBrokenRow(closed, brk)).toEqual({
      unitId: "E",
      name: "Enemy",
    });
  });
});

describe("the two readers", () => {
  const brk = row(
    LogEvent.SPELL_AURA_BROKEN_SPELL,
    5012,
    HOWL,
    ["H", "Holder"],
    "H",
    [WRATH, "Wrath of Nathreza"],
  );
  const applied = row(
    LogEvent.SPELL_AURA_APPLIED,
    0,
    HOWL,
    ["W", "Warlock"],
    "H",
  );
  const holder = {
    ...holderWith([applied, brk], [hit(5000, WRATH, ["G", "Desperate Soul"])]),
    reaction: CombatUnitReaction.Hostile,
    spec: CombatUnitSpec.Monk_Mistweaver,
    info: {},
  };
  it("auraBreakAtRemoval names the guardian", () => {
    expect(auraBreakAtRemoval(holder, HOWL, T0, T0 + 5012)).toMatchObject({
      kind: "broken",
      byUnitId: "G",
      byName: "Desperate Soul",
    });
  });
  it("analyzeCcBreaks files it as our side's break (the guardian is our warlock's)", () => {
    const warlock = {
      id: "W",
      name: "Warlock",
      reaction: CombatUnitReaction.Friendly,
      auraEvents: [],
      info: {},
    } as any;
    const guardian = {
      id: "G",
      name: "Desperate Soul",
      ownerId: "W",
      auraEvents: [],
    } as any;
    const stats = analyzeCcBreaks(
      [warlock],
      [holder],
      { startTime: T0, endTime: T0 + 60_000 },
      [guardian],
      [],
    );
    expect(stats.events).toHaveLength(1);
    expect(stats.events[0]).toMatchObject({
      breakerUnitId: "G",
      breakerIsFriendly: true,
      breakerName: "Warlock(宠物)",
    });
  });
});

describe("the caster-side link aura (C4)", () => {
  it("is Blessing of Sacrifice on its own caster only", () => {
    expect(isCasterSideLinkAura(BOS, true)).toBe(true);
    expect(isCasterSideLinkAura(BOS, false)).toBe(false);
    expect(isCasterSideLinkAura("33206", true)).toBe(false);
  });
  it("[STACKED DEFENSIVES] does not stack the paladin's own link with a real wall (0f894aee)", () => {
    const T = (
      t: number,
      ev: string,
      id: string,
      src: string,
      srcName: string,
    ) => ({
      timestamp: T0 + t,
      spellId: id,
      srcUnitId: src,
      srcUnitName: srcName,
      destUnitId: "P",
      logLine: { event: ev, timestamp: T0 + t },
    });
    const base = {
      reaction: CombatUnitReaction.Friendly,
      info: { teamId: "0" },
      advancedActions: [
        { timestamp: T0, advancedActorCurrentHp: 100, advancedActorMaxHp: 100 },
      ],
      damageIn: [],
      absorbsIn: [],
      spellCastEvents: [],
    };
    const owner = {
      ...base,
      id: "O",
      name: "Owner",
      spec: CombatUnitSpec.Evoker_Preservation,
      auraEvents: [],
    };
    const paladin = {
      ...base,
      id: "P",
      name: "Paladin",
      spec: CombatUnitSpec.Paladin_Retribution,
      auraEvents: [
        T(10_000, LogEvent.SPELL_AURA_APPLIED, BOS, "P", "Paladin"),
        T(11_000, LogEvent.SPELL_AURA_APPLIED, "357170", "O", "Owner"),
        T(18_000, LogEvent.SPELL_AURA_REMOVED, "357170", "O", "Owner"),
        T(20_000, LogEvent.SPELL_AURA_REMOVED, BOS, "P", "Paladin"),
      ],
    };
    const combat = {
      startTime: T0,
      endTime: T0 + 60_000,
      units: { O: owner, P: paladin },
      startInfo: { bracket: "3v3" },
    };
    expect(stackedDefensivePairs(owner, combat)).toEqual([]);
  });
});
