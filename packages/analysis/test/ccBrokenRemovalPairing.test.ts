/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The srcUnitId of a BROKEN/BROKEN_SPELL event is the **breaker**, not the
 * caster (proven at the raw log level; found in passing during the 2026-08-02 CC
 * break investigation): matching removals by `${spellId}:${src}` mismatches the
 * key, so a broken CC (17.5% of all hard-CC windows) stays pending until match
 * end → its duration is inflated, and the DR chain (lastExpiredAt) plus the
 * trinket windows are contaminated along with it. The fix = relax removal
 * matching to the earliest pending entry with the same spellId; only
 * apply/refresh filter by caster.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  LogEvent,
} from "@gladlog/parser-compat";

import { analyzePlayerCCAndTrinket } from "../src/utils/ccTrinketAnalysis";
import { analyzeOutgoingCCChains } from "../src/utils/drAnalysis";
import { makeUnit } from "./ported/testHelpers";

const MATCH_START = 1_000_000;
const S = (sec: number) => MATCH_START + sec * 1000;
/** endTime is far beyond the break instant, so any inflation is obvious. */
const COMBAT = {
  startTime: MATCH_START,
  endTime: MATCH_START + 300_000,
  startInfo: { zoneId: "0" },
} as any;

const POLY = "118";

function aura(
  event: LogEvent,
  spellId: string,
  timestamp: number,
  srcUnitId: string,
  srcUnitName: string,
): any {
  const parameters: (string | number)[] = [];
  if (event === LogEvent.SPELL_AURA_BROKEN_SPELL) {
    parameters[11] = "589";
    parameters[12] = "Shadow Word: Pain";
  } else {
    parameters[11] = "DEBUFF";
  }
  return {
    logLine: { event, timestamp, parameters },
    timestamp,
    spellId,
    spellName: spellId,
    srcUnitId,
    srcUnitName,
    destUnitId: "holder",
    destUnitName: "Holder",
    effectiveAmount: 0,
  };
}

describe("BROKEN removal 配对(打破者≠施法者)", () => {
  it("analyzeOutgoingCCChains:被友方 DoT 打破的出手 CC 时长=实际 2s,不虚增到 match end", () => {
    const e1 = makeUnit("e1", {
      spec: CombatUnitSpec.Mage_Frost,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, POLY, S(10), "h1", "OurMage"),
        // The breaker is d1 (a friendly DoT); src ≠ the caster h1
        aura(LogEvent.SPELL_AURA_BROKEN_SPELL, POLY, S(12), "d1", "OurPriest"),
      ],
    });
    (e1 as any).type = CombatUnitType.Player;
    const chains = analyzeOutgoingCCChains(
      [makeUnit("h1"), makeUnit("d1")] as any,
      [e1] as any,
      COMBAT,
    );
    expect(chains).toHaveLength(1);
    expect(chains[0].applications).toHaveLength(1);
    expect(chains[0].applications[0].durationSeconds).toBeCloseTo(2);
  });

  it("analyzePlayerCCAndTrinket:被敌方 DoT 打破的身上 CC 时长=实际 2s,不虚增", () => {
    const player = makeUnit("t1", {
      spec: CombatUnitSpec.Warrior_Arms,
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, POLY, S(10), "e1", "EnemyMage"),
        // The breaker is e2 (an enemy DoT); src ≠ the caster e1
        aura(LogEvent.SPELL_AURA_BROKEN_SPELL, POLY, S(12), "e2", "EnemyLock"),
      ],
    });
    const summary = analyzePlayerCCAndTrinket(
      player as any,
      [makeUnit("e1"), makeUnit("e2")] as any,
      COMBAT,
    );
    expect(summary.ccInstances).toHaveLength(1);
    expect(summary.ccInstances[0].durationSeconds).toBeCloseTo(2);
  });
});
