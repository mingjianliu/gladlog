/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { buildMatchTimeline } from "../src/context/matchTimeline";
import { ensureAnalysisData } from "../src/data/ensure";
import { makeUnit } from "./ported/testHelpers";

const START = 1_000_000;
const ms = (s: number) => START + s * 1000;

function aura(
  spellId: string,
  name: string,
  src: string,
  dest: string,
  atS: number,
  event: LogEvent,
): any {
  return {
    spellId,
    spellName: name,
    srcUnitId: src,
    srcUnitName: src,
    destUnitId: dest,
    destUnitName: dest,
    timestamp: ms(atS),
    logLine: { event, timestamp: ms(atS), parameters: [] },
    auraType: "BUFF",
  };
}

describe("GH #99 item 3 — timeline deduplication / event folding", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  const emptyDispel = {
    allyCleanse: [],
    ourPurges: [],
    hostilePurges: [],
    missedCleanseWindows: [],
    missedPurgeWindows: [],
  };

  it("Rule A (owner): AoE CC folds full target list into [YOU] [CC], dropping [CC CAST]", () => {
    const owner = makeUnit("PlayerYou", {
      spec: CombatUnitSpec.Priest_Holy,
      reaction: CombatUnitReaction.Friendly,
    });
    const enemy1 = makeUnit("Enemy1", {
      spec: CombatUnitSpec.Warrior_Arms,
      reaction: CombatUnitReaction.Hostile,
    });
    const enemy2 = makeUnit("Enemy2", {
      spec: CombatUnitSpec.Druid_Balance,
      reaction: CombatUnitReaction.Hostile,
    });

    const timeline = buildMatchTimeline({
      owner,
      ownerSpec: "Holy Priest",
      ownerCDs: [
        {
          spellId: "8122",
          spellName: "Psychic Scream",
          casts: [{ timeSeconds: 10, targetName: "Enemy1" }],
          tag: "CrowdControl",
          cooldownSeconds: 45,
        } as any,
      ],
      teammateCDs: [],
      enemyCDTimeline: { players: [], alignedBurstWindows: [] } as any,
      ccTrinketSummaries: [],
      dispelSummary: emptyDispel as any,
      enemyDispelSummary: emptyDispel as any,
      enemyCCSummaries: [],
      friendlyDeaths: [],
      enemyDeaths: [],
      pressureWindows: [],
      healingGaps: [],
      friends: [owner],
      enemies: [enemy1, enemy2],
      allUnits: [owner, enemy1, enemy2],
      matchStartMs: START,
      matchEndMs: ms(60),
      isHealer: true,
      playerIdMap: new Map([["PlayerYou", 1]]),
      enemyIdMap: new Map([
        ["Enemy1", 3],
        ["Enemy2", 4],
      ]),
      criticalWindowSeconds: new Set(),
      outgoingCCChains: [
        {
          targetName: "Enemy1",
          targetSpec: "Arms Warrior",
          totalCCDuration: 8,
          fullDRDuration: 8,
          applications: [
            {
              casterName: "PlayerYou",
              spellId: "8122",
              spellName: "Psychic Scream",
              atSeconds: 10,
              durationSeconds: 8,
              drInfo: {
                category: "Disorient",
                level: "Full",
                sequenceIndex: 0,
              },
            },
          ],
        },
        {
          targetName: "Enemy2",
          targetSpec: "Balance Druid",
          totalCCDuration: 8,
          fullDRDuration: 8,
          applications: [
            {
              casterName: "PlayerYou",
              spellId: "8122",
              spellName: "Psychic Scream",
              atSeconds: 10,
              durationSeconds: 8,
              drInfo: {
                category: "Disorient",
                level: "Full",
                sequenceIndex: 0,
              },
            },
          ],
        },
      ] as any,
    });

    expect(timeline).toContain(
      "[YOU] [CC]   Psychic Scream → 3(AWarrior), 4(BDruid) [2 enemies]",
    );
    expect(timeline).not.toContain("[CC CAST]");
  });

  it("Rule A (teammate): AoE CC folds full target list into [TEAM] [CC], dropping [CC CAST]", () => {
    const owner = makeUnit("PlayerYou", {
      spec: CombatUnitSpec.Priest_Holy,
      reaction: CombatUnitReaction.Friendly,
    });
    const teammate = makeUnit("Teammate", {
      spec: CombatUnitSpec.Warrior_Arms,
      reaction: CombatUnitReaction.Friendly,
    });
    const enemy1 = makeUnit("Enemy1", {
      spec: CombatUnitSpec.Shaman_Elemental,
      reaction: CombatUnitReaction.Hostile,
    });
    const enemy2 = makeUnit("Enemy2", {
      spec: CombatUnitSpec.Druid_Balance,
      reaction: CombatUnitReaction.Hostile,
    });

    const timeline = buildMatchTimeline({
      owner,
      ownerSpec: "Holy Priest",
      ownerCDs: [],
      teammateCDs: [
        {
          player: teammate,
          spec: "Arms Warrior",
          cds: [
            {
              spellId: "5246",
              spellName: "Intimidating Shout",
              casts: [{ timeSeconds: 33, targetName: "Enemy1" }],
              tag: "CrowdControl",
              cooldownSeconds: 90,
            },
          ],
        } as any,
      ],
      enemyCDTimeline: { players: [], alignedBurstWindows: [] } as any,
      ccTrinketSummaries: [],
      dispelSummary: emptyDispel as any,
      enemyDispelSummary: emptyDispel as any,
      enemyCCSummaries: [],
      friendlyDeaths: [],
      enemyDeaths: [],
      pressureWindows: [],
      healingGaps: [],
      friends: [owner, teammate],
      enemies: [enemy1, enemy2],
      allUnits: [owner, teammate, enemy1, enemy2],
      matchStartMs: START,
      matchEndMs: ms(60),
      isHealer: true,
      playerIdMap: new Map([
        ["PlayerYou", 1],
        ["Teammate", 2],
      ]),
      enemyIdMap: new Map([
        ["Enemy1", 5],
        ["Enemy2", 4],
      ]),
      criticalWindowSeconds: new Set(),
      outgoingCCChains: [
        {
          targetName: "Enemy1",
          targetSpec: "Elemental Shaman",
          totalCCDuration: 7,
          fullDRDuration: 8,
          applications: [
            {
              casterName: "Teammate",
              spellId: "5246",
              spellName: "Intimidating Shout",
              atSeconds: 33,
              durationSeconds: 7,
            },
          ],
        },
        {
          targetName: "Enemy2",
          targetSpec: "Balance Druid",
          totalCCDuration: 1,
          fullDRDuration: 8,
          applications: [
            {
              casterName: "Teammate",
              spellId: "5246",
              spellName: "Intimidating Shout",
              atSeconds: 33,
              durationSeconds: 1,
            },
          ],
        },
      ] as any,
    });

    expect(timeline).toContain(
      "0:33  [TEAM] [CC]   2(AWarrior) (Arms Warrior) cast Intimidating Shout → 5(EShaman), 4(BDruid) [2 enemies]",
    );
    expect(timeline).not.toContain("[CC CAST]");
  });

  it("Rule A (primary first): the cast target stays first even when the AoE landing list lacks it (immune / missed)", () => {
    const owner = makeUnit("PlayerYou", {
      spec: CombatUnitSpec.Priest_Holy,
      reaction: CombatUnitReaction.Friendly,
    });
    const teammate = makeUnit("Teammate", {
      spec: CombatUnitSpec.Warrior_Arms,
      reaction: CombatUnitReaction.Friendly,
    });
    const enemy1 = makeUnit("Enemy1", {
      spec: CombatUnitSpec.Shaman_Elemental,
      reaction: CombatUnitReaction.Hostile,
    });
    const enemy2 = makeUnit("Enemy2", {
      spec: CombatUnitSpec.Druid_Balance,
      reaction: CombatUnitReaction.Hostile,
    });
    const enemy3 = makeUnit("Enemy3", {
      spec: CombatUnitSpec.Warrior_Fury,
      reaction: CombatUnitReaction.Hostile,
    });
    const shout = (target: string, durationSeconds: number) => ({
      targetName: target,
      targetSpec: "x",
      totalCCDuration: durationSeconds,
      fullDRDuration: 8,
      applications: [
        {
          casterName: "Teammate",
          spellId: "5246",
          spellName: "Intimidating Shout",
          atSeconds: 33,
          durationSeconds,
        },
      ],
    });
    const timeline = buildMatchTimeline({
      owner,
      ownerSpec: "Holy Priest",
      ownerCDs: [],
      teammateCDs: [
        {
          player: teammate,
          spec: "Arms Warrior",
          cds: [
            {
              spellId: "5246",
              spellName: "Intimidating Shout",
              // Cast on Enemy3, who never appears in the landing list (immune / missed).
              casts: [{ timeSeconds: 33, targetName: "Enemy3" }],
              tag: "CrowdControl",
              cooldownSeconds: 90,
            },
          ],
        } as any,
      ],
      enemyCDTimeline: { players: [], alignedBurstWindows: [] } as any,
      ccTrinketSummaries: [],
      dispelSummary: emptyDispel as any,
      enemyDispelSummary: emptyDispel as any,
      enemyCCSummaries: [],
      friendlyDeaths: [],
      enemyDeaths: [],
      pressureWindows: [],
      healingGaps: [],
      friends: [owner, teammate],
      enemies: [enemy1, enemy2, enemy3],
      allUnits: [owner, teammate, enemy1, enemy2, enemy3],
      matchStartMs: START,
      matchEndMs: ms(60),
      isHealer: true,
      playerIdMap: new Map([
        ["PlayerYou", 1],
        ["Teammate", 2],
      ]),
      enemyIdMap: new Map([
        ["Enemy1", 5],
        ["Enemy2", 4],
        ["Enemy3", 6],
      ]),
      criticalWindowSeconds: new Set(),
      outgoingCCChains: [shout("Enemy1", 7), shout("Enemy2", 1)] as any,
    });
    expect(timeline).toContain(
      "0:33  [TEAM] [CC]   2(AWarrior) (Arms Warrior) cast Intimidating Shout → 6(FWarrior), 5(EShaman), 4(BDruid) [3 enemies]",
    );
    expect(timeline).not.toContain("[CC CAST]");
  });

  it("Rule A (no-match): [CC CAST] is emitted unchanged when no matching cast line exists", () => {
    const owner = makeUnit("PlayerYou", {
      spec: CombatUnitSpec.Priest_Holy,
      reaction: CombatUnitReaction.Friendly,
    });
    const enemy1 = makeUnit("Enemy1", {
      spec: CombatUnitSpec.Warrior_Arms,
      reaction: CombatUnitReaction.Hostile,
    });

    const timeline = buildMatchTimeline({
      owner,
      ownerSpec: "Holy Priest",
      ownerCDs: [],
      teammateCDs: [],
      enemyCDTimeline: { players: [], alignedBurstWindows: [] } as any,
      ccTrinketSummaries: [],
      dispelSummary: emptyDispel as any,
      enemyDispelSummary: emptyDispel as any,
      enemyCCSummaries: [],
      friendlyDeaths: [],
      enemyDeaths: [],
      pressureWindows: [],
      healingGaps: [],
      friends: [owner],
      enemies: [enemy1],
      allUnits: [owner, enemy1],
      matchStartMs: START,
      matchEndMs: ms(60),
      isHealer: true,
      playerIdMap: new Map([["PlayerYou", 1]]),
      enemyIdMap: new Map([["Enemy1", 5]]),
      criticalWindowSeconds: new Set(),
      outgoingCCChains: [
        {
          targetName: "Enemy1",
          targetSpec: "Arms Warrior",
          totalCCDuration: 4,
          fullDRDuration: 4,
          applications: [
            {
              casterName: "UnknownTeammate",
              spellId: "207685",
              spellName: "Sigil of Misery",
              atSeconds: 20,
              durationSeconds: 4,
            },
          ],
        },
      ] as any,
    });

    expect(timeline).toContain(
      "0:20  [CC CAST]   Sigil of Misery (by UnknownTeammate) → 5(AWarrior)",
    );
  });

  it("Rule B: self-buff folds into [ENEMY CD] with (purgeable), dropping [ENEMY BUFF] start line", () => {
    const owner = makeUnit("PlayerYou", {
      spec: CombatUnitSpec.Shaman_Restoration,
      reaction: CombatUnitReaction.Friendly,
    });
    const enemyPriest = makeUnit("EnemyPriest", {
      spec: CombatUnitSpec.Priest_Discipline,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        aura(
          "10060",
          "Power Infusion",
          "EnemyPriest",
          "EnemyPriest",
          28,
          LogEvent.SPELL_AURA_APPLIED,
        ),
        aura(
          "10060",
          "Power Infusion",
          "EnemyPriest",
          "EnemyPriest",
          43,
          LogEvent.SPELL_AURA_REMOVED,
        ),
      ],
    });

    const timeline = buildMatchTimeline({
      owner,
      ownerSpec: "Restoration Shaman",
      ownerCDs: [],
      teammateCDs: [],
      enemyCDTimeline: {
        players: [
          {
            playerName: "EnemyPriest",
            specName: "Discipline Priest",
            offensiveCDs: [
              {
                spellId: "10060",
                spellName: "Power Infusion",
                castTimeSeconds: 28,
                cooldownSeconds: 120,
                availableAgainAtSeconds: 148,
                buffEndSeconds: 43,
              },
            ],
          },
        ],
        alignedBurstWindows: [],
      } as any,
      ccTrinketSummaries: [],
      dispelSummary: emptyDispel as any,
      enemyDispelSummary: emptyDispel as any,
      enemyCCSummaries: [],
      friendlyDeaths: [],
      enemyDeaths: [],
      pressureWindows: [],
      healingGaps: [],
      friends: [owner],
      enemies: [enemyPriest],
      allUnits: [owner, enemyPriest],
      matchStartMs: START,
      matchEndMs: ms(60),
      isHealer: true,
      playerIdMap: new Map([["PlayerYou", 1]]),
      enemyIdMap: new Map([["EnemyPriest", 4]]),
      criticalWindowSeconds: new Set(),
    });

    expect(timeline).toContain(
      "0:28  [ENEMY CD]   4(DPriest) (Discipline Priest): Power Infusion (purgeable)",
    );
    expect(timeline).not.toContain("0:28  [ENEMY BUFF]");
    expect(timeline).toContain(
      "0:43  [ENEMY BUFF END]   4(DPriest): Power Infusion",
    );
  });

  it("Rule B (recipient-differs): buff on ally keeps both [ENEMY CD] on caster and [ENEMY BUFF] on recipient", () => {
    const owner = makeUnit("PlayerYou", {
      spec: CombatUnitSpec.Shaman_Restoration,
      reaction: CombatUnitReaction.Friendly,
    });
    const enemyPriest = makeUnit("EnemyPriest", {
      spec: CombatUnitSpec.Priest_Discipline,
      reaction: CombatUnitReaction.Hostile,
    });
    const enemyMage = makeUnit("EnemyMage", {
      spec: CombatUnitSpec.Mage_Frost,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        aura(
          "10060",
          "Power Infusion",
          "EnemyPriest",
          "EnemyMage",
          28,
          LogEvent.SPELL_AURA_APPLIED,
        ),
        aura(
          "10060",
          "Power Infusion",
          "EnemyPriest",
          "EnemyMage",
          43,
          LogEvent.SPELL_AURA_REMOVED,
        ),
      ],
    });

    const timeline = buildMatchTimeline({
      owner,
      ownerSpec: "Restoration Shaman",
      ownerCDs: [],
      teammateCDs: [],
      enemyCDTimeline: {
        players: [
          {
            playerName: "EnemyPriest",
            specName: "Discipline Priest",
            offensiveCDs: [
              {
                spellId: "10060",
                spellName: "Power Infusion",
                castTimeSeconds: 28,
                cooldownSeconds: 120,
                availableAgainAtSeconds: 148,
                buffEndSeconds: 43,
              },
            ],
          },
        ],
        alignedBurstWindows: [],
      } as any,
      ccTrinketSummaries: [],
      dispelSummary: emptyDispel as any,
      enemyDispelSummary: emptyDispel as any,
      enemyCCSummaries: [],
      friendlyDeaths: [],
      enemyDeaths: [],
      pressureWindows: [],
      healingGaps: [],
      friends: [owner],
      enemies: [enemyPriest, enemyMage],
      allUnits: [owner, enemyPriest, enemyMage],
      matchStartMs: START,
      matchEndMs: ms(60),
      isHealer: true,
      playerIdMap: new Map([["PlayerYou", 1]]),
      enemyIdMap: new Map([
        ["EnemyPriest", 4],
        ["EnemyMage", 5],
      ]),
      criticalWindowSeconds: new Set(),
    });

    expect(timeline).toContain(
      "0:28  [ENEMY CD]   4(DPriest) (Discipline Priest): Power Infusion",
    );
    expect(timeline).toContain(
      "0:28  [ENEMY BUFF]   5(FMage): Power Infusion (purgeable)",
    );
    expect(timeline).toContain(
      "0:43  [ENEMY BUFF END]   5(FMage): Power Infusion",
    );
  });

  it("Rule C: [MISSED PURGE OPPORTUNITY] folds into [ENEMY BUFF] line, preserving exemption text", () => {
    const owner = makeUnit("PlayerYou", {
      spec: CombatUnitSpec.Shaman_Restoration,
      reaction: CombatUnitReaction.Friendly,
    });
    const enemyMage = makeUnit("EnemyMage", {
      spec: CombatUnitSpec.Mage_Frost,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        aura(
          "10060",
          "Power Infusion",
          "EnemyPriest",
          "EnemyMage",
          28,
          LogEvent.SPELL_AURA_APPLIED,
        ),
        aura(
          "10060",
          "Power Infusion",
          "EnemyPriest",
          "EnemyMage",
          43,
          LogEvent.SPELL_AURA_REMOVED,
        ),
      ],
    });

    const timeline = buildMatchTimeline({
      owner,
      ownerSpec: "Restoration Shaman",
      ownerCDs: [],
      teammateCDs: [],
      enemyCDTimeline: { players: [], alignedBurstWindows: [] } as any,
      ccTrinketSummaries: [],
      dispelSummary: {
        ...emptyDispel,
        missedPurgeWindows: [
          {
            timeSeconds: 28,
            durationSeconds: 15,
            enemyName: "EnemyMage",
            enemySpec: "Frost Mage",
            spellName: "Power Infusion",
            spellId: "10060",
            priority: "Critical",
            purgeWasOnCD: false,
            teamUnderPressure: false,
            losReachable: false,
          },
        ],
      } as any,
      enemyDispelSummary: emptyDispel as any,
      enemyCCSummaries: [],
      friendlyDeaths: [],
      enemyDeaths: [],
      pressureWindows: [],
      healingGaps: [],
      friends: [owner],
      enemies: [enemyMage],
      allUnits: [owner, enemyMage],
      matchStartMs: START,
      matchEndMs: ms(60),
      isHealer: true,
      playerIdMap: new Map([["PlayerYou", 1]]),
      enemyIdMap: new Map([["EnemyMage", 5]]),
      criticalWindowSeconds: new Set(),
    });

    expect(timeline).toContain(
      "0:28  [ENEMY BUFF]   5(FMage): Power Infusion (purgeable; unpurged for 15s; no purger had range/line of sight — not actionable)",
    );
    expect(timeline).not.toContain("[MISSED PURGE OPPORTUNITY]");
  });

  it("Rule B + C chain: self-buff folds BUFF into CD (B), then purge annotation goes onto CD line (C)", () => {
    const owner = makeUnit("PlayerYou", {
      spec: CombatUnitSpec.Shaman_Restoration,
      reaction: CombatUnitReaction.Friendly,
    });
    const enemyPriest = makeUnit("EnemyPriest", {
      spec: CombatUnitSpec.Priest_Discipline,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        aura(
          "10060",
          "Power Infusion",
          "EnemyPriest",
          "EnemyPriest",
          28,
          LogEvent.SPELL_AURA_APPLIED,
        ),
        aura(
          "10060",
          "Power Infusion",
          "EnemyPriest",
          "EnemyPriest",
          43,
          LogEvent.SPELL_AURA_REMOVED,
        ),
      ],
    });

    const timeline = buildMatchTimeline({
      owner,
      ownerSpec: "Restoration Shaman",
      ownerCDs: [],
      teammateCDs: [],
      enemyCDTimeline: {
        players: [
          {
            playerName: "EnemyPriest",
            specName: "Discipline Priest",
            offensiveCDs: [
              {
                spellId: "10060",
                spellName: "Power Infusion",
                castTimeSeconds: 28,
                cooldownSeconds: 120,
                availableAgainAtSeconds: 148,
                buffEndSeconds: 43,
              },
            ],
          },
        ],
        alignedBurstWindows: [],
      } as any,
      ccTrinketSummaries: [],
      dispelSummary: {
        ...emptyDispel,
        missedPurgeWindows: [
          {
            timeSeconds: 28,
            durationSeconds: 15,
            enemyName: "EnemyPriest",
            enemySpec: "Discipline Priest",
            spellName: "Power Infusion",
            spellId: "10060",
            priority: "Critical",
            purgeWasOnCD: false,
            teamUnderPressure: false,
            losReachable: false,
          },
        ],
      } as any,
      enemyDispelSummary: emptyDispel as any,
      enemyCCSummaries: [],
      friendlyDeaths: [],
      enemyDeaths: [],
      pressureWindows: [],
      healingGaps: [],
      friends: [owner],
      enemies: [enemyPriest],
      allUnits: [owner, enemyPriest],
      matchStartMs: START,
      matchEndMs: ms(60),
      isHealer: true,
      playerIdMap: new Map([["PlayerYou", 1]]),
      enemyIdMap: new Map([["EnemyPriest", 4]]),
      criticalWindowSeconds: new Set(),
    });

    expect(timeline).toContain(
      "0:28  [ENEMY CD]   4(DPriest) (Discipline Priest): Power Infusion (purgeable; unpurged for 15s; no purger had range/line of sight — not actionable)",
    );
    expect(timeline).not.toContain("0:28  [ENEMY BUFF]");
    expect(timeline).not.toContain("[MISSED PURGE OPPORTUNITY]");
    expect(timeline).toContain(
      "0:43  [ENEMY BUFF END]   4(DPriest): Power Infusion",
    );
  });
});
