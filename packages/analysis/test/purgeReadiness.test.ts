/**
 * Triage 2026-09-29 missed-cleanse F-P5 + F-P7 (ruling A19 = C, codex r1 / r2
 * 09-30): Hunters purge (Tranquilizing Shot), the "Critical only" gate reads
 * the purge spell's DB2 cooldown, and a missed purge says when the purge came
 * back — read from cooldown-consuming CASTS (a purge that removed nothing
 * still spent it), rendered by the live timeline suffix.
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { buildMatchContext } from "../src/context/buildMatchContext";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  canOffensivePurge,
  formatMissedPurgeExemption,
  isCdGatedPurger,
  reconstructDispelSummary,
} from "../src/utils/dispelAnalysis";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;
const combat = { startTime: T0, endTime: at(60) };
const hunter = (castS?: number, removes?: string): any =>
  makeUnit("h1", {
    name: "Hunter-R-US",
    spec: CombatUnitSpec.Hunter_BeastMastery,
    class: CombatUnitClass.Hunter,
    reaction: CombatUnitReaction.Friendly,
    spellCastEvents:
      castS === undefined
        ? []
        : [
            {
              spellId: "19801",
              spellName: "Tranquilizing Shot",
              timestamp: at(castS),
              srcUnitId: "h1",
              destUnitId: "e1",
              logLine: {
                event: LogEvent.SPELL_CAST_SUCCESS,
                timestamp: at(castS),
              },
            },
          ],
    actionOut:
      castS === undefined || removes === undefined
        ? []
        : [
            {
              spellId: "19801",
              spellName: "Tranquilizing Shot",
              extraSpellId: removes,
              extraSpellName: removes,
              timestamp: at(castS),
              srcUnitId: "h1",
              srcUnitName: "Hunter-R-US",
              destUnitId: "e1",
              destUnitName: "Paladin-R-US",
              logLine: { event: LogEvent.SPELL_DISPEL, timestamp: at(castS) },
            },
          ],
  });
const bopOn = (from: number, to: number): any =>
  makeUnit("e1", {
    name: "Paladin-R-US",
    spec: CombatUnitSpec.Paladin_Retribution,
    class: CombatUnitClass.Paladin,
    reaction: CombatUnitReaction.Hostile,
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        "1022",
        at(from),
        "e1",
        "e1",
        "BUFF",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        "1022",
        at(to),
        "e1",
        "e1",
        "BUFF",
      ),
    ],
  });
const windowOf = (h: any, e: any) =>
  reconstructDispelSummary([h], [e], combat).missedPurgeWindows.find(
    (w) => w.spellId === "1022",
  )!;

describe("F-P5 roster + A19 = C gate", () => {
  it("a Hunter can offensive-purge, and Tranquilizing Shot's 10 s DB2 cooldown gates it", () => {
    expect(canOffensivePurge(hunter())).toBe(true);
    expect(isCdGatedPurger(hunter())).toBe(true);
  });
});

describe("F-P7 fixtures (codex r2)", () => {
  it("(a) a Tranquilizing Shot at 6 s that removed nothing, BoP 12–15.5 s → on cooldown for the whole buff", () => {
    const w = windowOf(hunter(6), bopOn(12, 15.5));
    expect(w.purgeWasOnCD).toBe(true);
    expect(w.purgeReadyAtSeconds).toBe(16);
    expect(formatMissedPurgeExemption(w)).toBe(
      " | purge on cooldown for the whole buff (ready 0:16) — not actionable",
    );
  });
  it("(c) the same cast, BoP 15–25 s → back at 0:16 with 9 s of the buff left", () => {
    const w = windowOf(hunter(6), bopOn(15, 25));
    expect(formatMissedPurgeExemption(w)).toBe(
      " | purge on cooldown at application — ready at 0:16 (9s of the buff left)",
    );
  });
  it("codex review: a priest whose Mass Dispel is on cooldown still has Dispel Magic — ready", () => {
    // Mass Dispel (32375) removed an enemy buff at 6 s; Dispel Magic (528, no
    // cooldown) was never cast. BoP 12–16 s must not read "purge on cooldown".
    const ev = (event: LogEvent, extra: object) => ({
      spellId: "32375",
      spellName: "Mass Dispel",
      timestamp: at(6),
      srcUnitId: "p1",
      srcUnitName: "Priest-R-US",
      destUnitId: "e1",
      destUnitName: "Paladin-R-US",
      logLine: { event, timestamp: at(6) },
      ...extra,
    });
    const priest: any = makeUnit("p1", {
      name: "Priest-R-US",
      spec: CombatUnitSpec.Priest_Discipline,
      class: CombatUnitClass.Priest,
      reaction: CombatUnitReaction.Friendly,
      spellCastEvents: [ev(LogEvent.SPELL_CAST_SUCCESS, {})],
      actionOut: [
        ev(LogEvent.SPELL_DISPEL, {
          extraSpellId: "1044",
          extraSpellName: "1044",
        }),
      ],
    });
    const w = windowOf(priest, bopOn(12, 16));
    expect(w.purgeWasOnCD).toBe(false);
    expect(formatMissedPurgeExemption(w)).toBe("");
  });
  it("no earlier cast → ready, no suffix", () => {
    const w = windowOf(hunter(), bopOn(15, 25));
    expect(w.purgeWasOnCD).toBe(false);
    expect(formatMissedPurgeExemption(w)).toBe("");
  });
});

// The acceptance asks for the live path: the same fixtures through
// buildMatchContext (reconstructDispelSummary → the timeline's
// [MISSED PURGE OPPORTUNITY] line), not the window object alone.
describe("F-P7 fixtures through buildMatchContext", () => {
  const contextOf = (h: any, e: any) =>
    buildMatchContext(
      {
        ...combat,
        units: { h1: h, e1: e },
        startInfo: { zoneId: "1505", bracket: "3v3" },
      } as any,
      [h],
      [e],
      { owner: h },
    );
  const liveLine = (h: any, e: any) =>
    contextOf(h, e)
      .split("\n")
      .filter((l) => l.includes("[MISSED PURGE OPPORTUNITY]"));
  it("(a) a Tranquilizing Shot that removed nothing, BoP 12–15.5 s → whole buff", () => {
    expect(liveLine(hunter(6), bopOn(12, 15.5))).toEqual([
      "0:12  [MISSED PURGE OPPORTUNITY]   Blessing of Protection active on 2(RPaladin) (unpurged for 4s) | purge on cooldown for the whole buff (ready 0:16) — not actionable",
    ]);
  });
  it("(b) a Tranquilizing Shot that removed Blessing of Freedom, same BoP → whole buff", () => {
    expect(contextOf(hunter(6, "1044"), bopOn(12, 15.5))).toContain(
      "purged Blessing of Freedom off 2(RPaladin) (Tranquilizing Shot)",
    );
    expect(liveLine(hunter(6, "1044"), bopOn(12, 15.5))).toEqual([
      "0:12  [MISSED PURGE OPPORTUNITY]   Blessing of Protection active on 2(RPaladin) (unpurged for 4s) | purge on cooldown for the whole buff (ready 0:16) — not actionable",
    ]);
  });
  it("(c) BoP 15–25 s → back at 0:16 with 9 s of the buff left", () => {
    expect(liveLine(hunter(6), bopOn(15, 25))).toEqual([
      "0:15  [MISSED PURGE OPPORTUNITY]   Blessing of Protection active on 2(RPaladin) (unpurged for 10s) | purge on cooldown at application — ready at 0:16 (9s of the buff left)",
    ]);
  });
});
