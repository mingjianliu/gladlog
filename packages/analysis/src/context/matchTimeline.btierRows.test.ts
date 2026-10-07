/**
 * B-tier timeline rows (user rulings 2026-10-06) — facts only:
 *  - B17a: `[IMMUNE]` on our team's control says why when the log shows it —
 *    an immunity aura (already), our own team's Cyclone on the target, or
 *    diminishing returns at immune (the DR engine's chain walk); nothing is
 *    added when none of the three is found;
 *  - B17b-U8: an enemy Death Grip on a player of our team gets a `[GRIP]`
 *    line (a displacement with no aura had no line);
 *  - B7a: the owner's kick that stopped nothing gets a `[KICK]` line with the
 *    kick audit's result.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../data/ensure";
import { buildMatchTimeline, BuildMatchTimelineParams } from "./matchTimeline";

beforeAll(async () => {
  await ensureAnalysisData();
});

const START = Date.UTC(2026, 7, 20); // 12.1 era: 20 s DR reset
const at = (s: number) => START + s * 1000;

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
    class: CombatUnitClass.Hunter,
    spec: CombatUnitSpec.Hunter_BeastMastery,
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
  } as ICombatUnit;
}

const ev = (
  event: LogEvent,
  spellId: string,
  spellName: string,
  s: number,
  src: [string, string],
  dest: [string, string],
  extra: Record<string, unknown> = {},
): any => ({
  spellId,
  spellName,
  timestamp: at(s),
  srcUnitFlags: 0,
  destUnitFlags: 0,
  srcUnitId: src[0],
  srcUnitName: src[1],
  destUnitId: dest[0],
  destUnitName: dest[1],
  logLine: { event, timestamp: at(s), parameters: [] },
  ...extra,
});

const ME: [string, string] = ["o", "Me-Realm"];
const FOE: [string, string] = ["e", "Enemy-Realm"];

function params(
  owner: ICombatUnit,
  enemy: ICombatUnit,
  over: Partial<BuildMatchTimelineParams> = {},
): BuildMatchTimelineParams {
  return {
    owner,
    ownerSpec: "Hunter_BeastMastery",
    ownerCDs: [],
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
    matchStartMs: START,
    matchEndMs: at(120),
    // the general cast loop that prints a CC with no ledger row runs for a
    // healer owner (the existing [IMMUNE] tests use the same setting)
    isHealer: true,
    criticalWindowSeconds: new Set<number>(),
    ...over,
  };
}

const POLYMORPH = "118"; // DR family: Incapacitate
const CYCLONE = "33786";

/** the owner's Polymorph at 22 s, rejected as IMMUNE on the enemy */
const polyImmuneOwner = (over: Partial<ICombatUnit> = {}) =>
  mkUnit("o", "Me-Realm", {
    spellCastEvents: [
      ev(LogEvent.SPELL_CAST_SUCCESS, POLYMORPH, "Polymorph", 22, ME, FOE),
    ] as never,
    missesOut: [
      ev(LogEvent.SPELL_MISSED, POLYMORPH, "Polymorph", 22.1, ME, FOE, {
        missType: "IMMUNE",
        amount: 0,
      }),
    ] as never,
    ...over,
  });
const sapChain = (seconds: number[]): any => [
  {
    targetName: "Enemy-Realm",
    targetSpec: "x",
    applications: seconds.map((s) => ({
      atSeconds: s,
      durationSeconds: 3,
      spellId: "6770",
      spellName: "Sap",
      casterName: "Rogue-Realm",
      casterSpec: "Subtlety Rogue",
      drInfo: { category: "Incapacitate", level: "Full", sequenceIndex: 0 },
    })),
  },
];
const immuneLine = (timeline: string) =>
  timeline.split("\n").find((l) => l.includes("[IMMUNE")) ?? "";

describe("[IMMUNE] says why (B17a)", () => {
  const enemy = (over: Partial<ICombatUnit> = {}) =>
    mkUnit("e", "Enemy-Realm", {
      reaction: CombatUnitReaction.Hostile,
      ...over,
    });

  it("diminishing returns: two controls of the family in an unbroken chain before it (ba8c0510 0:22)", () => {
    const line = immuneLine(
      buildMatchTimeline(
        params(polyImmuneOwner(), enemy(), {
          outgoingCCChains: sapChain([10, 16]),
        }),
      ),
    );
    expect(line).toContain("[IMMUNE — DR: Incapacitate Immune]");
  });

  it("one earlier control (the next would land at 50 %), or a chain the reset broke: no reason is claimed", () => {
    const one = immuneLine(
      buildMatchTimeline(
        params(polyImmuneOwner(), enemy(), {
          outgoingCCChains: sapChain([16]),
        }),
      ),
    );
    expect(one).toContain("[IMMUNE]");
    expect(one).not.toContain("DR:");
    // 20 s after the second control ended: the chain has reset
    const reset = immuneLine(
      buildMatchTimeline(
        params(
          mkUnit("o", "Me-Realm", {
            spellCastEvents: [
              ev(
                LogEvent.SPELL_CAST_SUCCESS,
                POLYMORPH,
                "Polymorph",
                60,
                ME,
                FOE,
              ),
            ] as never,
            missesOut: [
              ev(LogEvent.SPELL_MISSED, POLYMORPH, "Polymorph", 60.1, ME, FOE, {
                missType: "IMMUNE",
                amount: 0,
              }),
            ] as never,
          }),
          enemy(),
          { outgoingCCChains: sapChain([10, 16]) },
        ),
      ),
    );
    expect(reset).toContain("[IMMUNE]");
    expect(reset).not.toContain("DR:");
  });

  it("another family's chain does not count", () => {
    const stuns = sapChain([10, 16]);
    for (const a of stuns[0].applications)
      a.drInfo = { category: "Stun", level: "Full", sequenceIndex: 0 };
    const line = immuneLine(
      buildMatchTimeline(
        params(polyImmuneOwner(), enemy(), { outgoingCCChains: stuns }),
      ),
    );
    expect(line).not.toContain("DR:");
  });

  it("our own team's Cyclone on the target, named with its Druid — and ahead of the DR reason", () => {
    const druid = mkUnit("d", "Druid-Realm", {
      class: CombatUnitClass.Druid,
      spec: CombatUnitSpec.Druid_Restoration,
    });
    const cycloned = enemy({
      auraEvents: [
        ev(
          LogEvent.SPELL_AURA_APPLIED,
          CYCLONE,
          "Cyclone",
          20,
          ["d", "Druid-Realm"],
          FOE,
          { auraType: "DEBUFF" },
        ),
        ev(
          LogEvent.SPELL_AURA_REMOVED,
          CYCLONE,
          "Cyclone",
          25,
          ["d", "Druid-Realm"],
          FOE,
          { auraType: "DEBUFF" },
        ),
      ] as never,
    });
    const owner = polyImmuneOwner();
    const line = immuneLine(
      buildMatchTimeline(
        params(owner, cycloned, {
          friends: [owner, druid],
          outgoingCCChains: sapChain([10, 16]),
        }),
      ),
    );
    expect(line).toMatch(/\[IMMUNE — \S+'s Cyclone was on the target\]/);
    expect(line).not.toContain("DR:");
  });

  it("a Cyclone that had already ended, or an enemy's own, is not the reason", () => {
    const ended = enemy({
      auraEvents: [
        ev(
          LogEvent.SPELL_AURA_APPLIED,
          CYCLONE,
          "Cyclone",
          10,
          ["d", "Druid-Realm"],
          FOE,
          { auraType: "DEBUFF" },
        ),
        ev(
          LogEvent.SPELL_AURA_REMOVED,
          CYCLONE,
          "Cyclone",
          15,
          ["d", "Druid-Realm"],
          FOE,
          { auraType: "DEBUFF" },
        ),
      ] as never,
    });
    const druid = mkUnit("d", "Druid-Realm");
    const owner = polyImmuneOwner();
    expect(
      immuneLine(
        buildMatchTimeline(params(owner, ended, { friends: [owner, druid] })),
      ),
    ).not.toContain("Cyclone");
    const byEnemy = enemy({
      auraEvents: [
        ev(
          LogEvent.SPELL_AURA_APPLIED,
          CYCLONE,
          "Cyclone",
          20,
          ["x", "Other-Realm"],
          FOE,
          { auraType: "DEBUFF" },
        ),
      ] as never,
    });
    expect(
      immuneLine(buildMatchTimeline(params(polyImmuneOwner(), byEnemy))),
    ).not.toContain("Cyclone");
  });
});

describe("[GRIP]: an enemy Death Grip on our team (B17b-U8)", () => {
  const DEATH_GRIP = "49576";
  const dk = (over: Partial<ICombatUnit> = {}) =>
    mkUnit("e", "Enemy-Realm", {
      reaction: CombatUnitReaction.Hostile,
      class: CombatUnitClass.DeathKnight,
      spec: CombatUnitSpec.DeathKnight_Unholy,
      spellCastEvents: [
        ev(
          LogEvent.SPELL_CAST_SUCCESS,
          DEATH_GRIP,
          "Death Grip",
          46.992,
          FOE,
          ME,
        ),
      ] as never,
      ...over,
    });

  it("one line at the cast second, and the legend only then", () => {
    const text = buildMatchTimeline(params(mkUnit("o", "Me-Realm"), dk()));
    const line = text.split("\n").find((l) => l.includes("[GRIP]   "))!;
    expect(line).toMatch(/^0:46 {2}\[GRIP\] {3}.+ ← Death Grip \(by .+\)$/);
    expect(text).toContain("[GRIP] = an enemy Death Knight's Death Grip");
    const none = buildMatchTimeline(
      params(mkUnit("o", "Me-Realm"), dk({ spellCastEvents: [] })),
    );
    expect(none).not.toContain("[GRIP]");
  });

  it("a grip the target was immune to says it did not land", () => {
    const owner = mkUnit("o", "Me-Realm", {
      missesIn: [
        ev(LogEvent.SPELL_MISSED, DEATH_GRIP, "Death Grip", 47, FOE, ME, {
          missType: "IMMUNE",
          amount: 0,
        }),
      ] as never,
    });
    const text = buildMatchTimeline(params(owner, dk()));
    expect(text).toContain("← Death Grip (by ");
    expect(text).toContain(") — did not land (IMMUNE)");
  });

  it("a grip on an enemy's own teammate, or our Death Knight's grip, is not this line", () => {
    const text = buildMatchTimeline(
      params(
        mkUnit("o", "Me-Realm", {
          spellCastEvents: [
            ev(
              LogEvent.SPELL_CAST_SUCCESS,
              DEATH_GRIP,
              "Death Grip",
              30,
              ME,
              FOE,
            ),
          ] as never,
        }),
        dk({ spellCastEvents: [] }),
      ),
    );
    expect(text).not.toContain("[GRIP]");
  });
});

describe("[KICK]: the owner's kick that stopped nothing (B7a)", () => {
  const COUNTER_SHOT = "147362";
  const HEX = "51514";
  const kickAt = (s: number) =>
    ev(LogEvent.SPELL_CAST_SUCCESS, COUNTER_SHOT, "Counter Shot", s, ME, FOE);
  const castStart = (spellId: string, name: string, s: number) =>
    ev(LogEvent.SPELL_CAST_START, spellId, name, s, FOE, FOE);
  const foe = (over: Partial<ICombatUnit> = {}) =>
    mkUnit("e", "Enemy-Realm", {
      reaction: CombatUnitReaction.Hostile,
      info: {} as never,
      ...over,
    });
  const kickLine = (text: string) =>
    text.split("\n").find((l) => l.includes("[KICK]   your ")) ?? "";

  it("beaten by a teammate's interrupt a moment earlier (1b930c17 1:36)", () => {
    const mate = mkUnit("m", "Mate-Realm");
    const owner = mkUnit("o", "Me-Realm", {
      info: {} as never,
      spellCastEvents: [kickAt(96.075)] as never,
    });
    const enemy = foe({
      castStartEvents: [castStart(HEX, "Hex", 95.2)] as never,
      actionIn: [
        ev(
          LogEvent.SPELL_INTERRUPT,
          "57994",
          "Wind Shear",
          96.01,
          ["m", "Mate-Realm"],
          FOE,
          {
            extraSpellId: HEX,
            extraSpellName: "Hex",
          },
        ),
      ] as never,
    });
    const line = kickLine(
      buildMatchTimeline(params(owner, enemy, { friends: [owner, mate] })),
    );
    expect(line).toMatch(
      /^1:36 {2}\[KICK\] {3}your Counter Shot on .+ — hit nothing — .+'s Wind Shear had interrupted the Hex under 0\.1s earlier$/,
    );
  });

  it("juked by a fake cast, and plain 'hit nothing' when the log shows no reason", () => {
    const owner = () =>
      mkUnit("o", "Me-Realm", {
        info: {} as never,
        spellCastEvents: [kickAt(40)] as never,
      });
    const juked = kickLine(
      buildMatchTimeline(
        params(
          owner(),
          foe({ castStartEvents: [castStart(HEX, "Hex", 39)] as never }),
        ),
      ),
    );
    expect(juked).toContain("your Counter Shot on ");
    expect(juked).toContain(" — JUKED by fake Hex");
    const nothing = kickLine(
      buildMatchTimeline(
        params(
          owner(),
          // cast-start data exists, but nothing was open at the kick
          foe({ castStartEvents: [castStart(HEX, "Hex", 5)] as never }),
        ),
      ),
    );
    expect(nothing.endsWith(" — hit nothing")).toBe(true);
  });

  it("a landed kick keeps its own line and gets no second one", () => {
    const owner = mkUnit("o", "Me-Realm", {
      info: {} as never,
      spellCastEvents: [kickAt(40)] as never,
    });
    const enemy = foe({
      castStartEvents: [castStart(HEX, "Hex", 39)] as never,
      actionIn: [
        ev(
          LogEvent.SPELL_INTERRUPT,
          COUNTER_SHOT,
          "Counter Shot",
          40,
          ME,
          FOE,
          {
            extraSpellId: HEX,
            extraSpellName: "Hex",
          },
        ),
      ] as never,
    });
    const text = buildMatchTimeline(params(owner, enemy));
    expect(text).toContain("interrupted");
    expect(kickLine(text)).toBe("");
  });
});
