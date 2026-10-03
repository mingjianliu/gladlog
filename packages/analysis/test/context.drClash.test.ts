import {
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  ICombatUnit,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  buildMatchTimeline,
  DR_CLASH_LEGEND,
} from "../src/context/matchTimeline";
import { IOutgoingCCChain } from "../src/utils/drAnalysis";

const T0 = 1_000_000;

function makeUnit(overrides: Partial<ICombatUnit> = {}): ICombatUnit {
  return {
    id: "Player-1",
    name: "OwnerPlayer",
    type: CombatUnitType.Player,
    spec: CombatUnitSpec.Rogue_Subtlety,
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

describe("buildMatchTimeline — [DR CLASH] context lines (GH #67 S3)", () => {
  it("emits [DR CLASH] and legend when a teammate lands diminished CC after the owner's CC", () => {
    const owner = makeUnit({ id: "P1", name: "OwnerPlayer" });
    const teammate = makeUnit({
      id: "P2",
      name: "HunterTeammate",
      spec: CombatUnitSpec.Hunter_Survival,
    });
    const enemy = makeUnit({
      id: "E1",
      name: "EnemyHealer",
      reaction: CombatUnitReaction.Hostile,
      spec: CombatUnitSpec.Shaman_Restoration,
    });

    const outgoingCCChains: IOutgoingCCChain[] = [
      {
        targetName: "EnemyHealer",
        targetSpec: "Restoration Shaman",
        applications: [
          {
            atSeconds: 10,
            durationSeconds: 4,
            spellId: "1776",
            spellName: "Gouge",
            casterName: "OwnerPlayer",
            casterSpec: "Subtlety Rogue",
            drInfo: { category: "Incapacitate", level: "Full", sequenceIndex: 0 },
          },
          {
            atSeconds: 20,
            durationSeconds: 3,
            spellId: "3355",
            spellName: "Freezing Trap",
            casterName: "HunterTeammate",
            casterSpec: "Survival Hunter",
            drInfo: { category: "Incapacitate", level: "50%", sequenceIndex: 1 },
          },
        ],
      },
    ];

    const timeline = buildMatchTimeline({
      owner,
      ownerSpec: "Subtlety Rogue",
      friends: [owner, teammate],
      enemies: [enemy],
      allUnits: [owner, teammate, enemy],
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
      outgoingCCChains,
    });

    expect(timeline).toContain("[DR CLASH]");
    expect(timeline).toContain(
      "HunterTeammate's Freezing Trap on EnemyHealer landed at 50% DR (Incapacitate) — your Gouge 10s earlier put them on DR",
    );
    // Legend included conditionally
    expect(timeline).toContain(DR_CLASH_LEGEND[0]);
  });

  it("omits [DR CLASH] and legend when no teammate DR clash occurred", () => {
    const owner = makeUnit({ id: "P1", name: "OwnerPlayer" });
    const teammate = makeUnit({ id: "P2", name: "HunterTeammate" });
    const enemy = makeUnit({ id: "E1", name: "EnemyHealer", reaction: CombatUnitReaction.Hostile });

    const timeline = buildMatchTimeline({
      owner,
      ownerSpec: "Subtlety Rogue",
      friends: [owner, teammate],
      enemies: [enemy],
      allUnits: [owner, teammate, enemy],
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

    expect(timeline).not.toContain("[DR CLASH]");
    expect(timeline).not.toContain(DR_CLASH_LEGEND[0]);
  });
});

describe("[DR CLASH] cap keeps the owner's clashes first (triage cc-dr F-DC1)", () => {
  it("an owner clash later than three teammate clashes still renders", () => {
    const owner = makeUnit({ id: "P1", name: "OwnerPlayer" });
    const mate = makeUnit({ id: "P2", name: "MateA" });
    const mate2 = makeUnit({ id: "P3", name: "MateB" });
    const app = (atSeconds: number, casterName: string, level: string) => ({
      atSeconds,
      durationSeconds: 3,
      spellId: "1776",
      spellName: "Gouge",
      casterName,
      casterSpec: "Subtlety Rogue",
      drInfo: { category: "Incapacitate", level, sequenceIndex: 0 },
    });
    const chain = (target: string, t: number, second: string) => ({
      targetName: target,
      targetSpec: "Restoration Shaman",
      applications: [app(t, "MateA", "Full"), app(t + 4, second, "50%")],
    });
    const enemies = ["E1", "E2", "E3", "E4"].map((n) =>
      makeUnit({ id: n, name: n, reaction: CombatUnitReaction.Hostile }),
    );
    const timeline = buildMatchTimeline({
      owner,
      ownerSpec: "Subtlety Rogue",
      friends: [owner, mate, mate2],
      enemies,
      allUnits: [owner, mate, mate2, ...enemies],
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
      outgoingCCChains: [
        chain("E1", 10, "MateB"),
        chain("E2", 20, "MateB"),
        chain("E3", 30, "MateB"),
        chain("E4", 40, "OwnerPlayer"),
      ] as IOutgoingCCChain[],
    });
    const clashLines = timeline
      .split("\n")
      .filter((l) => l.includes("[DR CLASH]   "));
    expect(clashLines).toHaveLength(3);
    expect(clashLines.some((l) => l.includes("your Gouge on"))).toBe(true);
    // rendered in time order
    const times = clashLines.map((l) => l.trim().slice(0, 4));
    expect([...times].sort()).toEqual(times);
  });
});
