import { CombatUnitSpec } from "@gladlog/parser-compat";
import { buildMatchTimeline } from "../src/context/matchTimeline";
import { makeUnit } from "./ported/testHelpers";

describe("buildMatchTimeline spec tag behavior", () => {
  it("asserts spec tags are attached, abbreviated correctly, and omitted if not found", () => {
    const owner = makeUnit("PlayerYou", { spec: CombatUnitSpec.Priest_Holy });
    const alice = makeUnit("Alice", {
      spec: CombatUnitSpec.Hunter_BeastMastery,
    });
    const bob = makeUnit("Bob", { spec: CombatUnitSpec.None });
    const charlie = makeUnit("Charlie", { spec: CombatUnitSpec.Mage_Fire });
    const enemyUnit = makeUnit("Enemy1", {
      spec: CombatUnitSpec.DemonHunter_Havoc,
    });

    const friends = [owner, alice, bob];
    const enemies = [enemyUnit];

    const playerIdMap = new Map<string, number>([
      ["PlayerYou", 0],
      ["Alice", 1],
      ["Bob", 2],
      ["Charlie", 3],
    ]);
    const enemyIdMap = new Map<string, number>([["Enemy1", 4]]);

    const teammateCDs = [
      {
        player: alice,
        spec: "Beast Mastery Hunter",
        cds: [
          {
            spellId: "19574",
            spellName: "Bestial Wrath",
            casts: [{ timeSeconds: 10 }],
          },
        ] as any,
      },
      {
        player: bob,
        spec: "Unknown",
        cds: [
          {
            spellId: "19574",
            spellName: "Bestial Wrath",
            casts: [{ timeSeconds: 20 }],
          },
        ] as any,
      },
      {
        player: charlie,
        spec: "Fire Mage",
        cds: [
          {
            spellId: "19574",
            spellName: "Bestial Wrath",
            casts: [{ timeSeconds: 30 }],
          },
        ] as any,
      },
    ];

    const timelineText = buildMatchTimeline({
      owner,
      ownerSpec: "Holy Priest",
      ownerCDs: [],
      teammateCDs,
      enemyCDTimeline: { players: [], alignedBurstWindows: [] } as any,
      ccTrinketSummaries: [],
      dispelSummary: {
        allyCleanse: [],
        ourPurges: [],
        hostilePurges: [],
        missedCleanseWindows: [],
        missedPurgeWindows: [],
      } as any,
      enemyDispelSummary: {
        allyCleanse: [],
        ourPurges: [],
        hostilePurges: [],
        missedCleanseWindows: [],
        missedPurgeWindows: [],
      } as any,
      enemyCCSummaries: [],
      friendlyDeaths: [],
      enemyDeaths: [],
      pressureWindows: [],
      healingGaps: [],
      friends,
      enemies,
      allUnits: [owner, alice, bob, charlie, enemyUnit],
      matchStartMs: 1000000,
      matchEndMs: 1060000,
      isHealer: true,
      playerIdMap,
      enemyIdMap,
      outgoingCCChains: [],
      criticalWindowSeconds: new Set<number>(),
    });

    // Assert (a): Spec tags are attached and multi-word spec names are abbreviated
    // 'Beast Mastery Hunter' (CombatUnitSpec.Hunter_BeastMastery) -> (BMHunter)
    expect(timelineText).toContain("1(BMHunter)");

    // Assert (b): Single-word spec names are not abbreviated
    // 'None' (CombatUnitSpec.None) maps to 'Unknown' -> (Unknown)
    expect(timelineText).toContain("2(Unknown)");

    // Assert (c): Unmapped or not-found specs (e.g. not in friends/enemies) don't have tags
    // charlie is in teammateCDs and has playerIdMap entry 3, but is not in friends/enemies.
    // So its tag will be empty, outputting "3" without "(FMage)".
    expect(timelineText).toContain("3 ");
    expect(timelineText).not.toContain("3(");
  });
});
