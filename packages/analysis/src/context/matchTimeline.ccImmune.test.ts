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
    // fact3 D58: the line names nobody (Psychic Scream has no target), so
    // the tag says whose immunity it was
    expect(timeline).toMatch(/\[IMMUNE: \S+ — Divine Shield was up\]/);
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

  it("an AoE CC's IMMUNE miss on a pet it swept is not the player targets' immunity (2026-09-30)", () => {
    const enemy = mkUnit("e", "Enemy-Realm", {
      reaction: CombatUnitReaction.Hostile,
    });
    const ghoulMiss = {
      ...missImmune(PSYCHIC_SCREAM, "Psychic Scream", 30_000),
      destUnitId: "Creature-0-1-2-3-237409-0",
      destUnitName: "Lesser Ghoul",
    };
    const ledger = [
      {
        spellId: PSYCHIC_SCREAM,
        spellName: "Psychic Scream",
        tag: "CC" as const,
        cooldownSeconds: 30,
        maxChargesDetected: 1,
        casts: [{ timeSeconds: 30 }],
        availableWindows: [],
        neverUsed: false,
      },
    ];
    const swept = buildMatchTimeline(
      baseParams(
        mkUnit("o", "Me-Realm", { missesOut: [ghoulMiss] as never }),
        enemy,
        ledger,
      ),
    );
    expect(swept).not.toContain("[IMMUNE");
    // The same miss on the player target still tags.
    const onPlayer = buildMatchTimeline(
      baseParams(
        mkUnit("o", "Me-Realm", {
          missesOut: [
            missImmune(PSYCHIC_SCREAM, "Psychic Scream", 30_000),
          ] as never,
        }),
        enemy,
        ledger,
      ),
    );
    expect(onPlayer).toMatch(/\[IMMUNE: \S+\]/);
  });

  it("F20 residual: a skin-variant cast id is the ledger press's own row (s0/1-1 0:25 Hex 210873 into Cloak)", () => {
    // the ledger keys Hex as 51514; the log casts (and misses) the
    // variant 210873. The press line takes the tag; no separate
    // [CC NOT LANDED] line restates it.
    const enemy = mkUnit("e", "Enemy-Realm", {
      reaction: CombatUnitReaction.Hostile,
    });
    const owner = mkUnit("o", "Me-Realm", {
      spellCastEvents: [cast("210873", "Hex", 25_000)] as never,
      missesOut: [missImmune("210873", "Hex", 25_050)] as never,
    });
    const timeline = buildMatchTimeline(
      baseParams(owner, enemy, [
        {
          spellId: "51514",
          spellName: "Hex",
          tag: "CC",
          cooldownSeconds: 30,
          maxChargesDetected: 1,
          casts: [{ timeSeconds: 25 }],
          availableWindows: [],
          neverUsed: false,
        },
      ]),
    );
    const line = timeline
      .split("\n")
      .find((l) => l.includes("[YOU] [CC]") && l.includes("Hex"));
    expect(line).toBeDefined();
    expect(line).toContain("[IMMUNE");
    expect(timeline).not.toContain("[CC NOT LANDED]");
  });

  it("a single-target CC aimed at a pet keeps its IMMUNE tag", () => {
    const enemy = mkUnit("e", "Enemy-Realm", {
      reaction: CombatUnitReaction.Hostile,
    });
    const pet = "Creature-0-1-2-3-417-0";
    const owner = mkUnit("o", "Me-Realm", {
      spellCastEvents: [
        { ...cast(POLYMORPH, "Polymorph", 30_000), destUnitId: pet },
      ] as never,
      missesOut: [
        { ...missImmune(POLYMORPH, "Polymorph", 30_900), destUnitId: pet },
      ] as never,
    });
    expect(buildMatchTimeline(baseParams(owner, enemy))).toContain("[IMMUNE]");
  });
});

describe("[IMMUNE] on the owner's plain [YOU] [CAST] lines (F20 immunity residual, user ruling 2026-10-28)", () => {
  const iceBlock = [
    aura("45438", "Ice Block", LogEvent.SPELL_AURA_APPLIED, 64_000),
    aura("45438", "Ice Block", LogEvent.SPELL_AURA_REMOVED, 70_000),
  ];
  const castLines = (owner: ICombatUnit, enemy: ICombatUnit) =>
    buildMatchTimeline(baseParams(owner, enemy))
      .split("\n")
      .filter((l) => /^\d+:\d{2} {2}\[YOU\] \[CAST\]/.test(l));

  it("s0/30-3 1:05: a Holy Fire into Ice Block carries the press lines' tag", () => {
    const enemy = mkUnit("e", "Enemy-Realm", {
      reaction: CombatUnitReaction.Hostile,
      auraEvents: iceBlock as never,
    });
    const owner = mkUnit("o", "Me-Realm", {
      spellCastEvents: [cast("14914", "Holy Fire", 65_000)] as never,
      missesOut: [missImmune("14914", "Holy Fire", 65_050)] as never,
    });
    const lines = castLines(owner, enemy);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^1:05 {2}\[YOU\] \[CAST\] {3}Holy Fire → \S+ \[IMMUNE — Ice Block was up\]$/,
    );
    // control: the same cast with no IMMUNE row is bare
    const landed = castLines(
      mkUnit("o", "Me-Realm", {
        spellCastEvents: [cast("14914", "Holy Fire", 65_000)] as never,
      }),
      enemy,
    );
    expect(landed[0]).not.toContain("[IMMUNE");
  });

  it("a refused cast of a spam-folded spell leaves the fold and prints with its tag", () => {
    const enemy = mkUnit("e", "Enemy-Realm", {
      reaction: CombatUnitReaction.Hostile,
      auraEvents: iceBlock as never,
    });
    const casts = Array.from({ length: 14 }, (_, i) =>
      cast("585", "Smite", 40_000 + i * 2_000),
    );
    const owner = mkUnit("o", "Me-Realm", {
      spellCastEvents: casts as never,
      missesOut: [missImmune("585", "Smite", 66_020)] as never,
    });
    const lines = castLines(owner, enemy);
    const tagged = lines.filter((l) => l.includes("[IMMUNE"));
    expect(tagged).toHaveLength(1);
    expect(tagged[0]).toMatch(
      /^1:06 {2}\[YOU\] \[CAST\] {3}Smite → \S+ \[IMMUNE — Ice Block was up\]$/,
    );
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

  it("a REFLECT row aimed at the caster itself names no reflector (codex F20-23)", () => {
    const enemy = mkUnit("e", "Enemy-Realm", {
      reaction: CombatUnitReaction.Hostile,
    });
    const owner = mkUnit("o", "Me-Realm", {
      spellCastEvents: [cast(POLYMORPH, "Polymorph", 30_000)] as never,
      missesOut: [
        miss(POLYMORPH, "Polymorph", 30_050, "REFLECT"),
        {
          ...miss(POLYMORPH, "Polymorph", 30_050, "REFLECT"),
          destUnitId: "o",
          destUnitName: "Me-Realm",
        },
      ] as never,
    });
    const lines = buildMatchTimeline(baseParams(owner, enemy))
      .split("\n")
      .filter((l) => l.includes("[YOU] [CC]"));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.match(/REFLECTED by/g)).toHaveLength(1);
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

  it("names the avoidance aura the shared sweep found for this cast (Phase Shift)", () => {
    const enemy = mkUnit("e", "Enemy-Realm", {
      reaction: CombatUnitReaction.Hostile,
    });
    const owner = mkUnit("o", "Me-Realm", {
      spellCastEvents: [cast(POLYMORPH, "Polymorph", 30_000)] as never,
      missesOut: [miss(POLYMORPH, "Polymorph", 30_050, "MISS")] as never,
    });
    const avoided = (atSeconds: number) => ({
      ...baseParams(owner, enemy),
      enemyCCSummaries: [
        {
          playerName: "Enemy-Realm",
          ccInstances: [],
          trinketUseTimes: [],
          ccAvoidedInstances: [
            {
              atSeconds,
              spellId: POLYMORPH,
              spellName: "Polymorph",
              avoidanceSpellName: "Phase Shift",
              avoidanceSpellId: "408558",
              sourceName: "Me-Realm",
              sourceId: "o",
            },
          ],
        },
      ] as never,
    });
    const lineOf = (t: string) =>
      t.split("\n").find((l) => l.includes("[YOU] [CC]"))!;
    expect(lineOf(buildMatchTimeline(avoided(30)))).toMatch(
      / \[MISSED on \S+ — Phase Shift was up\]$/,
    );
    // another cast's avoidance is not this one's cause
    expect(lineOf(buildMatchTimeline(avoided(31)))).toMatch(
      / \[MISSED on \S+\]$/,
    );
  });
});
