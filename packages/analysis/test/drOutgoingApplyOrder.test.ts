/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Reliability audit B3iv (2026-09-25): outgoing DR levels follow APPLY order.
 * 825ca842 on the enemy Resto Shaman: Fear 51.24→55.77 (Warlock), Blind
 * 51.35→53.85 (Rogue), both Disorient. Assigned at removal time the Blind
 * closed first and read Full, the Fear then read 50 % — inverted — and the
 * Blind [DR CLASH] was never shown.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  LogEvent,
} from "@gladlog/parser-compat";

import { analyzeOutgoingCCChains } from "../src/utils/drAnalysis";
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
  effectiveAmount: 0,
});

describe("outgoing DR in apply order (B3iv)", () => {
  it("Fear then Blind (removed first): Fear Full, Blind 50 %", () => {
    const sham = makeUnit("sham", {
      spec: CombatUnitSpec.Shaman_Restoration,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "118699", 51.24, "lock"), // Fear
        aura(LogEvent.SPELL_AURA_APPLIED, "2094", 51.35, "rogue"), // Blind
        aura(LogEvent.SPELL_AURA_REMOVED, "2094", 53.85, "rogue"),
        aura(LogEvent.SPELL_AURA_REMOVED, "118699", 55.77, "lock"),
      ],
    });
    (sham as any).type = CombatUnitType.Player;
    const apps = analyzeOutgoingCCChains(
      [makeUnit("lock"), makeUnit("rogue")] as any,
      [sham] as any,
      COMBAT,
    )[0]!.applications;
    expect(apps.map((a) => [a.spellId, a.drInfo.level])).toEqual([
      ["118699", "Full"],
      ["2094", "50%"],
    ]);
  });
});

describe("outgoing CC cut at a Solo Shuffle round's end says so (F19 605 gate)", () => {
  it("a control still on at the ending death is cut there and flagged; one removed on that ms is not", () => {
    const sham = makeUnit("sham", {
      spec: CombatUnitSpec.Shaman_Restoration,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "118699", 55, "lock"), // Fear
        aura(LogEvent.SPELL_AURA_REMOVED, "118699", 64, "lock"),
        aura(LogEvent.SPELL_AURA_APPLIED, "2094", 70, "rogue"), // Blind, after
      ],
    });
    (sham as any).type = CombatUnitType.Player;
    const dying = { info: {}, deathRecords: [{ timestamp: S(60) }] };
    const shuffle = {
      ...COMBAT,
      startInfo: { zoneId: "0", bracket: "Rated Solo Shuffle" },
      units: { sham, dying },
    } as any;
    const apps = analyzeOutgoingCCChains(
      [makeUnit("lock"), makeUnit("rogue")] as any,
      [sham] as any,
      shuffle,
    )[0]!.applications;
    expect(apps).toHaveLength(1); // the Blind after the round is in none
    expect(apps[0]).toMatchObject({
      spellId: "118699",
      durationSeconds: 5,
      cutByRoundEnd: true,
    });
    // HAS TEETH: removed on the round-ending ms itself — it ended
    const endedThen = makeUnit("sham", {
      spec: CombatUnitSpec.Shaman_Restoration,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "118699", 55, "lock"),
        aura(LogEvent.SPELL_AURA_REMOVED, "118699", 60, "lock"),
      ],
    });
    (endedThen as any).type = CombatUnitType.Player;
    const [app] = analyzeOutgoingCCChains(
      [makeUnit("lock")] as any,
      [endedThen] as any,
      { ...shuffle, units: { sham: endedThen, dying } },
    )[0]!.applications;
    expect(app!.durationSeconds).toBe(5);
    expect(app!.cutByRoundEnd).toBeUndefined();
  });
});

describe("an unclosed outgoing CC the log's end caps is cut there (codex 20-F19-05)", () => {
  it("no REMOVED, its official end past the match end: flagged, as its [CC ON ENEMY] line reads it", () => {
    const sham = makeUnit("sham", {
      spec: CombatUnitSpec.Shaman_Restoration,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [aura(LogEvent.SPELL_AURA_APPLIED, "118699", 297, "lock")],
    });
    (sham as any).type = CombatUnitType.Player;
    const [app] = analyzeOutgoingCCChains(
      [makeUnit("lock")] as any,
      [sham] as any,
      { ...COMBAT, units: { sham } } as any,
    )[0]!.applications;
    expect(app!.durationSeconds).toBe(3);
    expect(app!.cutByRoundEnd).toBe(true);
  });
});

describe("an unclosed outgoing CC with no length read closes at the timeline's cap (codex 20-F19-06)", () => {
  it("Kidney Shot with no combo points read: capped at its full length, not run to the log's end, and not cut by the round's end", () => {
    const sham = makeUnit("sham", {
      spec: CombatUnitSpec.Shaman_Restoration,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [aura(LogEvent.SPELL_AURA_APPLIED, "408", 10, "rogue")],
    });
    (sham as any).type = CombatUnitType.Player;
    const [app] = analyzeOutgoingCCChains(
      [makeUnit("rogue")] as any,
      [sham] as any,
      { ...COMBAT, units: { sham } } as any,
    )[0]!.applications;
    expect(app!.durationSeconds).toBeLessThan(30);
    expect(app!.cutByRoundEnd).toBeUndefined();
  });
});
