import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { ICCInstance } from "../utils/ccTrinketAnalysis";
import { buildMatchTimeline, BuildMatchTimelineParams } from "./matchTimeline";

/**
 * Triage 2026-09-29, other F-O14: a channel an incoming CC cut. The cast
 * line fires at the channel's START, so "[cast succeeded before CC landed]"
 * said nothing about a Mana Tea ended by Hammer of Justice after 0.76 s
 * (7f67e778: aura 363.771, stun 364.498, aura removed 364.531).
 */

const MANA_TEA = "115294"; // a channel (channeledGenerated)
const INSTANT_SELF_BUFF = "999001"; // not in the channel table

function mkUnit(id: string, overrides: Partial<ICombatUnit> = {}): ICombatUnit {
  return {
    id,
    name: `${id}-Realm`,
    ownerId: "",
    isWellFormed: true,
    type: CombatUnitType.Player,
    class: CombatUnitClass.Monk,
    spec: CombatUnitSpec.Monk_Mistweaver,
    reaction: CombatUnitReaction.Friendly,
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
    ...overrides,
  };
}

const cast = (spellId: string, spellName: string, ms: number) => ({
  spellId,
  spellName,
  timestamp: ms,
  srcUnitId: "o",
  srcUnitName: "o-Realm",
  destUnitId: "0000000000000000",
  destUnitName: "nil",
  logLine: {
    event: LogEvent.SPELL_CAST_SUCCESS,
    timestamp: ms,
    parameters: [],
  },
});
const aura = (spellId: string, event: LogEvent, ms: number) => ({
  spellId,
  spellName: "x",
  timestamp: ms,
  srcUnitId: "o",
  srcUnitName: "o-Realm",
  destUnitId: "o",
  destUnitName: "o-Realm",
  auraType: "BUFF" as const,
  logLine: { event, timestamp: ms, parameters: [] },
});
const stun = (atSeconds: number): ICCInstance => ({
  atSeconds,
  durationSeconds: 4,
  spellId: "853",
  spellName: "Hammer of Justice",
  sourceName: "e-Realm",
  sourceId: "e",
  sourceSpec: "Holy Paladin",
  damageTakenDuring: 0,
  trinketState: "on_cooldown",
  drInfo: { category: "Stun", level: "Full", sequenceIndex: 0 },
  distanceYards: null,
  losBlocked: null,
});

function castLine(opts: {
  spellId: string;
  spellName: string;
  auraRemovedMs: number;
  stunAtS: number;
  /** a REMOVED + APPLIED pair of the same aura in this one millisecond */
  rebroadcastAtMs?: number;
}): string | undefined {
  const owner = mkUnit("o", {
    spellCastEvents: [cast(opts.spellId, opts.spellName, 30_000)] as never,
    auraEvents: [
      aura(opts.spellId, LogEvent.SPELL_AURA_APPLIED, 30_000),
      ...(opts.rebroadcastAtMs !== undefined
        ? [
            aura(
              opts.spellId,
              LogEvent.SPELL_AURA_REMOVED,
              opts.rebroadcastAtMs,
            ),
            aura(
              opts.spellId,
              LogEvent.SPELL_AURA_APPLIED,
              opts.rebroadcastAtMs,
            ),
          ]
        : []),
      aura(opts.spellId, LogEvent.SPELL_AURA_REMOVED, opts.auraRemovedMs),
    ] as never,
  });
  const enemy = mkUnit("e", { reaction: CombatUnitReaction.Hostile });
  const params: BuildMatchTimelineParams = {
    owner,
    ownerSpec: "Monk_Mistweaver",
    ownerCDs: [],
    teammateCDs: [],
    enemyCDTimeline: { players: [], alignedBurstWindows: [] },
    ccTrinketSummaries: [
      {
        playerName: owner.name,
        playerSpec: "Mistweaver Monk",
        trinketType: "Gladiator",
        trinketCooldownSeconds: 90,
        ccInstances: [stun(opts.stunAtS)],
        trinketUseTimes: [],
        missedTrinketWindows: [],
        rootInstances: [],
        disarmInstances: [],
        interruptInstances: [],
        ccAvoidedInstances: [],
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
    friends: [owner],
    enemies: [enemy],
    matchStartMs: 0,
    matchEndMs: 120_000,
    isHealer: true,
    criticalWindowSeconds: new Set<number>(),
  };
  return buildMatchTimeline(params)
    .split("\n")
    .find((l) => l.includes("[YOU] [CAST]") && l.includes(opts.spellName));
}

describe("[YOU] [CAST]: a channel cut by an incoming CC", () => {
  it("says the channel was cut and after how long, instead of the ordering note", () => {
    const line = castLine({
      spellId: MANA_TEA,
      spellName: "Mana Tea",
      auraRemovedMs: 30_760,
      stunAtS: 30.727,
    });
    expect(line).toContain("Mana Tea [channel cut by CC after 0.8s]");
    expect(line).not.toContain("cast succeeded before CC landed");
  });

  it("a channel whose aura ran on past the CC keeps the ordering note", () => {
    const line = castLine({
      spellId: MANA_TEA,
      spellName: "Mana Tea",
      auraRemovedMs: 33_000,
      stunAtS: 30.727,
    });
    expect(line).toContain("[cast succeeded before CC landed]");
    expect(line).not.toContain("channel cut");
  });

  it("an instant self-buff that drops right after a CC is not a cut channel", () => {
    const line = castLine({
      spellId: INSTANT_SELF_BUFF,
      spellName: "Instant Self Buff",
      auraRemovedMs: 30_760,
      stunAtS: 30.727,
    });
    expect(line).toContain("[cast succeeded before CC landed]");
    expect(line).not.toContain("channel cut");
  });

  it("a channel cut by a CC that landed more than 1 s into it is still named", () => {
    const line = castLine({
      spellId: MANA_TEA,
      spellName: "Mana Tea",
      auraRemovedMs: 32_530,
      stunAtS: 32.5,
    });
    expect(line).toContain("Mana Tea [channel cut by CC after 2.5s]");
  });

  it("an aura re-broadcast mid-channel is not the channel's end (agy review 2026-10-01)", () => {
    const line = castLine({
      spellId: MANA_TEA,
      spellName: "Mana Tea",
      rebroadcastAtMs: 30_200,
      auraRemovedMs: 30_760,
      stunAtS: 30.727,
    });
    expect(line).toContain("Mana Tea [channel cut by CC after 0.8s]");
  });
});
