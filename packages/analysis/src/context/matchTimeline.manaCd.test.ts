import {
  CombatUnitClass,
  CombatUnitPowerType,
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../data/ensure";
import { buildMatchTimeline, BuildMatchTimelineParams } from "./matchTimeline";
import {
  ROT_PRESSURE_HP_PCT,
  ROT_PRESSURE_MIN_DOTS,
  ROT_PRESSURE_MIN_PERIODIC_SHARE,
  ROT_PRESSURE_MIN_SECONDS,
} from "./matchTimelineSections";

/**
 * Innervate (29166) is a MANA cooldown, and until 2026-08-23 it sat in
 * `HEALING_AMPLIFIER_SPELL_IDS` next to Power Infusion and Ascendance. That
 * path scores an amplifier's casts by `overhealPct*1000 - maxBucketHps` and
 * surfaces the WORST one, so the prompt was telling the model that a low-HPS
 * Innervate window is the mistake worth looking at — when low HPS is exactly
 * when a healer drinks.
 *
 * Measured on 200 archive files: Innervate ticks mana back through
 * SPELL_PERIODIC_ENERGIZE (258 hits) and the target's mana rises in 55 of 58
 * windows (0 fell, median +9.5pp).
 */

const INNERVATE = "29166";
const MATCH_START_MS = 0;
const MATCH_END_MS = 120_000;

function advSample(
  id: string,
  timestamp: number,
  manaCur: number,
  manaMax: number,
) {
  return {
    advancedActorPowers: [
      { type: CombatUnitPowerType.Mana, current: manaCur, max: manaMax },
    ],
    advancedActorCurrentHp: 100,
    advancedActorMaxHp: 100,
    advancedActorPositionX: 0,
    advancedActorPositionY: 0,
    advanced: true as const,
    timestamp,
    advancedActorId: id,
    logLine: { event: "ADVANCED_SAMPLE" as const, timestamp },
  };
}

function mkOwner(overrides: Partial<ICombatUnit> = {}): ICombatUnit {
  return {
    id: "o",
    name: "Druid-Ravencrest",
    ownerId: "",
    isWellFormed: true,
    type: CombatUnitType.Player,
    class: CombatUnitClass.Druid,
    spec: CombatUnitSpec.Druid_Restoration,
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

function paramsWith(owner: ICombatUnit): BuildMatchTimelineParams {
  return {
    owner,
    ownerSpec: "Druid_Restoration",
    ownerCDs: [
      {
        spellId: INNERVATE,
        spellName: "Innervate",
        tag: "Utility",
        cooldownSeconds: 180,
        maxChargesDetected: 1,
        casts: [{ timeSeconds: 30 }],
        availableWindows: [],
        neverUsed: false,
      },
    ],
    teammateCDs: [],
    enemyCDTimeline: { players: [], alignedBurstWindows: [] },
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
    pressureWindows: [],
    healingGaps: [],
    friends: [owner],
    enemies: [],
    matchStartMs: MATCH_START_MS,
    matchEndMs: MATCH_END_MS,
    isHealer: true,
    criticalWindowSeconds: new Set<number>(),
  };
}

describe("Innervate is reported as resource, not throughput", () => {
  beforeAll(async () => {
    // durationSeconds comes from the dynamically loaded official table.
    await ensureAnalysisData();
  });

  it("emits [MANA] with the before → after swing across the 8s window", () => {
    const owner = mkOwner({
      advancedActions: [
        advSample("o", MATCH_START_MS + 30_000, 22_000, 100_000), // 22%
        advSample("o", MATCH_START_MS + 38_000, 41_000, 100_000), // 41%
      ],
    });
    const timeline = buildMatchTimeline(paramsWith(owner));
    expect(timeline).toContain("[MANA]");
    expect(timeline).toContain("22% -> 41% mana (+19pp over 8s)");
  });

  it("never scores the cast on healing throughput", () => {
    const owner = mkOwner({
      advancedActions: [
        advSample("o", MATCH_START_MS + 30_000, 22_000, 100_000),
        advSample("o", MATCH_START_MS + 38_000, 41_000, 100_000),
      ],
    });
    const timeline = buildMatchTimeline(paramsWith(owner));
    const innervateBlock = timeline
      .split("\n")
      .filter((l) => /Innervate|\[MANA\]|\[HEALING\]/.test(l))
      .join("\n");
    expect(innervateBlock).not.toContain("[HEALING]");
    expect(innervateBlock).not.toContain("Overheal");
  });

  it("says so plainly when the window has no resource reading", () => {
    const timeline = buildMatchTimeline(paramsWith(mkOwner()));
    expect(timeline).toContain("[MANA]");
    expect(timeline).toContain("no resource reading");
  });
  it("PRODUCTION SHAPE: fires through the B38 promotion path, with an empty ledger", () => {
    // Innervate is normally absent from extractMajorCooldowns, so the real
    // prompt renders it from spellCastEvents via the CD>=30s promotion branch.
    // Wiring only the ledger loop passed the tests above and produced nothing
    // on any real match — this case is the one that reflects production.
    const owner = mkOwner({
      spellCastEvents: [
        {
          spellId: INNERVATE,
          spellName: "Innervate",
          timestamp: MATCH_START_MS + 30_000,
          srcUnitFlags: 0,
          destUnitFlags: 0,
          srcUnitId: "o",
          srcUnitName: "Druid-Ravencrest",
          destUnitId: "o",
          destUnitName: "Druid-Ravencrest",
          logLine: {
            event: LogEvent.SPELL_CAST_SUCCESS,
            timestamp: MATCH_START_MS + 30_000,
            parameters: [],
          },
        },
      ],
      advancedActions: [
        advSample("o", MATCH_START_MS + 30_000, 22_000, 100_000),
        advSample("o", MATCH_START_MS + 38_000, 41_000, 100_000),
      ],
    });
    const params = paramsWith(owner);
    params.ownerCDs = [];
    const timeline = buildMatchTimeline(params);
    expect(timeline).toContain("[YOU] [CD]");
    expect(timeline).toContain("Innervate");
    expect(timeline).toContain("22% -> 41% mana (+19pp over 8s)");
  });
});

// FT-T15 M5 (2026-10-10): [HEALING] and [ROT PRESSURE] had no definition
// anywhere in the prompt (893 and 1,155 lines on the 605 capture, 0 legends).
// Each legend prints only when a line of its family rendered.
describe("[HEALING] / [ROT PRESSURE] legends print only with their line family", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  const POWER_INFUSION = "10060";
  const heal = (atMs: number, amount: number, effectiveAmount: number) =>
    ({
      timestamp: atMs,
      amount,
      effectiveAmount,
      spellId: "2061",
      spellName: "Flash Heal",
      srcUnitId: "o",
      destUnitId: "o",
      logLine: { event: "SPELL_HEAL", timestamp: atMs, parameters: [] },
    }) as unknown as ICombatUnit["healOut"][number];

  function piParams(owner: ICombatUnit): BuildMatchTimelineParams {
    const params = paramsWith(owner);
    params.ownerCDs = [
      {
        spellId: POWER_INFUSION,
        spellName: "Power Infusion",
        tag: "Offensive",
        cooldownSeconds: 120,
        maxChargesDetected: 1,
        casts: [{ timeSeconds: 30 }],
        availableWindows: [],
        neverUsed: false,
      },
    ] as BuildMatchTimelineParams["ownerCDs"];
    return params;
  }

  it("neither family rendered → neither legend (and no stray tag for a scan to count)", () => {
    const timeline = buildMatchTimeline(paramsWith(mkOwner()));
    expect(timeline).not.toContain("[HEALING]");
    expect(timeline).not.toContain("[ROT PRESSURE]");
  });

  it("a Power Infusion press with healing logged → the block and its legend, once", () => {
    const owner = mkOwner({
      healOut: [
        heal(MATCH_START_MS + 31_000, 60_000, 45_000),
        heal(MATCH_START_MS + 37_000, 40_000, 30_000),
      ],
    });
    const lines = buildMatchTimeline(piParams(owner)).split("\n");
    const block = lines.filter((l) => l.startsWith("      [HEALING]"));
    expect(block).toEqual([
      "      [HEALING]    0–5s: 9.0k HPS | 5–10s: 6.0k HPS | 10–15s: 0.0k HPS | Overheal: 25%",
    ]);
    const legend = lines.filter((l) => l.startsWith("  [HEALING] "));
    expect(legend).toHaveLength(1);
    expect(legend[0]).toContain("YOUR OWN healing");
    const text = lines.join("\n");
    expect(text).toContain("in 5 s buckets");
    expect(text).toContain(
      "`Overheal` = the share of your healing in the whole span that was overheal",
    );
    expect(text).toContain("At most two presses of a spell get");
    expect(text).not.toContain("[ROT PRESSURE]");
  });

  it("a rot-pressure stretch → the line and its legend, with the predicate's own numbers", () => {
    const debuff = (spellId: string) =>
      ({
        timestamp: MATCH_START_MS,
        spellId,
        spellName: spellId,
        srcUnitId: "e1",
        srcUnitName: "Enemy",
        destUnitId: "o",
        destUnitName: "Druid-Ravencrest",
        logLine: {
          event: LogEvent.SPELL_AURA_APPLIED,
          timestamp: MATCH_START_MS,
          parameters: Object.assign([], { 11: "DEBUFF" }),
        },
      }) as unknown as ICombatUnit["auraEvents"][number];
    const hpAt = (sec: number, hp: number) => ({
      ...advSample("o", MATCH_START_MS + sec * 1000, 50_000, 100_000),
      advancedActorCurrentHp: hp,
    });
    const owner = mkOwner({
      // Agony / Corruption / Unstable Affliction, on from the first second
      auraEvents: [debuff("980"), debuff("146739"), debuff("30108")],
      advancedActions: [
        hpAt(8, 80),
        hpAt(10, 30),
        hpAt(11, 30),
        hpAt(12, 30),
        hpAt(13, 30),
        hpAt(14, 30),
        hpAt(20, 80),
      ],
    });
    const lines = buildMatchTimeline(paramsWith(owner)).split("\n");
    expect(
      lines.filter((l) => /^\d+:\d\d\s+\[ROT PRESSURE\]/.test(l)),
    ).toHaveLength(1);
    const legend = lines.filter((l) => l.startsWith("  [ROT PRESSURE] = "));
    expect(legend).toHaveLength(1);
    const text = lines.join("\n");
    expect(text).toContain(
      `spent ${ROT_PRESSURE_MIN_SECONDS} whole seconds in a row under ${ROT_PRESSURE_HP_PCT}% HP with ${ROT_PRESSURE_MIN_DOTS} or more tracked`,
    );
    expect(text).toContain(
      `at least ${ROT_PRESSURE_MIN_PERIODIC_SHARE * 100}% of the damage they took`,
    );
  });
});
