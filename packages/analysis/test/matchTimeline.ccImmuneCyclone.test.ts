/**
 * weekly review 2026-10-24: the uncredited `[CC AVOIDED?] … logged IMMUNE`
 * line named `(a Cyclone was on them)` off its own copy of the Cyclone walk,
 * without the lost-REMOVED cap the `[CC NOT LANDED]` note has (codex
 * 60-POSTHOC-05a #1: a 0:10 Cyclone blamed for a 0:44 IMMUNE). Both now read
 * `damageImmuneControlUpAt`.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { buildMatchTimeline } from "../src/context/matchTimeline";
import { IPlayerCCTrinketSummary } from "../src/utils/ccTrinketAnalysis";
import { makeAuraEvent } from "./ported/testHelpers";

const T0 = 1_000_000;

function unit(
  id: string,
  name: string,
  over: Partial<ICombatUnit> = {},
): ICombatUnit {
  return {
    id,
    name,
    type: CombatUnitType.Player,
    spec: CombatUnitSpec.Shaman_Restoration,
    reaction: CombatUnitReaction.Friendly,
    spellCastEvents: [],
    auraEvents: [],
    damageIn: [],
    damageOut: [],
    healIn: [],
    healOut: [],
    absorbsIn: [],
    absorbsOut: [],
    missesIn: [],
    missesOut: [],
    advancedActions: [],
    ...over,
  } as ICombatUnit;
}

const emptyDispel = {
  allyCleanse: [],
  ourPurges: [],
  hostilePurges: [],
  missedCleanseWindows: [],
  missedPurgeWindows: [],
};

function immuneLine(missAtS: number, cycloneRemovedAtS?: number): string {
  const cyclone = [
    makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      "33786",
      T0 + 10_000,
      "E1",
      "P1",
    ),
    ...(cycloneRemovedAtS === undefined
      ? []
      : [
          makeAuraEvent(
            LogEvent.SPELL_AURA_REMOVED,
            "33786",
            T0 + cycloneRemovedAtS * 1000,
            "E1",
            "P1",
          ),
        ]),
  ];
  const owner = unit("P1", "Owner", { auraEvents: cyclone as never });
  const enemy = unit("E1", "EnemyDruid", {
    reaction: CombatUnitReaction.Hostile,
    spec: CombatUnitSpec.Druid_Balance,
  });
  const summary = {
    playerName: "Owner",
    playerSpec: "Restoration Shaman",
    trinketType: "Gladiator",
    trinketCooldownSeconds: 120,
    ccInstances: [],
    trinketUseTimes: [],
    missedTrinketWindows: [],
    rootInstances: [],
    disarmInstances: [],
    interruptInstances: [],
    ccAvoidedInstances: [],
    ccImmuneUncredited: [
      {
        atSeconds: missAtS,
        castAtSeconds: missAtS,
        spellId: "118",
        spellName: "Polymorph",
        sourceName: "EnemyDruid",
        sourceId: "E1",
        missMs: T0 + missAtS * 1000,
      },
    ],
  } as unknown as IPlayerCCTrinketSummary;
  const text = buildMatchTimeline({
    owner,
    ownerSpec: "Restoration Shaman",
    friends: [owner],
    enemies: [enemy],
    allUnits: [owner, enemy],
    playerIdMap: new Map([["Owner", 1]]),
    enemyIdMap: new Map([["EnemyDruid", 4]]),
    matchStartMs: T0,
    matchEndMs: T0 + 60_000,
    isHealer: true,
    ownerCDs: [],
    teammateCDs: [],
    enemyCDTimeline: { players: [], alignedBurstWindows: [] },
    ccTrinketSummaries: [summary],
    enemyCCSummaries: [],
    dispelSummary: emptyDispel as never,
    enemyDispelSummary: emptyDispel as never,
    pressureWindows: [],
    healingGaps: [],
    friendlyDeaths: [],
    enemyDeaths: [],
    criticalWindowSeconds: new Set(),
    outgoingCCChains: [],
  } as never);
  return text.split("\n").find((l) => l.includes("logged IMMUNE")) ?? "";
}

describe("[CC AVOIDED?] logged IMMUNE: the Cyclone cause reads the shared, capped walk", () => {
  it("a Cyclone up at the miss is named", () => {
    expect(immuneLine(12)).toContain("logged IMMUNE (a Cyclone was on them)");
  });
  it("a Cyclone whose REMOVED the log lost is over at its full length", () => {
    const line = immuneLine(44);
    expect(line).toContain("logged IMMUNE");
    expect(line).not.toContain("Cyclone was on them");
  });
  it("a logged REMOVED closes it", () => {
    expect(immuneLine(13, 12)).not.toContain("Cyclone was on them");
  });
});
