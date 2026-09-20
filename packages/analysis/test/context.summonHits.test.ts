import {
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { buildMatchTimeline } from "../src/context/matchTimeline";

const T0 = 1_000_000;

function makeUnit(overrides: Partial<ICombatUnit> = {}): ICombatUnit {
  return {
    id: "Player-1",
    name: "OwnerPlayer",
    type: CombatUnitType.Player,
    spec: CombatUnitSpec.Hunter_Marksmanship,
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
    ownerId: "",
    ...overrides,
  } as ICombatUnit;
}

const emptyDispel = {
  allyCleanse: [],
  ourPurges: [],
  hostilePurges: [],
  missedCleanseWindows: [],
  missedPurgeWindows: [],
};

describe("buildMatchTimeline — [ENEMY SUMMON] hitters resolution (W0c)", () => {
  it("attributes friendly pet hits directly to the owner and avoids leaking pet names", () => {
    const owner = makeUnit({ id: "P1", name: "HunterOwner" });
    const pet = makeUnit({
      id: "Pet-1",
      name: "FluffyDog",
      type: CombatUnitType.Pet,
      ownerId: "P1",
    });
    const enemySummoner = makeUnit({
      id: "E1",
      name: "EnemyPriest",
      reaction: CombatUnitReaction.Hostile,
      spec: CombatUnitSpec.Priest_Shadow,
    });
    // Psyfiend NPC 101398
    const psyfiend = makeUnit({
      id: "Creature-0-1-1-1-101398-0001",
      name: "Psyfiend",
      reaction: CombatUnitReaction.Hostile,
      ownerId: "E1",
      actionIn: [
        {
          spellId: "199824",
          logLine: {
            event: LogEvent.SPELL_SUMMON,
            timestamp: T0 + 10_000,
            parameters: [],
          },
        } as any,
      ],
      damageIn: [
        // Hunter hit
        {
          srcUnitId: "P1",
          srcUnitFlags: 0x511, // friendly
          srcUnitName: "HunterOwner",
          effectiveAmount: 100,
          amount: 100,
          logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: T0 + 11_000 },
        } as any,
        // Pet hit
        {
          srcUnitId: "Pet-1",
          srcUnitFlags: 0x1111, // friendly pet
          srcUnitName: "FluffyDog",
          effectiveAmount: 50,
          amount: 50,
          logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: T0 + 12_000 },
        } as any,
      ],
    });

    const timeline = buildMatchTimeline({
      owner,
      ownerSpec: "Marksmanship Hunter",
      friends: [owner],
      enemies: [enemySummoner],
      allUnits: [owner, pet, enemySummoner, psyfiend],
      playerIdMap: new Map([["HunterOwner", 0]]),
      enemyIdMap: new Map([["EnemyPriest", 1]]),
      matchStartMs: T0,
      matchEndMs: T0 + 60_000,
      isHealer: false,
      ownerCDs: [],
      teammateCDs: [],
      enemyCDTimeline: { players: [], alignedBurstWindows: [] },
      ccTrinketSummaries: [],
      dispelSummary: emptyDispel as any,
      enemyDispelSummary: emptyDispel as any,
      pressureWindows: [],
      healingGaps: [],
      friendlyDeaths: [],
      enemyDeaths: [],
      criticalWindowSeconds: new Set(),
      outgoingCCChains: [],
    });

    expect(timeline).toContain("[ENEMY SUMMON]   Psyfiend");
    // Hunter and pet hits should be merged to the owner's pid, not "HunterOwner, HunterOwner's pet" or "FluffyDog"
    expect(timeline).toContain("hit 2× by 0(MHunter)");
    expect(timeline).not.toContain("FluffyDog");
    expect(timeline).not.toContain("pet");
  });

  it("labels unresolvable pet/guardian hitters as [pet]", () => {
    const owner = makeUnit({ id: "P1", name: "HunterOwner" });
    const enemySummoner = makeUnit({
      id: "E1",
      name: "EnemyPriest",
      reaction: CombatUnitReaction.Hostile,
      spec: CombatUnitSpec.Priest_Shadow,
    });
    // Psyfiend NPC 101398
    const psyfiend = makeUnit({
      id: "Creature-0-1-1-1-101398-0001",
      name: "Psyfiend",
      reaction: CombatUnitReaction.Hostile,
      ownerId: "E1",
      actionIn: [
        {
          spellId: "199824",
          logLine: {
            event: LogEvent.SPELL_SUMMON,
            timestamp: T0 + 10_000,
            parameters: [],
          },
        } as any,
      ],
      damageIn: [
        // Unknown friendly guardian/summon hit with ASCII name
        {
          srcUnitId: "Unknown-Pet-99",
          srcUnitFlags: 0x511, // friendly
          srcUnitName: "Treant",
          effectiveAmount: 50,
          amount: 50,
          logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: T0 + 12_000 },
        } as any,
      ],
    });

    const timeline = buildMatchTimeline({
      owner,
      ownerSpec: "Marksmanship Hunter",
      friends: [owner],
      enemies: [enemySummoner],
      allUnits: [owner, enemySummoner, psyfiend],
      matchStartMs: T0,
      matchEndMs: T0 + 60_000,
      isHealer: false,
      ownerCDs: [],
      teammateCDs: [],
      enemyCDTimeline: { players: [], alignedBurstWindows: [] },
      ccTrinketSummaries: [],
      dispelSummary: emptyDispel as any,
      enemyDispelSummary: emptyDispel as any,
      pressureWindows: [],
      healingGaps: [],
      friendlyDeaths: [],
      enemyDeaths: [],
      criticalWindowSeconds: new Set(),
      outgoingCCChains: [],
    });

    expect(timeline).toContain("[ENEMY SUMMON]   Psyfiend");
    expect(timeline).toContain("hit 1× by [pet]");
    expect(timeline).not.toContain("Treant");
  });
});
