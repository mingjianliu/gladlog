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

/**
 * Triage 2026-09-29 group G3 — the cast / effect tags on `[YOU]` / `[TEAM]`
 * lines, read through the one cast → effect table (`castEffectAuras.ts`):
 *  - enemy-def F-E25b: an IMMUNE logged under the cast's effect id (Storm Bolt
 *    107570 → 132169) tags the cast line;
 *  - enemy-def F-E26: on a line that names its targets, an IMMUNE on a player
 *    the line does not name is said with that player's label; one on an
 *    unnamed non-player says nothing;
 *  - enemy-def F-E25a: a non-CC press into an immunity is tagged too;
 *  - cc-dr F-TM1: a teammate's CC that MISSed says so on its `[TEAM] [CC]`;
 *  - crisis-external F-T1: a teammate's press on another friendly names it;
 *  - cc-dr F-NE1: an aimed CC with no aura and no miss says `[no CC aura
 *    logged]`.
 */

beforeAll(async () => {
  await ensureAnalysisData();
});

const STORM_BOLT = "107570";
const STORM_BOLT_STUN = "132169";
const GRAPPLE_WEAPON = "233759";
const HAMMER_OF_JUSTICE = "853";

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
    class: CombatUnitClass.Warrior,
    spec: CombatUnitSpec.Warrior_Arms,
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

const ev = (
  event: LogEvent,
  spellId: string,
  t: number,
  src: [string, string],
  dest: [string, string],
  extra: Record<string, unknown> = {},
) => ({
  spellId,
  spellName: spellId,
  timestamp: t,
  srcUnitFlags: 0,
  destUnitFlags: 0,
  srcUnitId: src[0],
  srcUnitName: src[1],
  destUnitId: dest[0],
  destUnitName: dest[1],
  logLine: { event, timestamp: t, parameters: [] },
  ...extra,
});
const ME: [string, string] = ["o", "Me-Realm"];
const MATE: [string, string] = ["m", "Mate-Realm"];
const ENEMY: [string, string] = ["e", "Enemy-Realm"];
const OTHER: [string, string] = ["e2", "Other-Realm"];
const miss = (
  spellId: string,
  t: number,
  src: [string, string],
  dest: [string, string],
  missType = "IMMUNE",
) => ev(LogEvent.SPELL_MISSED, spellId, t, src, dest, { missType, amount: 0 });

const ledger = (
  spellId: string,
  spellName: string,
  tag: string,
  timeSeconds: number,
  targetName?: string,
) => ({
  spellId,
  spellName,
  tag,
  cooldownSeconds: 30,
  maxChargesDetected: 1,
  casts: [{ timeSeconds, ...(targetName ? { targetName } : {}) }],
  availableWindows: [],
  neverUsed: false,
});

function params(
  owner: ICombatUnit,
  enemies: ICombatUnit[],
  extra: Partial<BuildMatchTimelineParams> = {},
): BuildMatchTimelineParams {
  return {
    owner,
    ownerSpec: "Arms Warrior",
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
    enemies,
    matchStartMs: 0,
    matchEndMs: 120_000,
    isHealer: false,
    criticalWindowSeconds: new Set<number>(),
    ...extra,
  };
}
const hostile = (u: [string, string], o: Partial<ICombatUnit> = {}) =>
  mkUnit(u[0], u[1], { reaction: CombatUnitReaction.Hostile, ...o });
const lineWith = (timeline: string, needle: string) =>
  timeline.split("\n").find((l) => l.includes(needle)) ?? "";

describe("F-E25b — an IMMUNE logged under the effect id tags the cast", () => {
  it("483f7433: Storm Bolt's IMMUNE is the stun 132169", () => {
    const owner = mkUnit(ME[0], ME[1], {
      missesOut: [miss(STORM_BOLT_STUN, 29_999, ME, ENEMY)] as never,
    });
    const t = buildMatchTimeline(
      params(owner, [hostile(ENEMY)], {
        ownerCDs: [
          ledger(STORM_BOLT, "Storm Bolt", "CC", 30, ENEMY[1]),
        ] as never,
      }),
    );
    expect(lineWith(t, "Storm Bolt")).toContain("[IMMUNE]");
  });
});

describe("F-E26 — the tag reads only the units the line names", () => {
  const cc = ledger(STORM_BOLT, "Storm Bolt", "CC", 30, ENEMY[1]);
  it("an IMMUNE on a player the line does not name is said with that player's label", () => {
    const owner = mkUnit(ME[0], ME[1], {
      missesOut: [miss(STORM_BOLT_STUN, 30_000, ME, OTHER)] as never,
    });
    const t = buildMatchTimeline(
      params(owner, [hostile(ENEMY), hostile(OTHER)], {
        ownerCDs: [cc] as never,
      }),
    );
    expect(lineWith(t, "Storm Bolt")).toContain("[IMMUNE: Other]");
  });
  it("an IMMUNE on the named target stays the bare tag", () => {
    const owner = mkUnit(ME[0], ME[1], {
      missesOut: [miss(STORM_BOLT_STUN, 30_000, ME, ENEMY)] as never,
    });
    const t = buildMatchTimeline(
      params(owner, [hostile(ENEMY), hostile(OTHER)], {
        ownerCDs: [cc] as never,
      }),
    );
    expect(lineWith(t, "Storm Bolt")).toContain("[IMMUNE]");
    expect(lineWith(t, "Storm Bolt")).not.toContain("[IMMUNE:");
  });
});

describe("F-E25a — a non-CC press into an immunity is tagged", () => {
  it("2abc9185: Grapple Weapon into Bladestorm", () => {
    const owner = mkUnit(ME[0], ME[1], {
      missesOut: [miss(GRAPPLE_WEAPON, 30_066, ME, ENEMY)] as never,
    });
    const t = buildMatchTimeline(
      params(owner, [hostile(ENEMY)], {
        ownerCDs: [
          ledger(GRAPPLE_WEAPON, "Grapple Weapon", "Control", 30, ENEMY[1]),
        ] as never,
      }),
    );
    const line = lineWith(t, "Grapple Weapon");
    expect(line).toContain("[YOU] [CD]");
    expect(line).toContain("[IMMUNE");
  });
});

describe("F-TM1 / F-T1 — teammate lines", () => {
  it("a teammate's CC that MISSed says so (95127ab4 Maim; the MISS is logged under the stun 203123)", () => {
    const owner = mkUnit(ME[0], ME[1]);
    const mate = mkUnit(MATE[0], MATE[1], {
      class: CombatUnitClass.Druid,
      spec: CombatUnitSpec.Druid_Feral,
      missesOut: [miss("203123", 14_305, MATE, ENEMY, "MISS")] as never,
    });
    const t = buildMatchTimeline(
      params(owner, [hostile(ENEMY)], {
        friends: [owner, mate],
        teammateCDs: [
          {
            player: mate,
            spec: "Feral Druid",
            cds: [ledger("22570", "Maim", "CC", 14.306, ENEMY[1])] as never,
          },
        ],
      }),
    );
    expect(lineWith(t, "cast Maim")).toContain("[MISSED on");
  });

  it("a teammate's external on another friendly names the recipient; on itself it does not", () => {
    const owner = mkUnit(ME[0], ME[1]);
    const mate = mkUnit(MATE[0], MATE[1], {
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Retribution,
    });
    const playerIdMap = new Map([
      [ME[1], 1],
      [MATE[1], 2],
    ]);
    const t = buildMatchTimeline(
      params(owner, [hostile(ENEMY)], {
        friends: [owner, mate],
        playerIdMap,
        teammateCDs: [
          {
            player: mate,
            spec: "Retribution Paladin",
            cds: [
              ledger("6940", "Blessing of Sacrifice", "Defensive", 48, ME[1]),
              ledger("642", "Divine Shield", "Defensive", 60, MATE[1]),
            ] as never,
          },
        ],
      }),
    );
    expect(lineWith(t, "Blessing of Sacrifice")).toMatch(
      /Blessing of Sacrifice → 1\b/,
    );
    expect(lineWith(t, "Divine Shield")).not.toContain("→");
  });
});

describe("F-NE1 — an aimed CC with no aura and no miss", () => {
  const hoj = ledger(
    HAMMER_OF_JUSTICE,
    "Hammer of Justice",
    "CC",
    120 / 1,
    ENEMY[1],
  );
  it("69546267: says `[no CC aura logged]`", () => {
    const castEvent = ev(
      LogEvent.SPELL_CAST_SUCCESS,
      HAMMER_OF_JUSTICE,
      30_000,
      ME,
      ENEMY,
    );
    const owner = mkUnit(ME[0], ME[1], {
      spellCastEvents: [castEvent] as never,
    });
    const t = buildMatchTimeline(
      params(owner, [hostile(ENEMY)], {
        ownerCDs: [
          { ...hoj, casts: [{ timeSeconds: 30, targetName: ENEMY[1] }] },
        ] as never,
      }),
    );
    expect(lineWith(t, "Hammer of Justice")).toContain("[no CC aura logged]");
  });
  it("control: the stun landed → no tag", () => {
    const castEvent = ev(
      LogEvent.SPELL_CAST_SUCCESS,
      HAMMER_OF_JUSTICE,
      30_000,
      ME,
      ENEMY,
    );
    const owner = mkUnit(ME[0], ME[1], {
      spellCastEvents: [castEvent] as never,
    });
    const enemy = hostile(ENEMY, {
      auraEvents: [
        ev(LogEvent.SPELL_AURA_APPLIED, HAMMER_OF_JUSTICE, 30_010, ME, ENEMY, {
          auraType: "DEBUFF",
        }),
      ] as never,
    });
    const t = buildMatchTimeline(
      params(owner, [enemy], {
        ownerCDs: [
          { ...hoj, casts: [{ timeSeconds: 30, targetName: ENEMY[1] }] },
        ] as never,
      }),
    );
    expect(lineWith(t, "Hammer of Justice")).not.toContain("[no CC aura");
  });
  it("the healer cast gap-filler path says it too (codex 35-CD-07)", () => {
    // a healer's Cyclone that is not a ledger cooldown renders through
    // healerCastGapFiller, not ownerCd
    const CYCLONE = "33786";
    const owner = mkUnit(ME[0], ME[1], {
      class: CombatUnitClass.Druid,
      spec: CombatUnitSpec.Druid_Restoration,
      spellCastEvents: [
        ev(LogEvent.SPELL_CAST_SUCCESS, CYCLONE, 30_000, ME, ENEMY),
      ] as never,
    });
    const t = buildMatchTimeline(
      params(owner, [hostile(ENEMY)], {
        isHealer: true,
        ownerSpec: "Restoration Druid",
      }),
    );
    expect(lineWith(t, "[YOU] [CC]")).toContain("[no CC aura logged]");
  });
});
