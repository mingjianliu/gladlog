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
const GROUNDING_TOTEM_SPELL_ID = "204336";
const GROUNDING_TOTEM_NPC_ID = "5925";

function makeUnit(overrides: Partial<ICombatUnit> = {}): ICombatUnit {
  return {
    id: "Player-1",
    name: "ShamanOwner",
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

const defaultTimelineParams = {
  ownerSpec: "Restoration Shaman",
  isHealer: true,
  ownerCDs: [],
  teammateCDs: [],
  enemyCDTimeline: { players: [], alignedBurstWindows: [] },
  ccTrinketSummaries: [],
  enemyCCSummaries: [],
  pressureWindows: [],
  healingGaps: [],
  friendlyDeaths: [],
  enemyDeaths: [],
  criticalWindowSeconds: new Set<number>(),
  outgoingCCChains: [],
  dispelSummary: emptyDispel as any,
  enemyDispelSummary: emptyDispel as any,
  playerIdMap: new Map([["ShamanOwner", 1]]),
  enemyIdMap: new Map([
    ["EnemyMage", 2],
    ["EnemyEvoker", 2],
  ]),
  playerCCTrinketSummaries: [],
  enemyCooldownEvents: [],
  enemyDefensiveEvents: [],
};

describe("Grounding Totem absorb note (W0a)", () => {
  it("does not silently downgrade to generic 'spells from:' when attackSpellName is empty or unknown", () => {
    const owner = makeUnit({
      id: "Player-1",
      name: "ShamanOwner",
      reaction: CombatUnitReaction.Friendly,
      spellCastEvents: [
        {
          spellId: GROUNDING_TOTEM_SPELL_ID,
          spellName: "Grounding Totem",
          timestamp: T0 + 10_000,
          logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 + 10_000 },
        } as any,
      ],
    });

    const enemy = makeUnit({
      id: "Player-2",
      name: "EnemyMage",
      reaction: CombatUnitReaction.Hostile,
      spec: CombatUnitSpec.Mage_Frost,
    });

    const totem = makeUnit({
      id: `Creature-0-0-0-0-${GROUNDING_TOTEM_NPC_ID}-0000000001`,
      name: "Grounding Totem",
      type: CombatUnitType.NPC,
      ownerId: owner.id,
      reaction: CombatUnitReaction.Friendly,
      absorbsIn: [
        {
          timestamp: T0 + 11_000,
          attackerId: enemy.id,
          // Unknown spell id with empty attackSpellName (the exact W0a bug case)
          attackSpellId: "999999",
          attackSpellName: "",
        } as any,
      ],
    });

    const timeline = buildMatchTimeline({
      owner,
      allUnits: [owner, enemy, totem],
      friends: [owner],
      enemies: [enemy],
      matchStartMs: T0,
      matchEndMs: T0 + 60_000,
      ...defaultTimelineParams,
    });

    // Should name the spell rather than silently dropping it to "spells from:"
    expect(timeline).toContain("[ABSORBED: 999999 (2(FMage))]");
    expect(timeline).not.toContain("[ABSORBED spells from: 2(FMage)]");
  });

  it("renders known English spell name when attackSpellId is known", () => {
    const owner = makeUnit({
      id: "Player-1",
      name: "ShamanOwner",
      reaction: CombatUnitReaction.Friendly,
      spellCastEvents: [
        {
          spellId: GROUNDING_TOTEM_SPELL_ID,
          spellName: "Grounding Totem",
          timestamp: T0 + 10_000,
          logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 + 10_000 },
        } as any,
      ],
    });

    const enemy = makeUnit({
      id: "Player-2",
      name: "EnemyEvoker",
      reaction: CombatUnitReaction.Hostile,
      spec: CombatUnitSpec.Evoker_Devastation,
    });

    const totem = makeUnit({
      id: `Creature-0-0-0-0-${GROUNDING_TOTEM_NPC_ID}-0000000002`,
      name: "Grounding Totem",
      type: CombatUnitType.NPC,
      ownerId: owner.id,
      reaction: CombatUnitReaction.Friendly,
      absorbsIn: [
        {
          timestamp: T0 + 11_000,
          attackerId: enemy.id,
          attackSpellId: "361500", // Living Flame
          attackSpellName: "Living Flame",
        } as any,
      ],
    });

    const timeline = buildMatchTimeline({
      owner,
      allUnits: [owner, enemy, totem],
      friends: [owner],
      enemies: [enemy],
      matchStartMs: T0,
      matchEndMs: T0 + 60_000,
      ...defaultTimelineParams,
    });

    expect(timeline).toContain("[ABSORBED: Living Flame (2(DEvoker))]");
  });

  it("falls back to caster-only 'spells from:' on pre-2026-09-20 documents where spell is absent", () => {
    const owner = makeUnit({
      id: "Player-1",
      name: "ShamanOwner",
      reaction: CombatUnitReaction.Friendly,
      spellCastEvents: [
        {
          spellId: GROUNDING_TOTEM_SPELL_ID,
          spellName: "Grounding Totem",
          timestamp: T0 + 10_000,
          logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 + 10_000 },
        } as any,
      ],
    });

    const enemy = makeUnit({
      id: "Player-2",
      name: "EnemyMage",
      reaction: CombatUnitReaction.Hostile,
      spec: CombatUnitSpec.Mage_Frost,
    });

    const totem = makeUnit({
      id: `Creature-0-0-0-0-${GROUNDING_TOTEM_NPC_ID}-0000000003`,
      name: "Grounding Totem",
      type: CombatUnitType.NPC,
      ownerId: owner.id,
      reaction: CombatUnitReaction.Friendly,
      absorbsIn: [
        {
          timestamp: T0 + 11_000,
          attackerId: enemy.id,
          // No attackSpellId or attackSpellName (pre-2026-09-20 format)
        } as any,
      ],
    });

    const timeline = buildMatchTimeline({
      owner,
      allUnits: [owner, enemy, totem],
      friends: [owner],
      enemies: [enemy],
      matchStartMs: T0,
      matchEndMs: T0 + 60_000,
      ...defaultTimelineParams,
    });

    expect(timeline).toContain("[ABSORBED spells from: 2(FMage)]");
  });
});
