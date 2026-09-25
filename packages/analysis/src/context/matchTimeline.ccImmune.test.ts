import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { buildMatchTimeline, BuildMatchTimelineParams } from "./matchTimeline";

/**
 * `[IMMUNE]` on the owner's CC casts (BACKLOG #40 wiring of `missType`).
 *
 * Before 2026-08-23 a CC thrown into Divine Shield rendered exactly like a
 * landed one — the cast line appears, no DR tag follows, and nothing says the
 * game rejected it. Both `[YOU] [CC]` emitters are pinned here, because the
 * Innervate wiring one commit earlier demonstrated the failure mode: a note
 * wired into only the cooldown-ledger path passes its unit test and never
 * fires in production (Polymorph-class CC renders through the general cast
 * loop's CC branch instead).
 */

const PSYCHIC_SCREAM = "8122";
const POLYMORPH = "118";
const DIVINE_SHIELD = "642";
const MATCH_START_MS = 0;
const MATCH_END_MS = 120_000;

function mkUnit(
  id: string,
  name: string,
  overrides: Partial<ICombatUnit> = {},
): ICombatUnit {
  return {
    id,
    name,
    ownerId: "",
    isWellFormed: true,
    type: CombatUnitType.Player,
    class: CombatUnitClass.Priest,
    spec: CombatUnitSpec.Priest_Discipline,
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

const missImmune = (spellId: string, spellName: string, t: number) => ({
  spellId,
  spellName,
  timestamp: t,
  srcUnitFlags: 0,
  destUnitFlags: 0,
  srcUnitId: "o",
  srcUnitName: "Me-Realm",
  destUnitId: "e",
  destUnitName: "Enemy-Realm",
  missType: "IMMUNE",
  amount: 0,
  logLine: {
    event: LogEvent.SPELL_MISSED,
    timestamp: t,
    parameters: [],
  },
});

const cast = (spellId: string, spellName: string, t: number) => ({
  spellId,
  spellName,
  timestamp: t,
  srcUnitFlags: 0,
  destUnitFlags: 0,
  srcUnitId: "o",
  srcUnitName: "Me-Realm",
  destUnitId: "e",
  destUnitName: "Enemy-Realm",
  logLine: {
    event: LogEvent.SPELL_CAST_SUCCESS,
    timestamp: t,
    parameters: [],
  },
});

const aura = (
  spellId: string,
  spellName: string,
  event: LogEvent,
  t: number,
) => ({
  spellId,
  spellName,
  timestamp: t,
  srcUnitFlags: 0,
  destUnitFlags: 0,
  srcUnitId: "e",
  srcUnitName: "Enemy-Realm",
  destUnitId: "e",
  destUnitName: "Enemy-Realm",
  auraType: "BUFF" as const,
  logLine: { event, timestamp: t, parameters: [] },
});

function baseParams(
  owner: ICombatUnit,
  enemy: ICombatUnit,
  ownerCDs: BuildMatchTimelineParams["ownerCDs"] = [],
): BuildMatchTimelineParams {
  return {
    owner,
    ownerSpec: "Priest_Discipline",
    ownerCDs,
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
    enemies: [enemy],
    matchStartMs: MATCH_START_MS,
    matchEndMs: MATCH_END_MS,
    isHealer: true,
    criticalWindowSeconds: new Set<number>(),
  };
}

describe("[IMMUNE] on the owner's CC casts", () => {
  it("cooldown-ledger path: tags the [YOU] [CC] line and names the immunity", () => {
    const enemy = mkUnit("e", "Enemy-Realm", {
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        aura(
          DIVINE_SHIELD,
          "Divine Shield",
          LogEvent.SPELL_AURA_APPLIED,
          28_000,
        ),
        aura(
          DIVINE_SHIELD,
          "Divine Shield",
          LogEvent.SPELL_AURA_REMOVED,
          36_000,
        ),
      ] as never,
    });
    const owner = mkUnit("o", "Me-Realm", {
      missesOut: [
        missImmune(PSYCHIC_SCREAM, "Psychic Scream", 30_000),
      ] as never,
    });
    const timeline = buildMatchTimeline(
      baseParams(owner, enemy, [
        {
          spellId: PSYCHIC_SCREAM,
          spellName: "Psychic Scream",
          tag: "CC",
          cooldownSeconds: 30,
          maxChargesDetected: 1,
          casts: [{ timeSeconds: 30 }],
          availableWindows: [],
          neverUsed: false,
        },
      ]),
    );
    expect(timeline).toContain("[IMMUNE — Divine Shield was up]");
  });

  it("general-cast path (no ledger entry): Polymorph-class CC gets the tag too", () => {
    const enemy = mkUnit("e", "Enemy-Realm", {
      reaction: CombatUnitReaction.Hostile,
    });
    const owner = mkUnit("o", "Me-Realm", {
      spellCastEvents: [cast(POLYMORPH, "Polymorph", 30_000)] as never,
      // Projectile: the miss lands 900ms after the cast succeeded.
      missesOut: [missImmune(POLYMORPH, "Polymorph", 30_900)] as never,
    });
    const timeline = buildMatchTimeline(baseParams(owner, enemy));
    // No listed immunity aura on the target → bare tag, never a guessed name.
    expect(timeline).toContain("[YOU] [CC]");
    expect(timeline).toContain("[IMMUNE]");
    expect(timeline).not.toContain("was up]");
  });

  it("a landed CC gets no tag, and one miss is consumed only once", () => {
    const enemy = mkUnit("e", "Enemy-Realm", {
      reaction: CombatUnitReaction.Hostile,
    });
    const owner = mkUnit("o", "Me-Realm", {
      spellCastEvents: [
        cast(POLYMORPH, "Polymorph", 30_000),
        cast(POLYMORPH, "Polymorph", 33_000), // second cast: no miss of its own
      ] as never,
      missesOut: [missImmune(POLYMORPH, "Polymorph", 30_100)] as never,
    });
    const timeline = buildMatchTimeline(baseParams(owner, enemy));
    const tagged = timeline
      .split("\n")
      .filter((l) => l.includes("[IMMUNE]")).length;
    expect(tagged).toBe(1);
  });
});

describe("[MISSED on …] / [REFLECTED by …] on the owner's CC casts (2026-09-25)", () => {
  const miss = (
    spellId: string,
    spellName: string,
    t: number,
    missType: string,
  ) => ({
    ...missImmune(spellId, spellName, t),
    missType,
  });
  const run = (missType: string, ledger: boolean) => {
    const enemy = mkUnit("e", "Enemy-Realm", {
      reaction: CombatUnitReaction.Hostile,
    });
    const owner = mkUnit("o", "Me-Realm", {
      spellCastEvents: ledger
        ? []
        : ([cast(POLYMORPH, "Polymorph", 30_000)] as never),
      missesOut: [
        miss(
          ledger ? PSYCHIC_SCREAM : POLYMORPH,
          ledger ? "Psychic Scream" : "Polymorph",
          30_050,
          missType,
        ),
      ] as never,
    });
    return buildMatchTimeline(
      baseParams(
        owner,
        enemy,
        ledger
          ? [
              {
                spellId: PSYCHIC_SCREAM,
                spellName: "Psychic Scream",
                tag: "CC",
                cooldownSeconds: 30,
                maxChargesDetected: 1,
                casts: [{ timeSeconds: 30 }],
                availableWindows: [],
                neverUsed: false,
              },
            ]
          : [],
      ),
    )
      .split("\n")
      .filter((l) => l.includes("[YOU] [CC]"));
  };

  it("tags a MISS with the unit it missed, on both [YOU] [CC] emitters", () => {
    for (const ledger of [true, false]) {
      const lines = run("MISS", ledger);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/ \[MISSED on \S+\]$/);
      expect(lines[0]).not.toContain("[IMMUNE");
    }
  });

  it("names a reflect / parry / dodge", () => {
    expect(run("REFLECT", true)[0]).toMatch(/ \[REFLECTED by \S+\]$/);
    expect(run("PARRY", true)[0]).toMatch(/ \[PARRIED by \S+\]$/);
    expect(run("DODGE", false)[0]).toMatch(/ \[DODGED by \S+\]$/);
  });

  it("ignores ABSORB — on its own it does not establish a failed control", () => {
    for (const ledger of [true, false]) {
      const lines = run("ABSORB", ledger);
      expect(lines).toHaveLength(1);
      expect(lines[0]).not.toMatch(/MISSED|ABSORB|by \S+\]$/);
    }
  });

  it("attributes a miss to the cast that produced it, not an earlier landed cast (codex astra)", () => {
    const enemy = mkUnit("e", "Enemy-Realm", {
      reaction: CombatUnitReaction.Hostile,
    });
    const owner = mkUnit("o", "Me-Realm", {
      spellCastEvents: [
        cast(POLYMORPH, "Polymorph", 30_000),
        cast(POLYMORPH, "Polymorph", 31_500),
      ] as never,
      missesOut: [miss(POLYMORPH, "Polymorph", 31_550, "REFLECT")] as never,
    });
    const lines = buildMatchTimeline(baseParams(owner, enemy))
      .split("\n")
      .filter((l) => l.includes("[YOU] [CC]"));
    expect(lines).toHaveLength(2);
    expect(lines[0]).not.toContain("REFLECTED");
    expect(lines[1]).toMatch(/ \[REFLECTED by \S+\]$/);
  });

  it("labels a pet target by GUID, never its raw localized name (codex astra)", () => {
    const enemy = mkUnit("e", "Enemy-Realm", {
      reaction: CombatUnitReaction.Hostile,
    });
    const owner = mkUnit("o", "Me-Realm", {
      spellCastEvents: [cast(POLYMORPH, "Polymorph", 30_000)] as never,
      missesOut: [
        {
          ...miss(POLYMORPH, "Polymorph", 30_050, "MISS"),
          destUnitId: "Creature-0-1-2-3-17252-0000000001",
          destUnitName: "恶魔卫士",
        },
      ] as never,
    });
    const line = buildMatchTimeline(baseParams(owner, enemy))
      .split("\n")
      .find((l) => l.includes("[YOU] [CC]"))!;
    expect(line).toContain("[MISSED on [pet]]");
    expect(line).not.toMatch(/[\u4e00-\u9fff]/);
  });
});
