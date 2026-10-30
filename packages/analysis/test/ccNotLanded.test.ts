import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src";
import {
  buildMatchTimeline,
  type BuildMatchTimelineParams,
} from "../src/context/matchTimeline";
import {
  CC_NOT_LANDED_LEGEND,
  CC_NOT_LANDED_TAG,
} from "../src/context/timelineSections/setup";
import { CONTROL_FAILED_MISS_TYPES } from "../src/utils/castMissRows";

// FT-T16 D15 "3b" (user approval 2026-10-10): a control by our team that the
// log says did not land on an enemy player, and that no other line states,
// gets a `[CC NOT LANDED]` line — both directions of "no other line states".

const POLYMORPH = "118";
const CYCLONE = "33786";
const PSYCHIC_SCREAM = "8122";
const DIVINE_SHIELD = "642";
const FIREBALL = "133";
const END_MS = 120_000;

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
    class: CombatUnitClass.Mage,
    spec: CombatUnitSpec.Mage_Frost,
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
const NAME: Record<string, string> = {
  o: "Me-Realm",
  m: "Mate-Realm",
  e: "Enemy-Realm",
  e2: "Other-Realm",
  pet: "Felhunter",
};
const row = (
  event: LogEvent,
  spellId: string,
  spellName: string,
  t: number,
  src: string,
  dest: string,
) => ({
  spellId,
  spellName,
  timestamp: t,
  srcUnitFlags: 0,
  destUnitFlags: 0,
  srcUnitId: src,
  srcUnitName: NAME[src] ?? src,
  destUnitId: dest,
  destUnitName: NAME[dest] ?? dest,
  logLine: { event, timestamp: t, parameters: [] },
});
const miss = (
  spellId: string,
  spellName: string,
  t: number,
  src: string,
  dest: string,
  missType = "IMMUNE",
) => ({
  ...row(LogEvent.SPELL_MISSED, spellId, spellName, t, src, dest),
  missType,
  amount: 0,
});
const cast = (
  spellId: string,
  spellName: string,
  t: number,
  src: string,
  dest: string,
) => row(LogEvent.SPELL_CAST_SUCCESS, spellId, spellName, t, src, dest);
const aura = (
  event: LogEvent,
  spellId: string,
  spellName: string,
  t: number,
  src: string,
  dest: string,
) => ({
  ...row(event, spellId, spellName, t, src, dest),
  auraType: "BUFF" as const,
});

function timelineOf(opts: {
  owner?: Partial<ICombatUnit>;
  mate?: Partial<ICombatUnit>;
  enemy?: Partial<ICombatUnit>;
  enemy2?: Partial<ICombatUnit>;
  isHealer?: boolean;
  ownerCDs?: BuildMatchTimelineParams["ownerCDs"];
  enemyCCSummaries?: unknown;
  /** more units (an owner's pet) */
  extra?: ICombatUnit[];
}): string[] {
  const owner = mkUnit("o", NAME.o!, opts.owner);
  const mate = mkUnit("m", NAME.m!, opts.mate);
  const enemy = mkUnit("e", NAME.e!, {
    reaction: CombatUnitReaction.Hostile,
    ...opts.enemy,
  });
  const enemy2 = mkUnit("e2", NAME.e2!, {
    reaction: CombatUnitReaction.Hostile,
    ...opts.enemy2,
  });
  const params: BuildMatchTimelineParams = {
    owner,
    ownerSpec: "Mage_Frost",
    ownerCDs: opts.ownerCDs ?? [],
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
    enemyCCSummaries: opts.enemyCCSummaries as never,
    friendlyDeaths: [],
    enemyDeaths: [],
    pressureWindows: [],
    healingGaps: [],
    friends: [owner, mate],
    enemies: [enemy, enemy2],
    allUnits: [owner, mate, enemy, enemy2, ...(opts.extra ?? [])],
    matchStartMs: 0,
    matchEndMs: END_MS,
    isHealer: opts.isHealer ?? false,
    criticalWindowSeconds: new Set<number>(),
  };
  return buildMatchTimeline(params).split("\n");
}
const notLanded = (lines: string[]) =>
  lines.filter((l) => /^\d+:\d{2}\s+\[CC NOT LANDED\]/.test(l));

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("[CC NOT LANDED] — a failed control no other line states", () => {
  it("the owner's control with no cast line: the log's type, and the cause when the log shows one", () => {
    // a DPS owner's Polymorph is on no cooldown ledger and has no cast line
    const lines = timelineOf({
      owner: {
        spellCastEvents: [cast(POLYMORPH, "Polymorph", 30_000, "o", "e")],
        missesOut: [miss(POLYMORPH, "Polymorph", 30_900, "o", "e")],
      } as never,
      enemy: {
        auraEvents: [
          aura(
            LogEvent.SPELL_AURA_APPLIED,
            DIVINE_SHIELD,
            "Divine Shield",
            28_000,
            "e",
            "e",
          ),
        ],
      } as never,
    });
    expect(lines.some((l) => l.includes("[YOU] [CC]"))).toBe(false);
    expect(notLanded(lines)).toEqual([
      "0:30  [CC NOT LANDED]   Enemy ← Polymorph (by Me) — logged IMMUNE (Divine Shield was up)",
    ]);
    // the legend, once
    expect(lines.filter((l) => l === CC_NOT_LANDED_LEGEND[0])).toHaveLength(1);
  });

  it("no parenthesis when the log shows no cause; a teammate's control is stated too", () => {
    const lines = timelineOf({
      mate: {
        spellCastEvents: [cast(CYCLONE, "Cyclone", 19_000, "m", "e2")],
        missesOut: [miss(CYCLONE, "Cyclone", 19_003, "m", "e2", "MISS")],
      } as never,
    });
    expect(notLanded(lines)).toEqual([
      "0:19  [CC NOT LANDED]   Other ← Cyclone (by Mate) — logged MISS",
    ]);
  });

  it("a MISS takes the cause the avoidance sweep found for that cast", () => {
    const lines = timelineOf({
      mate: {
        spellCastEvents: [cast(CYCLONE, "Cyclone", 19_000, "m", "e2")],
        missesOut: [miss(CYCLONE, "Cyclone", 19_003, "m", "e2", "MISS")],
      } as never,
      enemyCCSummaries: [
        {
          playerName: NAME.e2,
          playerSpec: "Holy Priest",
          ccInstances: [],
          ccAvoidedInstances: [
            {
              atSeconds: 19,
              spellId: CYCLONE,
              spellName: "Cyclone",
              sourceName: NAME.m,
              sourceId: "m",
              avoidanceSpellName: "Phase Shift",
            },
          ],
          trinketUseTimes: [],
          missedTrinketWindows: [],
        },
      ],
    });
    expect(notLanded(lines)).toEqual([
      "0:19  [CC NOT LANDED]   Other ← Cyclone (by Mate) — logged MISS (Phase Shift was up)",
    ]);
  });

  it("our own team's Cyclone on the target is the cause the cast lines give", () => {
    const lines = timelineOf({
      mate: {
        missesOut: [miss(POLYMORPH, "Polymorph", 44_000, "m", "e")],
      } as never,
      enemy: {
        auraEvents: [
          aura(
            LogEvent.SPELL_AURA_APPLIED,
            CYCLONE,
            "Cyclone",
            42_000,
            "o",
            "e",
          ),
        ],
      } as never,
    });
    expect(notLanded(lines)).toEqual([
      "0:44  [CC NOT LANDED]   Enemy ← Polymorph (by Mate) — logged IMMUNE (Me's Cyclone was on the target)",
    ]);
  });

  it("a miss a [YOU] [CC] line states gets no line (and its twin row neither)", () => {
    // a healer owner's Polymorph has its cast line, which tags the IMMUNE
    const lines = timelineOf({
      isHealer: true,
      owner: {
        spellCastEvents: [cast(POLYMORPH, "Polymorph", 30_000, "o", "e")],
        missesOut: [
          miss(POLYMORPH, "Polymorph", 30_900, "o", "e"),
          // the same failure logged a second time 4 ms later
          miss(POLYMORPH, "Polymorph", 30_904, "o", "e"),
        ],
      } as never,
    });
    expect(
      lines.filter((l) => l.includes("[YOU] [CC]") && l.includes("[IMMUNE]")),
    ).toHaveLength(1);
    expect(notLanded(lines)).toEqual([]);
    expect(lines.some((l) => l.includes(CC_NOT_LANDED_TAG))).toBe(false);
  });

  it("an owner cast whose line does not state the miss gets the line", () => {
    // Psychic Scream immune on two enemy players: the cast line's one tag
    // takes one of them, the other is on no line
    const lines = timelineOf({
      owner: {
        missesOut: [
          miss(PSYCHIC_SCREAM, "Psychic Scream", 30_000, "o", "e"),
          miss(PSYCHIC_SCREAM, "Psychic Scream", 30_000, "o", "e2"),
        ],
      } as never,
      ownerCDs: [
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
      ],
    });
    const castLine = lines.filter((l) => l.includes("[YOU] [CC]"));
    expect(castLine).toHaveLength(1);
    expect(castLine[0]).toContain("[IMMUNE");
    expect(notLanded(lines)).toEqual([
      "0:30  [CC NOT LANDED]   Other ← Psychic Scream (by Me) — logged IMMUNE",
    ]);
  });

  it("one line for a failure the log wrote twice", () => {
    const lines = timelineOf({
      mate: {
        missesOut: [
          miss(CYCLONE, "Cyclone", 19_000, "m", "e", "MISS"),
          miss(CYCLONE, "Cyclone", 19_004, "m", "e", "MISS"),
        ],
      } as never,
    });
    expect(notLanded(lines)).toHaveLength(1);
  });

  it("a reflected control keeps its [REFLECTED] line and gets no second one", () => {
    const lines = timelineOf({
      mate: {
        spellCastEvents: [cast(POLYMORPH, "Polymorph", 31_500, "m", "e")],
        missesOut: [miss(POLYMORPH, "Polymorph", 31_550, "m", "e", "REFLECT")],
      } as never,
    });
    expect(lines.filter((l) => l.includes("[REFLECTED]"))).toHaveLength(1);
    expect(notLanded(lines)).toEqual([]);
  });

  it("a reflect logged under the control's EFFECT id (Lightning Lasso: cast 305483, stun 305485) gets no second line either", () => {
    const lines = timelineOf({
      mate: {
        spellCastEvents: [cast("305483", "Lightning Lasso", 31_500, "m", "e")],
        missesOut: [
          miss("305485", "Lightning Lasso", 31_550, "m", "e", "REFLECT"),
        ],
      } as never,
    });
    expect(lines.filter((l) => l.includes("[REFLECTED]"))).toHaveLength(1);
    expect(notLanded(lines)).toEqual([]);
  });

  it("no line for a control that is on the target anyway", () => {
    // the aura of that spell from that caster starts in the miss's second
    const lines = timelineOf({
      mate: {
        missesOut: [miss(POLYMORPH, "Polymorph", 30_200, "m", "e")],
      } as never,
      enemyCCSummaries: [
        {
          playerName: NAME.e,
          playerSpec: "Frost Mage",
          ccInstances: [
            {
              atSeconds: 30.6,
              durationSeconds: 6,
              spellId: POLYMORPH,
              spellName: "Polymorph",
              sourceName: NAME.m,
              sourceId: "m",
              sourceSpec: "Frost Mage",
              damageTakenDuring: 0,
              trinketState: "available_unused",
              drInfo: null,
            },
          ],
          ccAvoidedInstances: [],
          trinketUseTimes: [],
          missedTrinketWindows: [],
        },
      ],
    });
    expect(lines.some((l) => l.includes("[CC ON ENEMY]"))).toBe(true);
    expect(notLanded(lines)).toEqual([]);
  });

  it("no line for what is not a failed control on an enemy player", () => {
    const lines = timelineOf({
      mate: {
        missesOut: [
          // ABSORB reports the control's damage part, not a failure
          miss(POLYMORPH, "Polymorph", 10_000, "m", "e", "ABSORB"),
          // not a control
          miss(FIREBALL, "Fireball", 20_000, "m", "e"),
          // on a pet, not a player
          miss(POLYMORPH, "Polymorph", 30_000, "m", "pet"),
          // outside the round
          miss(POLYMORPH, "Polymorph", END_MS + 500, "m", "e"),
          miss(POLYMORPH, "Polymorph", -500, "m", "e"),
          // a periodic tick's miss is not the cast's outcome
          {
            ...miss(POLYMORPH, "Polymorph", 40_000, "m", "e"),
            logLine: {
              event: LogEvent.SPELL_PERIODIC_MISSED,
              timestamp: 40_000,
              parameters: [],
            },
          },
        ],
      } as never,
    });
    expect(lines.some((l) => l.includes(CC_NOT_LANDED_TAG))).toBe(false);
  });

  it("is read by nothing that reads a landed control", () => {
    const [line] = notLanded(
      timelineOf({
        mate: {
          missesOut: [miss(CYCLONE, "Cyclone", 19_000, "m", "e2", "MISS")],
        } as never,
      }),
    );
    // `resLedgerPrune`'s landing test, the gates' `[CC ON ENEMY]` head, a
    // `[DR: …]` state — none of them matches the line
    expect(/\[CC ON /.test(line!)).toBe(false);
    expect(line).not.toContain("[DR:");
    expect(CC_NOT_LANDED_TAG.startsWith("[CC ON")).toBe(false);
    // the type printed is one the gate accepts
    expect(
      CONTROL_FAILED_MISS_TYPES.has(line!.match(/logged (\S+)/)![1]!),
    ).toBe(true);
  });
});

describe("[CC NOT LANDED] — a pet command prints once, as the pet's (fact6 D30)", () => {
  // bbd5e632 0:37 + 0:38: the warlock's Command Demon Seduction (119909) and
  // the Sayaad's own Seduction (6358) each logged IMMUNE under a Cyclone and
  // each printed a line; 944d21b0 01:37:04: the Felguard's Axe Toss (89766)
  // logged IMMUNE 440 ms after the warlock's 119914 with no cast row of its own.
  const PET = "Pet-0-1-1-1-1-0000000001";
  const pet = (overrides: Partial<ICombatUnit>) =>
    mkUnit(PET, "Sayaad", {
      ownerId: "o",
      type: CombatUnitType.Pet,
      ...overrides,
    });
  const SED_CMD = "119909";
  const SED_PET = "6358";
  const AXE_CMD = "119914";
  const AXE_PET = "89766";
  const lineBy = (l: string) => /\(by ([^)]*\)?[^)]*)\) — logged/.exec(l)?.[1];

  it("a command the pet carried out (its cast and its own miss) is one line, the pet's", () => {
    const lines = notLanded(
      timelineOf({
        owner: {
          spellCastEvents: [cast(SED_CMD, "Seduction", 37_000, "o", "e")],
          missesOut: [miss(SED_CMD, "Seduction", 37_000, "o", "e")],
        } as never,
        extra: [
          pet({
            spellCastEvents: [cast(SED_PET, "Seduction", 37_001, PET, "e")],
            missesOut: [miss(SED_PET, "Seduction", 37_900, PET, "e")],
          } as never),
        ],
      }),
    );
    expect(lines).toHaveLength(1);
    expect(lineBy(lines[0]!)).toMatch(/pet/);
  });

  it("a pet's own miss with no cast row of its own still carries the press out", () => {
    const lines = notLanded(
      timelineOf({
        owner: {
          spellCastEvents: [cast(AXE_CMD, "Axe Toss", 30_000, "o", "e")],
          missesOut: [miss(AXE_CMD, "Axe Toss", 30_000, "o", "e")],
        } as never,
        extra: [
          pet({
            missesOut: [miss(AXE_PET, "Axe Toss", 30_440, PET, "e")],
          } as never),
        ],
      }),
    );
    expect(lines).toHaveLength(1);
    expect(lineBy(lines[0]!)).toMatch(/pet/);
  });

  it("a command no summon row carried out prints once, as the pet's", () => {
    const lines = notLanded(
      timelineOf({
        owner: {
          spellCastEvents: [
            // an earlier command the Sayaad carried out makes 119909 a command
            cast(SED_CMD, "Seduction", 10_000, "o", "e2"),
            cast(SED_CMD, "Seduction", 37_000, "o", "e"),
          ],
          missesOut: [miss(SED_CMD, "Seduction", 37_000, "o", "e")],
        } as never,
        extra: [
          pet({
            spellCastEvents: [cast(SED_PET, "Seduction", 10_001, PET, "e2")],
          } as never),
        ],
      }),
    );
    expect(lines).toHaveLength(1);
    expect(lineBy(lines[0]!)).toMatch(/pet/);
  });
});

describe("[KICK] … missed — IMMUNE: a pet command prints once, as the pet's (fact6 D30)", () => {
  // the enemy warlock's Command Demon Spell Lock (119910) and the Felhunter's
  // own Spell Lock (19647) both logged IMMUNE on our player: one kick
  const EPET = "Pet-0-1-1-1-1-0000000002";
  const felhunter = (overrides: Partial<ICombatUnit>) =>
    mkUnit(EPET, "Felhunter", {
      ownerId: "e",
      type: CombatUnitType.Pet,
      reaction: CombatUnitReaction.Hostile,
      ...overrides,
    });
  const immune = (spellId: string, t: number, src: string, name: string) => ({
    ...miss(spellId, "Spell Lock", t, src, "o"),
    srcUnitName: name,
  });
  const kickLines = (lines: string[]) =>
    lines.filter((l) => l.includes("missed — IMMUNE"));

  it("the owner's command row beside the pet's own row is one line, the pet's", () => {
    const lines = kickLines(
      timelineOf({
        owner: {
          missesIn: [
            immune("119910", 50_000, "e", NAME.e!),
            immune("19647", 50_002, EPET, "Felhunter"),
          ],
        } as never,
        enemy: {
          spellCastEvents: [cast("119910", "Spell Lock", 50_000, "e", "o")],
        } as never,
        extra: [
          felhunter({
            spellCastEvents: [cast("19647", "Spell Lock", 50_001, EPET, "o")],
          } as never),
        ],
      }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/'s pet's Spell Lock on /);
  });
});

describe("[CC NOT LANDED] — a control a talent triggers keeps its own name (F20 dr residual)", () => {
  // 457e197f r0 0:21: Deep Breath 433874 (untargeted) → its talent's stun
  // Terror of the Skies 372245 logged IMMUNE. The cast → effect table links
  // the two (for the recast test), but only through the class's talent, so
  // the line names the stun, not the breath
  it("Terror of the Skies after a Deep Breath", () => {
    const lines = timelineOf({
      mate: {
        spellCastEvents: [
          cast("433874", "Deep Breath", 20_000, "m", "0000000000000000"),
        ],
        missesOut: [miss("372245", "Terror of the Skies", 21_200, "m", "e")],
      } as never,
    });
    const got = notLanded(lines);
    expect(got).toHaveLength(1);
    expect(got[0]).toContain("← Terror of the Skies (by ");
  });
});
