/**
 * codex 20-F25b-05 #2: the `[CC AVOIDED?] … logged IMMUNE (DR: Cat Immune)`
 * cause rebuilt the holder's DR history from the summary without the walk's
 * own length evidence (`drFullSeconds`), so a stun that ran half its length
 * inside the reset tick band read as a reset and the Immune cause was lost.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  type ICombatUnit,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { buildMatchTimeline } from "../src/context/matchTimeline";
import { ensureAnalysisData } from "../src/data/ensure";
import type { IPlayerCCTrinketSummary } from "../src/utils/ccTrinketAnalysis";
import {
  DR_RESET_CUTOVER_EPOCH_MS,
  DR_RESET_MS_121,
} from "../src/utils/drAnalysis";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = DR_RESET_CUTOVER_EPOCH_MS + 86_400_000;

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

function immuneLine(hojFullSeconds: number | undefined): string {
  const owner = unit("P1", "Owner");
  const enemy = unit("E1", "EnemyRogue", {
    reaction: CombatUnitReaction.Hostile,
    spec: CombatUnitSpec.Rogue_Subtlety,
  });
  const hojAt = 4 + DR_RESET_MS_121 / 1000 + 0.1;
  const stun = (
    atSeconds: number,
    durationSeconds: number,
    spellId: string,
  ) => ({
    atSeconds,
    durationSeconds,
    spellId,
    drInfo: { category: "Stun", level: "Full", sequenceIndex: 0 },
  });
  const summary = {
    playerName: "Owner",
    playerSpec: "Restoration Shaman",
    trinketType: "Gladiator",
    trinketCooldownSeconds: 120,
    ccInstances: [],
    drHistoryOnly: [
      stun(0, 4, "1833"),
      {
        ...stun(hojAt, 2.5, "853"),
        ...(hojFullSeconds === undefined
          ? {}
          : { drFullSeconds: hojFullSeconds }),
      },
    ],
    trinketUseTimes: [],
    missedTrinketWindows: [],
    rootInstances: [],
    disarmInstances: [],
    interruptInstances: [],
    ccAvoidedInstances: [],
    ccImmuneUncredited: [
      {
        atSeconds: hojAt + 3.5,
        castAtSeconds: hojAt + 3.5,
        spellId: "1833",
        spellName: "Cheap Shot",
        sourceName: "EnemyRogue",
        sourceId: "E1",
        missMs: T0 + (hojAt + 3.5) * 1000,
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
    enemyIdMap: new Map([["EnemyRogue", 4]]),
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

describe("[CC AVOIDED?] DR cause reads the walk's length evidence", () => {
  it("a stun that ran half its length in the band was the chain's second: the next one is Immune", () => {
    expect(immuneLine(5)).toContain("(DR: Stun Immune)");
  });
  it("with no length evidence the band resets: no Immune cause", () => {
    const line = immuneLine(undefined);
    expect(line).toContain("logged IMMUNE");
    expect(line).not.toContain("DR: Stun Immune");
  });
});
