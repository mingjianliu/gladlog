import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  ICombatUnit,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { buildMatchTimeline, BuildMatchTimelineParams } from "./matchTimeline";

/**
 * GH #99: a summon-cast CC must be credited to the unit that actually cast it.
 *
 * Both teams field same-named summons — with a shaman on each side the unit
 * table holds two units called "Capacitor Totem" — and `actorLabel` used to
 * resolve the owner by matching that NAME, so `find` returned whichever one
 * came first. Measured on the 2026-09-15 Opus baseline: 48 lines in 16 of 309
 * prompts credited the wrong side, including `3(EShaman) ← Capacitor Totem (by
 * 3(EShaman)'s pet)` — a teammate rendered as stunning his own team. The line
 * now resolves `ICCInstance.sourceId` (the event's own source GUID); the name
 * path survives only as the fallback for documents that carry no id.
 */

const MATCH_START_MS = 0;
const MATCH_END_MS = 120_000;

function mkUnit(
  id: string,
  name: string,
  reaction: CombatUnitReaction,
  ownerId = "",
): ICombatUnit {
  return {
    id,
    name,
    ownerId,
    isWellFormed: true,
    type: ownerId ? CombatUnitType.Pet : CombatUnitType.Player,
    class: CombatUnitClass.Shaman,
    spec: CombatUnitSpec.Shaman_Restoration,
    reaction,
    damageIn: [],
    damageOut: [],
    healIn: [],
    healOut: [],
    absorbsIn: [],
    absorbsOut: [],
    auraEvents: [],
    spellCastEvents: [],
    castStartEvents: [],
    petSpellCastEvents: [],
    actionIn: [],
    actionOut: [],
    deathRecords: [],
    advancedActions: [],
  };
}

const owner = mkUnit("o", "Me-Realm", CombatUnitReaction.Friendly);
const mate = mkUnit("m", "Mate-Realm", CombatUnitReaction.Friendly);
const enemy = mkUnit("e", "Enemy-Realm", CombatUnitReaction.Hostile);
/** The collision: one totem per side, identical name, different GUIDs. */
const friendlyTotem = mkUnit(
  "totem-friendly",
  "Capacitor Totem",
  CombatUnitReaction.Friendly,
  "m",
);
const enemyTotem = mkUnit(
  "totem-enemy",
  "Capacitor Totem",
  CombatUnitReaction.Hostile,
  "e",
);

function paramsWith(sourceId: string): BuildMatchTimelineParams {
  return {
    owner,
    ownerSpec: "Shaman_Restoration",
    ownerCDs: [],
    teammateCDs: [],
    enemyCDTimeline: { players: [], alignedBurstWindows: [] },
    ccTrinketSummaries: [
      {
        playerName: owner.name,
        playerSpec: "Shaman_Restoration",
        trinketType: "Unknown",
        trinketCooldownSeconds: 120,
        trinketUseTimes: [],
        missedTrinketWindows: [],
        rootInstances: [],
        disarmInstances: [],
        interruptInstances: [],
        ccAvoidedInstances: [],
        ccInstances: [
          {
            atSeconds: 30,
            durationSeconds: 3,
            spellId: "118345",
            spellName: "Capacitor Totem",
            sourceName: "Capacitor Totem",
            sourceId,
            sourceSpec: "Shaman_Restoration",
            damageTakenDuring: 0,
            trinketState: "available_unused",
            drInfo: null,
            distanceYards: null,
            losBlocked: null,
          },
        ],
      },
    ],
    dispelSummary: {
      allyCleanse: [],
      ourPurges: [],
      hostilePurges: [],
      missedCleanseWindows: [],
      lateCleanseWindows: [],
      ccEfficiency: [],
      missedPurgeWindows: [],
    },
    friendlyDeaths: [],
    enemyDeaths: [],
    pressureWindows: [],
    healingGaps: [],
    friends: [owner, mate],
    enemies: [enemy],
    // The friendly totem deliberately comes FIRST: a name lookup returns it,
    // which is exactly the bug this pins.
    allUnits: [owner, mate, enemy, friendlyTotem, enemyTotem],
    matchStartMs: MATCH_START_MS,
    matchEndMs: MATCH_END_MS,
    isHealer: true,
    criticalWindowSeconds: new Set<number>(),
  };
}

const ccOnTeamLine = (p: BuildMatchTimelineParams) =>
  buildMatchTimeline(p)
    .split("\n")
    .find((l) => l.includes("[CC ON TEAM]"));

describe("[CC ON TEAM] summon attribution (GH #99)", () => {
  it("credits the enemy totem that owns the source GUID, not the same-named friendly one", () => {
    const line = ccOnTeamLine(paramsWith(enemyTotem.id));
    expect(line).toBeDefined();
    expect(line).toContain("(by Enemy's pet)");
    expect(line).not.toContain("Mate's pet");
  });

  it("falls back to the same-side name match when the document carries no source id", () => {
    // An archived document with no `sourceId`: the CC landed on our team, so
    // only an enemy-owned totem may be credited — never the friendly one that
    // the old name lookup returned first.
    const line = ccOnTeamLine(paramsWith(""));
    expect(line).toBeDefined();
    expect(line).toContain("(by Enemy's pet)");
    expect(line).not.toContain("Mate's pet");
  });
});
