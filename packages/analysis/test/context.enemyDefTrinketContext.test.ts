import {
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { buildMatchTimeline } from "../src/context/matchTimeline";
import { TIMELINE_LINE_FLAGS } from "../src/data/timelineLineFlags";
import {
  ICCInstance,
  IPlayerCCTrinketSummary,
} from "../src/utils/ccTrinketAnalysis";

const T0 = 1_000_000;

function makeUnit(overrides: Partial<ICombatUnit> = {}): ICombatUnit {
  return {
    id: "P1",
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

function hpTick(unitId: string, atSec: number, pct: number) {
  return {
    advancedActorId: unitId,
    logLine: {
      timestamp: T0 + atSec * 1000,
    },
    advancedActorCurrentHp: pct,
    advancedActorMaxHp: 100,
  } as any;
}

const emptyDispel = {
  allyCleanse: [],
  ourPurges: [],
  hostilePurges: [],
  missedCleanseWindows: [],
  missedPurgeWindows: [],
};

function makeCCInstance(overrides: Partial<ICCInstance> = {}): ICCInstance {
  return {
    atSeconds: 40,
    durationSeconds: 6,
    spellId: "408",
    spellName: "Kidney Shot",
    sourceName: "OwnerPlayer",
    sourceId: "P1",
    sourceSpec: "Subtlety Rogue",
    damageTakenDuring: 50_000,
    trinketState: "used",
    distanceYards: null,
    losBlocked: null,
    drInfo: null,
    ...overrides,
  } as ICCInstance;
}

function makeCCTrinketSummary(
  overrides: Partial<IPlayerCCTrinketSummary> = {},
): IPlayerCCTrinketSummary {
  return {
    playerName: "EnemyRogue",
    playerSpec: "Subtlety Rogue",
    trinketType: "GladiatorsMedallion",
    trinketCooldownSeconds: 120,
    trinketUseTimes: [],
    ccInstances: [],
    ccAvoidedInstances: [],
    missedTrinketWindows: [],
    totalEnduredCCSeconds: 0,
    ...overrides,
  } as IPlayerCCTrinketSummary;
}

describe("buildMatchTimeline — [ENEMY DEF] and [ENEMY TRINKET] context enrichment (GH #69 / C2)", () => {
  it("1. [ENEMY TRINKET] breaking hard CC with friendly offensive CD active and target HP", () => {
    // Owner with offensive CD active at 42s (Shadow Dance 185313 from 40s to 48s)
    const owner = makeUnit({
      id: "P1",
      name: "OwnerPlayer",
      spec: CombatUnitSpec.Rogue_Subtlety,
      auraEvents: [
        {
          spellId: "185313",
          srcUnitId: "P1",
          timestamp: T0 + 40_000,
          logLine: { event: LogEvent.SPELL_AURA_APPLIED, timestamp: T0 + 40_000 },
        },
        {
          spellId: "185313",
          srcUnitId: "P1",
          timestamp: T0 + 48_000,
          logLine: { event: LogEvent.SPELL_AURA_REMOVED, timestamp: T0 + 48_000 },
        },
      ] as any,
    });

    const enemyRogue = makeUnit({
      id: "E1",
      name: "EnemyRogue",
      reaction: CombatUnitReaction.Hostile,
      spec: CombatUnitSpec.Rogue_Subtlety,
      advancedActions: [hpTick("E1", 42, 31)],
    });

    const enemyCCSummaries: IPlayerCCTrinketSummary[] = [
      makeCCTrinketSummary({
        playerName: "EnemyRogue",
        trinketUseTimes: [42],
        ccInstances: [makeCCInstance()],
      }),
    ];

    const timeline = buildMatchTimeline({
      owner,
      ownerSpec: "Subtlety Rogue",
      friends: [owner],
      enemies: [enemyRogue],
      allUnits: [owner, enemyRogue],
      playerIdMap: new Map([["OwnerPlayer", 1]]),
      enemyIdMap: new Map([["EnemyRogue", 2]]),
      matchStartMs: T0,
      matchEndMs: T0 + 60_000,
      isHealer: false,
      ownerCDs: [],
      teammateCDs: [],
      enemyCDTimeline: { players: [], alignedBurstWindows: [] },
      ccTrinketSummaries: [],
      enemyCCSummaries,
      dispelSummary: emptyDispel as any,
      enemyDispelSummary: emptyDispel as any,
      pressureWindows: [],
      healingGaps: [],
      friendlyDeaths: [],
      enemyDeaths: [],
      criticalWindowSeconds: new Set(),
      outgoingCCChains: [],
    });

    expect(timeline).toContain("[ENEMY TRINKET]");
    expect(timeline).toContain("used PvP trinket out of Kidney Shot (by 1(SRogue))");
    expect(timeline).toContain("[friendly offensive CD active]");
    expect(timeline).toContain("(target at 31% HP)");
    expect(timeline).toMatch(
      /0:42\s+\[ENEMY TRINKET\]\s+2\(SRogue\) used PvP trinket out of Kidney Shot \(by 1\(SRogue\)\) \[friendly offensive CD active\] \(target at 31% HP\)/,
    );
  });

  it("2. [ENEMY TRINKET] with no matching hard CC omits 'out of ...' and does NOT assert 'off-CC'", () => {
    const owner = makeUnit({
      id: "P1",
      name: "OwnerPlayer",
      auraEvents: [
        {
          spellId: "185313",
          srcUnitId: "P1",
          timestamp: T0 + 40_000,
          logLine: { event: LogEvent.SPELL_AURA_APPLIED, timestamp: T0 + 40_000 },
        },
        {
          spellId: "185313",
          srcUnitId: "P1",
          timestamp: T0 + 48_000,
          logLine: { event: LogEvent.SPELL_AURA_REMOVED, timestamp: T0 + 48_000 },
        },
      ] as any,
    });

    const enemyRogue = makeUnit({
      id: "E1",
      name: "EnemyRogue",
      reaction: CombatUnitReaction.Hostile,
      spec: CombatUnitSpec.Rogue_Subtlety,
      advancedActions: [hpTick("E1", 42, 68)],
    });

    const enemyCCSummaries: IPlayerCCTrinketSummary[] = [
      makeCCTrinketSummary({
        playerName: "EnemyRogue",
        trinketUseTimes: [42],
        ccInstances: [], // No matching CC
      }),
    ];

    const timeline = buildMatchTimeline({
      owner,
      ownerSpec: "Subtlety Rogue",
      friends: [owner],
      enemies: [enemyRogue],
      allUnits: [owner, enemyRogue],
      playerIdMap: new Map([["OwnerPlayer", 1]]),
      enemyIdMap: new Map([["EnemyRogue", 2]]),
      matchStartMs: T0,
      matchEndMs: T0 + 60_000,
      isHealer: false,
      ownerCDs: [],
      teammateCDs: [],
      enemyCDTimeline: { players: [], alignedBurstWindows: [] },
      ccTrinketSummaries: [],
      enemyCCSummaries,
      dispelSummary: emptyDispel as any,
      enemyDispelSummary: emptyDispel as any,
      pressureWindows: [],
      healingGaps: [],
      friendlyDeaths: [],
      enemyDeaths: [],
      criticalWindowSeconds: new Set(),
      outgoingCCChains: [],
    });

    const trinketLine = timeline
      .split("\n")
      .find((l) => l.includes("[ENEMY TRINKET]   "))!;
    expect(trinketLine).toBeDefined();
    expect(trinketLine).toContain(
      "used PvP trinket [friendly offensive CD active] (target at 68% HP)",
    );
    expect(trinketLine).not.toContain("out of");
    expect(trinketLine).not.toContain("off-CC");
    expect(trinketLine).toMatch(
      /0:42\s+\[ENEMY TRINKET\]\s+2\(SRogue\) used PvP trinket \[friendly offensive CD active\] \(target at 68% HP\)/,
    );
  });

  it("3. Fractional-second snapping: samples HP and offensive CD at second 42, evaluates CC break at raw ms ±250ms", () => {
    // Friendly offensive CD active only at 42.0s (42000ms), ended at 42.2s (before raw 42.6s = 42600ms)
    const owner = makeUnit({
      id: "P1",
      name: "OwnerPlayer",
      auraEvents: [
        {
          spellId: "185313",
          srcUnitId: "P1",
          timestamp: T0 + 41_000,
          logLine: { event: LogEvent.SPELL_AURA_APPLIED, timestamp: T0 + 41_000 },
        },
        {
          spellId: "185313",
          srcUnitId: "P1",
          timestamp: T0 + 42_200,
          logLine: { event: LogEvent.SPELL_AURA_REMOVED, timestamp: T0 + 42_200 },
        },
      ] as any,
    });

    // HP at second 42 is 50%, HP at second 43 is 10%
    const enemyRogue = makeUnit({
      id: "E1",
      name: "EnemyRogue",
      reaction: CombatUnitReaction.Hostile,
      spec: CombatUnitSpec.Rogue_Subtlety,
      advancedActions: [
        hpTick("E1", 42, 50),
        hpTick("E1", 43, 10),
      ],
    });

    // CC ended at 42.4s (42400ms).
    // Raw trinket cast is at 42.6s (42600ms). 42600 - 42400 = 200ms <= 250ms -> matches CC break!
    const enemyCCSummaries: IPlayerCCTrinketSummary[] = [
      makeCCTrinketSummary({
        playerName: "EnemyRogue",
        trinketUseTimes: [42.6],
        ccInstances: [
          makeCCInstance({
            atSeconds: 38,
            durationSeconds: 4.4, // ends at 42.4s
            damageTakenDuring: 20_000,
          }),
        ],
      }),
    ];

    const timeline = buildMatchTimeline({
      owner,
      ownerSpec: "Subtlety Rogue",
      friends: [owner],
      enemies: [enemyRogue],
      allUnits: [owner, enemyRogue],
      playerIdMap: new Map([["OwnerPlayer", 1]]),
      enemyIdMap: new Map([["EnemyRogue", 2]]),
      matchStartMs: T0,
      matchEndMs: T0 + 60_000,
      isHealer: false,
      ownerCDs: [],
      teammateCDs: [],
      enemyCDTimeline: { players: [], alignedBurstWindows: [] },
      ccTrinketSummaries: [],
      enemyCCSummaries,
      dispelSummary: emptyDispel as any,
      enemyDispelSummary: emptyDispel as any,
      pressureWindows: [],
      healingGaps: [],
      friendlyDeaths: [],
      enemyDeaths: [],
      criticalWindowSeconds: new Set(),
      outgoingCCChains: [],
    });

    // Snapped to 0:42
    expect(timeline).toContain("0:42  [ENEMY TRINKET]");
    expect(timeline).toContain("out of Kidney Shot");
    expect(timeline).toContain("[friendly offensive CD active]");
    expect(timeline).toContain("(target at 50% HP)");
  });

  it("4. Overlapping CCs broken by trinket: selects the longest duration CC (B111)", () => {
    const owner = makeUnit({ id: "P1", name: "OwnerPlayer" });
    const enemyRogue = makeUnit({
      id: "E1",
      name: "EnemyRogue",
      reaction: CombatUnitReaction.Hostile,
      spec: CombatUnitSpec.Rogue_Subtlety,
    });

    // Both Cheap Shot (4s) and Kidney Shot (6s) active at 42s
    const enemyCCSummaries: IPlayerCCTrinketSummary[] = [
      makeCCTrinketSummary({
        playerName: "EnemyRogue",
        trinketUseTimes: [42],
        ccInstances: [
          makeCCInstance({
            atSeconds: 40,
            durationSeconds: 4, // Cheap Shot 4s (ends 44s)
            spellId: "1833",
            spellName: "Cheap Shot",
            damageTakenDuring: 10_000,
          }),
          makeCCInstance({
            atSeconds: 40,
            durationSeconds: 6, // Kidney Shot 6s (ends 46s)
            spellId: "408",
            spellName: "Kidney Shot",
            damageTakenDuring: 10_000,
          }),
        ],
      }),
    ];

    const timeline = buildMatchTimeline({
      owner,
      ownerSpec: "Subtlety Rogue",
      friends: [owner],
      enemies: [enemyRogue],
      allUnits: [owner, enemyRogue],
      playerIdMap: new Map([["OwnerPlayer", 1]]),
      enemyIdMap: new Map([["EnemyRogue", 2]]),
      matchStartMs: T0,
      matchEndMs: T0 + 60_000,
      isHealer: false,
      ownerCDs: [],
      teammateCDs: [],
      enemyCDTimeline: { players: [], alignedBurstWindows: [] },
      ccTrinketSummaries: [],
      enemyCCSummaries,
      dispelSummary: emptyDispel as any,
      enemyDispelSummary: emptyDispel as any,
      pressureWindows: [],
      healingGaps: [],
      friendlyDeaths: [],
      enemyDeaths: [],
      criticalWindowSeconds: new Set(),
      outgoingCCChains: [],
    });

    expect(timeline).toContain("out of Kidney Shot");
    expect(timeline).not.toContain("out of Cheap Shot");
  });

  it("5. [ENEMY DEF] self/immune: formats immune and displays friendly burst and target HP", () => {
    TIMELINE_LINE_FLAGS.enemyDef = "timeline";

    const owner = makeUnit({
      id: "P1",
      name: "OwnerPlayer",
      auraEvents: [
        {
          spellId: "185313",
          srcUnitId: "P1",
          timestamp: T0 + 40_000,
          logLine: { event: LogEvent.SPELL_AURA_APPLIED, timestamp: T0 + 40_000 },
        },
        {
          spellId: "185313",
          srcUnitId: "P1",
          timestamp: T0 + 50_000,
          logLine: { event: LogEvent.SPELL_AURA_REMOVED, timestamp: T0 + 50_000 },
        },
      ] as any,
    });

    // Cloak of Shadows (spellId 31224, immune, 5.0s)
    const enemyRogue = makeUnit({
      id: "E1",
      name: "EnemyRogue",
      reaction: CombatUnitReaction.Hostile,
      spec: CombatUnitSpec.Rogue_Subtlety,
      auraEvents: [
        {
          spellId: "31224",
          spellName: "Cloak of Shadows",
          srcUnitId: "E1",
          srcUnitName: "EnemyRogue",
          destUnitId: "E1",
          destUnitName: "EnemyRogue",
          timestamp: T0 + 45_000,
          logLine: { event: LogEvent.SPELL_AURA_APPLIED, timestamp: T0 + 45_000 },
        },
        {
          spellId: "31224",
          spellName: "Cloak of Shadows",
          srcUnitId: "E1",
          srcUnitName: "EnemyRogue",
          destUnitId: "E1",
          destUnitName: "EnemyRogue",
          timestamp: T0 + 50_000,
          logLine: { event: LogEvent.SPELL_AURA_REMOVED, timestamp: T0 + 50_000 },
        },
      ] as any,
      advancedActions: [hpTick("E1", 45, 28)],
    });

    const timeline = buildMatchTimeline({
      owner,
      ownerSpec: "Subtlety Rogue",
      friends: [owner],
      enemies: [enemyRogue],
      allUnits: [owner, enemyRogue],
      playerIdMap: new Map([["OwnerPlayer", 1]]),
      enemyIdMap: new Map([["EnemyRogue", 2]]),
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

    expect(timeline).toContain("[ENEMY DEF]");
    expect(timeline).toContain("Cloak of Shadows (immune, 5.0s) [friendly offensive CD active] (at 28% HP)");
    expect(timeline).toMatch(
      /0:45\s+\[ENEMY DEF\]\s+2\(SRogue\) \(Subtlety Rogue\): Cloak of Shadows \(immune, 5\.0s\) \[friendly offensive CD active\] \(at 28% HP\)/,
    );
  });

  it("6. [ENEMY DEF] external: resolves target HP via d.recipientId", () => {
    TIMELINE_LINE_FLAGS.enemyDef = "timeline";

    const owner = makeUnit({
      id: "P1",
      name: "OwnerPlayer",
      auraEvents: [
        {
          spellId: "185313",
          srcUnitId: "P1",
          timestamp: T0 + 40_000,
          logLine: { event: LogEvent.SPELL_AURA_APPLIED, timestamp: T0 + 40_000 },
        },
        {
          spellId: "185313",
          srcUnitId: "P1",
          timestamp: T0 + 50_000,
          logLine: { event: LogEvent.SPELL_AURA_REMOVED, timestamp: T0 + 50_000 },
        },
      ] as any,
    });

    const enemyRogue = makeUnit({
      id: "E1",
      name: "EnemyRogue",
      reaction: CombatUnitReaction.Hostile,
      spec: CombatUnitSpec.Rogue_Subtlety,
      advancedActions: [hpTick("E1", 46, 24)],
      auraEvents: [
        {
          spellId: "33206",
          spellName: "Pain Suppression",
          srcUnitId: "E2",
          srcUnitName: "EnemyPriest",
          destUnitId: "E1",
          destUnitName: "EnemyRogue",
          timestamp: T0 + 46_000,
          logLine: { event: LogEvent.SPELL_AURA_APPLIED, timestamp: T0 + 46_000 },
        },
        {
          spellId: "33206",
          spellName: "Pain Suppression",
          srcUnitId: "E2",
          srcUnitName: "EnemyPriest",
          destUnitId: "E1",
          destUnitName: "EnemyRogue",
          timestamp: T0 + 54_000,
          logLine: { event: LogEvent.SPELL_AURA_REMOVED, timestamp: T0 + 54_000 },
        },
      ] as any,
    });

    const enemyPriest = makeUnit({
      id: "E2",
      name: "EnemyPriest",
      reaction: CombatUnitReaction.Hostile,
      spec: CombatUnitSpec.Priest_Discipline,
      advancedActions: [hpTick("E2", 46, 90)], // Caster HP is 90%, target HP is 24%
      spellCastEvents: [
        {
          spellId: "33206",
          spellName: "Pain Suppression",
          destUnitId: "E1",
          destUnitName: "EnemyRogue",
          logLine: {
            event: LogEvent.SPELL_CAST_SUCCESS,
            timestamp: T0 + 46_000,
          },
        } as any,
      ],
    });

    const timeline = buildMatchTimeline({
      owner,
      ownerSpec: "Subtlety Rogue",
      friends: [owner],
      enemies: [enemyRogue, enemyPriest],
      allUnits: [owner, enemyRogue, enemyPriest],
      playerIdMap: new Map([["OwnerPlayer", 1]]),
      enemyIdMap: new Map([
        ["EnemyRogue", 2],
        ["EnemyPriest", 3],
      ]),
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

    expect(timeline).toContain("[ENEMY DEF]");
    expect(timeline).toContain(
      "Pain Suppression → 2(SRogue) (8.0s) [friendly offensive CD active] (target at 24% HP)",
    );
    expect(timeline).not.toContain("target at 90% HP");
    expect(timeline).toMatch(
      /0:46\s+\[ENEMY DEF\]\s+3\(DPriest\) \(Discipline Priest\): Pain Suppression → 2\(SRogue\) \(8\.0s\) \[friendly offensive CD active\] \(target at 24% HP\)/,
    );
  });

  it("7. Missing HP data: gracefully omitted without formatting artifacts or undefined", () => {
    TIMELINE_LINE_FLAGS.enemyDef = "timeline";

    const owner = makeUnit({
      id: "P1",
      name: "OwnerPlayer",
      auraEvents: [
        {
          spellId: "185313",
          srcUnitId: "P1",
          timestamp: T0 + 40_000,
          logLine: { event: LogEvent.SPELL_AURA_APPLIED, timestamp: T0 + 40_000 },
        },
        {
          spellId: "185313",
          srcUnitId: "P1",
          timestamp: T0 + 50_000,
          logLine: { event: LogEvent.SPELL_AURA_REMOVED, timestamp: T0 + 50_000 },
        },
      ] as any,
    });

    // Enemy rogue has no advancedActions (no HP ticks)
    const enemyRogue = makeUnit({
      id: "E1",
      name: "EnemyRogue",
      reaction: CombatUnitReaction.Hostile,
      spec: CombatUnitSpec.Rogue_Subtlety,
      advancedActions: [],
      auraEvents: [
        {
          spellId: "31224",
          spellName: "Cloak of Shadows",
          srcUnitId: "E1",
          srcUnitName: "EnemyRogue",
          destUnitId: "E1",
          destUnitName: "EnemyRogue",
          timestamp: T0 + 45_000,
          logLine: { event: LogEvent.SPELL_AURA_APPLIED, timestamp: T0 + 45_000 },
        },
        {
          spellId: "31224",
          spellName: "Cloak of Shadows",
          srcUnitId: "E1",
          srcUnitName: "EnemyRogue",
          destUnitId: "E1",
          destUnitName: "EnemyRogue",
          timestamp: T0 + 50_000,
          logLine: { event: LogEvent.SPELL_AURA_REMOVED, timestamp: T0 + 50_000 },
        },
      ] as any,
    });

    const enemyCCSummaries: IPlayerCCTrinketSummary[] = [
      makeCCTrinketSummary({
        playerName: "EnemyRogue",
        trinketUseTimes: [42],
        ccInstances: [],
      }),
    ];

    const timeline = buildMatchTimeline({
      owner,
      ownerSpec: "Subtlety Rogue",
      friends: [owner],
      enemies: [enemyRogue],
      allUnits: [owner, enemyRogue],
      playerIdMap: new Map([["OwnerPlayer", 1]]),
      enemyIdMap: new Map([["EnemyRogue", 2]]),
      matchStartMs: T0,
      matchEndMs: T0 + 60_000,
      isHealer: false,
      ownerCDs: [],
      teammateCDs: [],
      enemyCDTimeline: { players: [], alignedBurstWindows: [] },
      ccTrinketSummaries: [],
      enemyCCSummaries,
      dispelSummary: emptyDispel as any,
      enemyDispelSummary: emptyDispel as any,
      pressureWindows: [],
      healingGaps: [],
      friendlyDeaths: [],
      enemyDeaths: [],
      criticalWindowSeconds: new Set(),
      outgoingCCChains: [],
    });

    expect(timeline).not.toContain("undefined");
    expect(timeline).not.toContain("NaN");
    expect(timeline).not.toContain("(at % HP)");
    expect(timeline).not.toContain("(target at % HP)");
    expect(timeline).toContain(
      "Cloak of Shadows (immune, 5.0s) [friendly offensive CD active]",
    );
    expect(timeline).toContain(
      "used PvP trinket [friendly offensive CD active]",
    );
  });

  it("8. Legend entries describe [friendly offensive CD active] and target HP context", () => {
    TIMELINE_LINE_FLAGS.enemyDef = "timeline";
    const owner = makeUnit();
    const timeline = buildMatchTimeline({
      owner,
      ownerSpec: "Subtlety Rogue",
      friends: [owner],
      enemies: [],
      allUnits: [owner],
      matchStartMs: T0,
      matchEndMs: T0 + 60_000,
      isHealer: false,
      ownerCDs: [],
      teammateCDs: [],
      enemyCDTimeline: { players: [], alignedBurstWindows: [] },
      ccTrinketSummaries: [],
      enemyCCSummaries: [
        makeCCTrinketSummary({
          playerName: "EnemyRogue",
          trinketUseTimes: [42],
          ccInstances: [],
        }),
      ],
      dispelSummary: emptyDispel as any,
      enemyDispelSummary: emptyDispel as any,
      pressureWindows: [],
      healingGaps: [],
      friendlyDeaths: [],
      enemyDeaths: [],
      criticalWindowSeconds: new Set(),
      outgoingCCChains: [],
    });

    expect(timeline).toContain("[ENEMY DEF] = ");
    expect(timeline).toContain("[ENEMY TRINKET] = ");
    expect(timeline).toContain("[friendly offensive CD active]");
    expect(timeline).toContain("(target at N% HP)");
  });
});
