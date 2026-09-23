/**
 * GH #103 A6: `[CC AVOIDED?] … <aura> active` names who provided the avoidance
 * aura. The responder wrote "your Grounding Totem was up" for a totem the other
 * shaman dropped (match bef98ca1, 2:41 — the owner's Grounding casts were 2:05
 * and 2:55, DB2 duration 3 s).
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  ICombatUnit,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { buildMatchTimeline } from "../src/context/matchTimeline";
import { IPlayerCCTrinketSummary } from "../src/utils/ccTrinketAnalysis";

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

function timelineWith(avoidanceSourceName: string | undefined): string {
  const owner = unit("P1", "Owner");
  const mate = unit("P2", "Mate", { spec: CombatUnitSpec.Shaman_Enhancement });
  const enemy = unit("E1", "EnemyDruid", {
    reaction: CombatUnitReaction.Hostile,
    spec: CombatUnitSpec.Druid_Balance,
  });
  const summary: IPlayerCCTrinketSummary = {
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
    ccAvoidedInstances: [
      {
        atSeconds: 41,
        spellId: "33786",
        spellName: "Cyclone",
        avoidanceSpellName: "Grounding Totem",
        avoidanceSpellId: "8178",
        avoidanceSourceName,
        sourceName: "EnemyDruid",
        sourceId: "E1",
        sourceSpec: "Balance Druid",
      },
    ],
  } as IPlayerCCTrinketSummary;
  return buildMatchTimeline({
    owner,
    ownerSpec: "Restoration Shaman",
    friends: [owner, mate],
    enemies: [enemy],
    allUnits: [owner, mate, enemy],
    playerIdMap: new Map([
      ["Owner", 1],
      ["Mate", 3],
    ]),
    enemyIdMap: new Map([["EnemyDruid", 4]]),
    matchStartMs: T0,
    matchEndMs: T0 + 60_000,
    isHealer: true,
    ownerCDs: [],
    teammateCDs: [],
    enemyCDTimeline: { players: [], alignedBurstWindows: [] },
    ccTrinketSummaries: [summary],
    enemyCCSummaries: [],
    dispelSummary: emptyDispel as any,
    enemyDispelSummary: emptyDispel as any,
    pressureWindows: [],
    healingGaps: [],
    friendlyDeaths: [],
    enemyDeaths: [],
    criticalWindowSeconds: new Set(),
    outgoingCCChains: [],
  } as any);
}

describe("[CC AVOIDED?] names the avoidance aura's provider (GH #103 A6)", () => {
  it("a teammate's totem reads (from <pid>)", () => {
    const line = timelineWith("Mate")
      .split("\n")
      .find((l) => l.includes("[CC AVOIDED?]"));
    expect(line).toContain("Grounding Totem (from 3");
    expect(line).toContain(") active");
  });

  it("the player's own aura reads (own)", () => {
    expect(timelineWith("Owner")).toContain("Grounding Totem (own) active");
  });

  it("an unknown provider leaves the line as before", () => {
    expect(timelineWith(undefined)).toContain(
      "did not land; Grounding Totem active",
    );
  });
});
