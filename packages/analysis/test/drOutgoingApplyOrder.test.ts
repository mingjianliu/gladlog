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
