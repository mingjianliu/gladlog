/**
 * B-tier timeline rows (user rulings 2026-10-06) — facts only:
 *  - B17a: `[IMMUNE]` on our team's control says why when the log shows it —
 *    an immunity aura (already), our own team's Cyclone on the target, or
 *    diminishing returns at immune (the DR engine's chain walk); nothing is
 *    added when none of the three is found;
 *  - B17b-U8: an enemy Death Grip on a player of our team gets a `[GRIP]`
 *    line (a displacement with no aura had no line);
 *  - B7a: the owner's kick that stopped nothing gets a `[KICK]` line with the
 *    kick audit's result;
 *  - B15a step 2 (D10): the owner's Death Pact press line says what its heal
 *    absorb ate, and a death under it quotes that in the death block;
 *  - B18 (D10): a Guardian Spirit press line says when its save triggered.
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

describe("Death Pact: the press line and the death block say what the heal absorb ate (B15a step 2)", () => {
  const DEATH_PACT = "48743";
  const pact = (pressS: number): any => ({
    spellId: DEATH_PACT,
    spellName: "Death Pact",
    tag: "Defensive",
    cooldownSeconds: 120,
    maxChargesDetected: 1,
    casts: [{ timeSeconds: pressS }],
    availableWindows: [],
    neverUsed: false,
  });
  const dkOwner = (opts: { removedS?: number; deathS?: number }) =>
    mkUnit("o", "Me-Realm", {
      info: {} as never,
      class: CombatUnitClass.DeathKnight,
      spec: CombatUnitSpec.DeathKnight_Frost,
      spellCastEvents: [
        ev(LogEvent.SPELL_CAST_SUCCESS, DEATH_PACT, "Death Pact", 62, ME, ME),
      ] as never,
      auraEvents: [
        ev(LogEvent.SPELL_AURA_APPLIED, DEATH_PACT, "Death Pact", 62, ME, ME, {
          amount: 283_511,
        }),
        ...(opts.removedS === undefined
          ? []
          : [
              ev(
                LogEvent.SPELL_AURA_REMOVED,
                DEATH_PACT,
                "Death Pact",
                opts.removedS,
                ME,
                ME,
              ),
            ]),
      ] as never,
      healIn: [
        ev(LogEvent.SPELL_HEAL, DEATH_PACT, "Death Pact", 62, ME, ME, {
          amount: 425_000,
          effectiveAmount: 425_000,
        }),
      ] as never,
      healAbsorbsIn: [
        {
          absorbSpellId: DEATH_PACT,
          timestamp: at(64),
          healerId: "o",
          absorbedAmount: 200_000,
        },
      ] as never,
      deathRecords: (opts.deathS === undefined
        ? []
        : [{ timestamp: at(opts.deathS) }]) as never,
    });
  const foe = () =>
    mkUnit("e", "Enemy-Realm", { reaction: CombatUnitReaction.Hostile });
  const pressLine = (text: string) =>
    text.split("\n").find((l) => l.includes("[YOU] [CD]")) ?? "";

  it("the press line carries the clause, ahead of the dampening note", () => {
    const text = buildMatchTimeline(
      params(dkOwner({ removedS: 77 }), foe(), {
        ownerSpec: "DeathKnight_Frost",
        ownerCDs: [pact(62)],
      }),
    );
    const line = pressLine(text);
    expect(line).toContain("Death Pact");
    expect(line).toContain(
      " | healed 425k · heal absorb 284k: ate 200k of healing (1 heal — own 200k) · ended at 1:17 with 84k unspent",
    );
    expect(text).not.toContain("Heal absorb: own Death Pact");
    // its aura is the heal absorb, not a buff: no [BUFF FADED] line for it
    expect(text).not.toContain("[BUFF FADED]   Death Pact");
  });

  it("a death under the absorb: the press line says so and the death block quotes it", () => {
    const text = buildMatchTimeline(
      params(dkOwner({ deathS: 70 }), foe(), {
        ownerSpec: "DeathKnight_Frost",
        ownerCDs: [pact(62)],
        friendlyDeaths: [
          { spec: "Frost Death Knight", name: "Me-Realm", atSeconds: 70 },
        ],
      }),
    );
    expect(pressLine(text)).toContain(
      "ate 200k of healing (1 heal — own 200k) through 1:10 · no healing landed after the press · 84k of it unspent at death",
    );
    const quoted = text
      .split("\n")
      .find((l) => l.includes("Heal absorb: own Death Pact"));
    expect(quoted).toBeDefined();
    expect(quoted).toContain("(pressed 1:02) ate 200k of the healing aimed at");
    expect(quoted).toContain("healing that landed after 1:02: 0");
  });
});

describe("Guardian Spirit: the press line says when the save triggered (B18)", () => {
  const GS = "47788";
  const PRIEST: [string, string] = ["p", "Priest-Realm"];
  const gsLedger = (pressS: number): any => ({
    spellId: GS,
    spellName: "Guardian Spirit",
    tag: "External",
    cooldownSeconds: 180,
    maxChargesDetected: 1,
    casts: [{ timeSeconds: pressS, targetName: "Me-Realm" }],
    availableWindows: [],
    neverUsed: false,
  });
  const priest = (saveS?: number) =>
    mkUnit("p", "Priest-Realm", {
      info: {} as never,
      class: CombatUnitClass.Priest,
      spec: CombatUnitSpec.Priest_Holy,
      healOut: (saveS === undefined
        ? []
        : [
            ev(
              LogEvent.SPELL_HEAL,
              "48153",
              "Guardian Spirit",
              saveS,
              PRIEST,
              ME,
              {
                amount: 352_625,
                effectiveAmount: 352_625,
              },
            ),
          ]) as never,
    });
  const run = (saveS?: number) => {
    const owner = mkUnit("o", "Me-Realm", { info: {} as never });
    const mate = priest(saveS);
    return buildMatchTimeline(
      params(
        owner,
        mkUnit("e", "Enemy-Realm", { reaction: CombatUnitReaction.Hostile }),
        {
          friends: [owner, mate],
          teammateCDs: [
            { player: mate, spec: "Holy Priest", cds: [gsLedger(132.213)] },
          ] as never,
          matchEndMs: at(200),
        },
      ),
    );
  };
  const teamLine = (text: string) =>
    text.split("\n").find((l) => l.includes("[TEAM] [CD]")) ?? "";

  it("triggered: the clause on the [TEAM] [CD] line, and the legend", () => {
    const text = run(132.715);
    expect(teamLine(text)).toContain("Guardian Spirit");
    expect(teamLine(text)).toContain(
      " | save triggered 0.5s later (2:12): a killing blow was prevented, healed 353k",
    );
    expect(text).toContain(
      "`| save triggered Ns later (m:ss)` on a Guardian Spirit line",
    );
  });

  it("an ENEMY priest's Guardian Spirit on themselves (a self-save line) carries the clause too", () => {
    const FOE_PRIEST: [string, string] = ["e", "Enemy-Realm"];
    const enemyPriest = mkUnit("e", "Enemy-Realm", {
      info: {} as never,
      reaction: CombatUnitReaction.Hostile,
      class: CombatUnitClass.Priest,
      spec: CombatUnitSpec.Priest_Holy,
      spellCastEvents: [
        ev(
          LogEvent.SPELL_CAST_SUCCESS,
          GS,
          "Guardian Spirit",
          60,
          FOE_PRIEST,
          FOE_PRIEST,
        ),
      ] as never,
      healOut: [
        ev(
          LogEvent.SPELL_HEAL,
          "48153",
          "Guardian Spirit",
          62.4,
          FOE_PRIEST,
          FOE_PRIEST,
          { amount: 300_000, effectiveAmount: 300_000 },
        ),
      ] as never,
    });
    const owner = mkUnit("o", "Me-Realm", { info: {} as never });
    const text = buildMatchTimeline(
      params(owner, enemyPriest, { matchEndMs: at(200) }),
    );
    const line =
      text.split("\n").find((l) => /^\d+:\d\d {2}\[ENEMY DEF\]/.test(l)) ?? "";
    expect(line).toContain("Guardian Spirit (self-save)");
    expect(line).toContain(
      " | save triggered 2.4s later (1:02): a killing blow was prevented, healed 300k",
    );
  });

  it("not triggered: the line is as before and there is no legend", () => {
    const text = run();
    expect(teamLine(text)).toContain("Guardian Spirit");
    expect(text).not.toContain("save triggered");
  });
});
