import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  ICombatUnit,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  buildMatchTimeline,
  BuildMatchTimelineParams,
} from "../src/context/matchTimeline";
import {
  DMG_SPIKE_THRESHOLD,
  PEAK_SPIKE_MARKERS,
  peakSpikeMarker,
  peakSpikePlacement,
} from "../src";

function mkUnit(
  id: string,
  name: string,
  reaction: CombatUnitReaction,
  spec: CombatUnitSpec = CombatUnitSpec.Priest_Discipline,
): ICombatUnit {
  return {
    id,
    name,
    ownerId: "",
    isWellFormed: true,
    type: CombatUnitType.Player,
    class: CombatUnitClass.Priest,
    spec,
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

describe("peakSpikePlacement", () => {
  it("classifies the three placements correctly", () => {
    // inside: spike entirely within window
    expect(peakSpikePlacement(30, 10, 25)).toBe("inside");
    expect(peakSpikeMarker("inside")).toBe("");
    expect(PEAK_SPIKE_MARKERS["inside"]).toBe("");

    // runs-past: spike starts inside window but ends after
    expect(peakSpikePlacement(30, 10, 35)).toBe("runs-past");
    expect(peakSpikeMarker("runs-past")).toBe(" (runs past window)");
    expect(PEAK_SPIKE_MARKERS["runs-past"]).toBe(" (runs past window)");

    // after: spike starts at or after window end
    expect(peakSpikePlacement(30, 35, 45)).toBe("after");
    expect(peakSpikeMarker("after")).toBe(" (lands after window)");
    expect(PEAK_SPIKE_MARKERS["after"]).toBe(" (lands after window)");
  });

  it("satisfies boundary equality: spikeFrom == windowTo is 'after', spikeTo == windowTo is 'inside'", () => {
    // spikeFrom == windowTo -> "after"
    expect(peakSpikePlacement(20, 20, 25)).toBe("after");

    // spikeTo == windowTo -> "inside"
    expect(peakSpikePlacement(20, 10, 20)).toBe("inside");
  });

  it("floors bounds to whole seconds on the render grid", () => {
    // windowTo 20.8 -> 20; spikeFrom 20.1 -> 20 (equal -> after)
    expect(peakSpikePlacement(20.8, 20.1, 25.4)).toBe("after");

    // windowTo 20.8 -> 20; spikeTo 20.9 -> 20 (equal -> inside)
    expect(peakSpikePlacement(20.8, 10.3, 20.9)).toBe("inside");

    // windowTo 20.2 -> 20; spikeFrom 19.9 -> 19; spikeTo 21.1 -> 21 (runs-past)
    expect(peakSpikePlacement(20.2, 19.9, 21.1)).toBe("runs-past");
  });

  it("renders [OFFENSIVE WINDOW] line carrying the marker in timeline output", () => {
    const owner = mkUnit("o", "Me-Realm", CombatUnitReaction.Friendly);
    const mate = mkUnit(
      "m",
      "Mate-Realm",
      CombatUnitReaction.Friendly,
      CombatUnitSpec.Shaman_Enhancement,
    );
    const enemy = mkUnit("e", "Enemy-Realm", CombatUnitReaction.Hostile);

    const params: BuildMatchTimelineParams = {
      owner,
      ownerSpec: "Discipline Priest",
      ownerCDs: [],
      teammateCDs: [],
      enemyCDTimeline: {
        players: [],
        alignedBurstWindows: [
          {
            fromSeconds: 75,
            toSeconds: 95,
            activeCDs: [
              {
                playerName: "Enemy-Realm",
                spellId: "107574",
                spellName: "Avatar",
                castSeconds: 75,
              },
            ],
            threatScore: 100,
            threatLabel: "Critical",
          } as any,
        ],
      },
      ccTrinketSummaries: [],
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
      pressureWindows: [
        {
          fromSeconds: 97,
          toSeconds: 107,
          totalDamage: DMG_SPIKE_THRESHOLD + 100_000,
          targetName: mate.name,
          targetSpec: "Enhancement Shaman",
        } as any,
      ],
      healingGaps: [],
      friends: [owner, mate],
      enemies: [enemy],
      matchStartMs: 0,
      matchEndMs: 120_000,
      isHealer: true,
      criticalWindowSeconds: new Set<number>(),
    };

    const timeline = buildMatchTimeline(params);
    const lines = timeline.split("\n");
    const owLine = lines.find(
      (l) => l.includes("[OFFENSIVE WINDOW]") && l.includes("| peak spike"),
    );
    expect(owLine).toBeDefined();
    expect(owLine).toContain("1:15–1:35 | peak spike");
    expect(owLine).toContain(
      "over 1:37–1:47 (lands after window) | CDs: Avatar@1:15",
    );
  });
});
