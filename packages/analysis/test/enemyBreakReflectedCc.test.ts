/**
 * An enemy break racial ending the enemy's own control sent back onto it
 * (fix-F16 corpusFactScan trinketOutOf, 173-1 2:34: a Retribution Paladin's
 * Hammer of Justice reflected by Spell Reflection, Will to Survive in its
 * REMOVED's ms) names it on the `[ENEMY TRINKET]` line, as the Medallion's
 * line already did.
 */
import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { buildMatchTimeline } from "../src/context/matchTimeline";
import { makeUnit } from "./ported/testHelpers";

const HOJ = "853";
const POLY = "118";
const WILL_TO_SURVIVE = "59752";
const selfAura = (event: LogEvent, spellId: string, ms: number) =>
  ({
    logLine: { event, timestamp: ms, parameters: [] },
    timestamp: ms,
    spellId,
    srcUnitId: "e",
    srcUnitName: "Enemy",
    destUnitId: "e",
    destUnitName: "Enemy",
  }) as any;

function trinketLine(controlId: string) {
  const owner = makeUnit("o", { name: "Me" });
  const mate = makeUnit("m", { name: "Mate" });
  const enemy = makeUnit("e", {
    name: "Enemy",
    reaction: CombatUnitReaction.Hostile,
    auraEvents: [
      selfAura(LogEvent.SPELL_AURA_APPLIED, controlId, 10_000),
      selfAura(LogEvent.SPELL_AURA_REMOVED, controlId, 12_000),
    ],
  });
  const emptyDispels = {
    allyCleanse: [],
    ourPurges: [],
    hostilePurges: [],
    missedCleanseWindows: [],
    missedPurgeWindows: [],
  } as any;
  return buildMatchTimeline({
    owner,
    ownerSpec: "Fury Warrior",
    ownerCDs: [],
    teammateCDs: [],
    enemyCDTimeline: { players: [], alignedBurstWindows: [] } as any,
    ccTrinketSummaries: [],
    enemyCCSummaries: [
      {
        playerName: "Enemy",
        trinketUseTimes: [],
        trinketCooldownSeconds: 120,
        ccInstances: [],
        breakAbilityUses: [
          {
            atSeconds: 12,
            spellId: WILL_TO_SURVIVE,
            name: "Will to Survive",
            sharesTrinketLock: true,
          },
        ],
      },
    ] as never,
    dispelSummary: emptyDispels,
    enemyDispelSummary: emptyDispels,
    friendlyDeaths: [],
    enemyDeaths: [],
    pressureWindows: [],
    healingGaps: [],
    friends: [owner, mate],
    enemies: [enemy],
    allUnits: [owner, mate, enemy],
    matchStartMs: 0,
    matchEndMs: 60_000,
    isHealer: false,
    outgoingCCChains: [],
    criticalWindowSeconds: new Set<number>(),
  } as any)
    .split("\n")
    .find((l) => /^\d+:\d\d {2}\[ENEMY TRINKET\]/.test(l));
}

describe("[ENEMY TRINKET] — a break racial out of a reflected control", () => {
  it("Will to Survive in the reflected Hammer of Justice's REMOVED ms names it", () => {
    expect(trinketLine(HOJ)).toMatch(
      /used Will to Survive out of Hammer of Justice \(reflected back\)/,
    );
  });
  it("a control the racial does not remove (a Polymorph) is not named", () => {
    const line = trinketLine(POLY);
    expect(line).toMatch(/used Will to Survive/);
    expect(line).not.toMatch(/out of/);
  });
});
