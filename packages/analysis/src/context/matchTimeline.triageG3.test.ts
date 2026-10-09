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
import { OWNER_AOE_CC_NO_PLAYER_TAG } from "../utils/drAnalysis";
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

describe("FT-T14 — an un-aimed area control that hit no enemy player says so", () => {
  const PSYCHIC_SCREAM = "8122";
  const DRAGONS_BREATH = "31661";
  const PET: [string, string] = [
    "Pet-0-3878-2509-35306-26125-020560C99D",
    "Mudflayer",
  ];
  const scream = ledger(PSYCHIC_SCREAM, "Psychic Scream", "CC", 30);
  const render = (
    ownerOver: Partial<ICombatUnit>,
    enemies: ICombatUnit[],
    cd = scream,
  ) =>
    buildMatchTimeline(
      params(
        mkUnit(ME[0], ME[1], {
          spellCastEvents: [
            ev(LogEvent.SPELL_CAST_SUCCESS, cd.spellId, 69_537, ME, ["", ""]),
          ] as never,
          ...ownerOver,
        }),
        enemies,
        { ownerCDs: [{ ...cd, casts: [{ timeSeconds: 69.537 }] }] as never },
      ),
    );

  it("5677ba13 1:09: 只扫到免疫的宠物,没有玩家 → [hit no enemy player]", () => {
    const t = render(
      {
        missesOut: [miss(PSYCHIC_SCREAM, 69_537, ME, PET)] as never,
      },
      [hostile(ENEMY), hostile(OTHER)],
    );
    const line = lineWith(t, "Psychic Scream");
    expect(line).toContain(`[YOU] [CC]   Psychic Scream`);
    expect(line).toContain(OWNER_AOE_CC_NO_PLAYER_TAG);
    expect(line).not.toContain("[IMMUNE");
  });

  it("日志里什么都没记(没光环、没 miss)也是没碰到玩家", () => {
    const t = render({}, [hostile(ENEMY), hostile(OTHER)]);
    expect(lineWith(t, "Psychic Scream")).toContain(OWNER_AOE_CC_NO_PLAYER_TAG);
  });

  it("有一个敌方玩家中了(窗口内的光环)→ 不标", () => {
    const feared = hostile(OTHER, {
      auraEvents: [
        ev(LogEvent.SPELL_AURA_APPLIED, PSYCHIC_SCREAM, 69_540, ME, OTHER, {
          auraType: "DEBUFF",
        }),
      ] as never,
    });
    const t = render({}, [hostile(ENEMY), feared]);
    expect(lineWith(t, "Psychic Scream")).not.toContain("[hit no enemy");
  });

  it("玩家身上的 miss(免疫 / 未命中)归原来的标签说,这里不标", () => {
    const t = render(
      { missesOut: [miss(PSYCHIC_SCREAM, 69_537, ME, ENEMY)] as never },
      [hostile(ENEMY), hostile(OTHER)],
    );
    expect(lineWith(t, "Psychic Scream")).not.toContain("[hit no enemy");
  });

  it("别的法术落在敌方玩家身上(一秒后的 Fear、被盾吸掉的 DoT)不算这次群控的落点:照标", () => {
    const FEAR = "5782";
    const SW_PAIN = "589";
    const feared = hostile(OTHER, {
      auraEvents: [
        ev(LogEvent.SPELL_AURA_APPLIED, FEAR, 70_500, ME, OTHER, {
          auraType: "DEBUFF",
        }),
      ] as never,
    });
    const t = render(
      { missesOut: [miss(SW_PAIN, 70_000, ME, ENEMY, "ABSORB")] as never },
      [hostile(ENEMY), feared],
    );
    expect(lineWith(t, "Psychic Scream")).toContain(OWNER_AOE_CC_NO_PLAYER_TAG);
  });

  it("延迟生效的 Sigil of Misery(施放 207684 → 光环 207685,约 2 秒后)不在窗口里判「没打到」:不标", () => {
    const t = render(
      {},
      [hostile(ENEMY)],
      ledger("207684", "Sigil of Misery", "CC", 30),
    );
    expect(lineWith(t, "Sigil of Misery")).not.toContain("[hit no enemy");
  });

  it("FT-T14c: Dragon's Breath 现在在名单里 —— 没碰到玩家照标;名单外的群控(Capacitor Totem)仍不标", () => {
    const t = render(
      {},
      [hostile(ENEMY)],
      ledger(DRAGONS_BREATH, "Dragon's Breath", "CC", 30),
    );
    expect(lineWith(t, "Dragon's Breath")).toContain(
      OWNER_AOE_CC_NO_PLAYER_TAG,
    );
    const totem = render(
      {},
      [hostile(ENEMY)],
      ledger("192058", "Capacitor Totem", "CC", 30),
    );
    expect(lineWith(totem, "Capacitor Totem")).not.toContain("[hit no enemy");
  });

  it("FT-T14c: Shockwave(施放 46968,昏迷光环 132168)—— 光环 id 在名单里;中了人不标,没中标", () => {
    const SHOCKWAVE = "46968";
    const stunned = hostile(OTHER, {
      auraEvents: [
        ev(LogEvent.SPELL_AURA_APPLIED, "132168", 69_640, ME, OTHER, {
          auraType: "DEBUFF",
        }),
      ] as never,
    });
    const cdSw = ledger(SHOCKWAVE, "Shockwave", "CC", 30);
    expect(
      lineWith(render({}, [hostile(ENEMY), stunned], cdSw), "Shockwave"),
    ).not.toContain("[hit no enemy");
    expect(
      lineWith(render({}, [hostile(ENEMY), hostile(OTHER)], cdSw), "Shockwave"),
    ).toContain(OWNER_AOE_CC_NO_PLAYER_TAG);
  });
});

describe("cc-dr F-DA1 — the [DISARM] legend counts only printed lines (codex 35-CD-15)", () => {
  const summary = (atSeconds: number) => ({
    playerName: ME[1],
    trinketUseTimes: [],
    ccInstances: [],
    disarmInstances: [
      {
        atSeconds,
        durationSeconds: 4,
        spellId: "236077",
        spellName: "Disarm",
        sourceName: ENEMY[1],
        sourceId: ENEMY[0],
        sourceSpec: "Arms Warrior",
      },
    ],
  });
  const render = (atSeconds: number) =>
    buildMatchTimeline(
      params(mkUnit(ME[0], ME[1]), [hostile(ENEMY)], {
        matchEndMs: 60_000,
        ccTrinketSummaries: [summary(atSeconds)] as never,
      }),
    );
  it("a disarm past the match end prints neither the line nor the legend", () => {
    const t = render(61);
    expect(t).not.toContain("[DISARM]   ");
    expect(t).not.toContain("[DISARM] = ");
  });
  it("control: a disarm inside the match prints both", () => {
    const t = render(30);
    expect(t).toContain("[DISARM]   ");
    expect(t).toContain("[DISARM] = ");
  });
});

describe("cc-dr F-AO1 — an AoE CC line gives the DR per target when it differs", () => {
  const ENEMY2: [string, string] = ["e2", "Second-Realm"];
  const app = (atSeconds: number, level: string, casterName = ME[1]) => ({
    atSeconds,
    durationSeconds: 8,
    spellId: "8122",
    spellName: "Psychic Scream",
    casterName,
    casterSpec: "Discipline Priest",
    drInfo: { category: "Disorient", level, sequenceIndex: 0 },
  });
  const chains = (l1: string, l2: string, caster2 = ME[1]) => [
    {
      targetName: ENEMY[1],
      targetSpec: "Arms Warrior",
      applications: [app(30.1, l1)],
    },
    {
      targetName: ENEMY2[1],
      targetSpec: "Holy Priest",
      applications: [app(30.1, l2, caster2)],
    },
  ];
  const render = (c: unknown) =>
    lineWith(
      buildMatchTimeline(
        params(mkUnit(ME[0], ME[1]), [hostile(ENEMY), hostile(ENEMY2)], {
          ownerCDs: [ledger("8122", "Psychic Scream", "CC", 30.1)] as never,
          outgoingCCChains: c as never,
        }),
      ),
      "Psychic Scream",
    );

  it("537209d8 shape: different levels → per-target enemy labels", () => {
    const line = render(chains("50%", "Full"));
    expect(line).toMatch(/\[DR: Disorient — \S+ 50%, \S+ Full\]/);
    expect(line).not.toContain("Enemy-Realm");
  });
  it("one level → the single form", () => {
    expect(render(chains("Full", "Full"))).toContain("[DR: Disorient Full]");
  });
  it("another caster's same spell at that second does not count", () => {
    expect(render(chains("Full", "50%", "Mate-Realm"))).toContain(
      "[DR: Disorient Full]",
    );
  });
});

describe("cc-dr F-CE1 — [CC ON ENEMY] prints the outgoing chain's DR", () => {
  const ccInst = (spellId: string, spellName: string) => ({
    atSeconds: 100.86,
    durationSeconds: 2,
    spellId,
    spellName,
    sourceName: MATE[1],
    sourceId: MATE[0],
    sourceSpec: "Outlaw Rogue",
    trinketState: "none",
  });
  const render = (spellId: string, spellName: string) =>
    lineWith(
      buildMatchTimeline(
        params(mkUnit(ME[0], ME[1]), [hostile(ENEMY)], {
          friends: [mkUnit(ME[0], ME[1]), mkUnit(MATE[0], MATE[1])],
          enemyCCSummaries: [
            {
              playerName: ENEMY[1],
              trinketUseTimes: [],
              ccInstances: [ccInst(spellId, spellName)],
              disarmInstances: [],
            },
          ] as never,
          outgoingCCChains: [
            {
              targetName: ENEMY[1],
              targetSpec: "Arms Warrior",
              applications: [
                {
                  atSeconds: 100.86,
                  durationSeconds: 2,
                  spellId: "1833",
                  spellName: "Cheap Shot",
                  casterName: MATE[1],
                  casterSpec: "Outlaw Rogue",
                  drInfo: { category: "Stun", level: "50%", sequenceIndex: 1 },
                },
              ],
            },
          ] as never,
        }),
      ),
      "[CC ON ENEMY]",
    );
  it("483f7433 shape: Cheap Shot at 50 % says so", () => {
    expect(render("1833", "Cheap Shot")).toMatch(/\(2s\) \[DR: Stun 50%\]$/);
  });
  it("a landing with no chain application (a backlash aura) has no tag", () => {
    expect(render("196364", "Unstable Affliction")).not.toContain("[DR:");
  });
});
