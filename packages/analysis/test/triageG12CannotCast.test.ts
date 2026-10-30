/**
 * Triage 2026-09-29, group G12 — inputs of the one cannot-cast predicate
 * (`castBlockingAuraIntervals` / `buildCannotCastIntervals`):
 *  - cc-dr F-BK1: the dispel-backlash auras (196364 Unstable Affliction's
 *    silence, 87204 Vampiric Touch's horror) lock the dispeller;
 *  - cc-dr F-SR1 (ruling A52): a CC / silence the unit's own reflect sent
 *    back to it locks it, and a friendly holder's `[CC ON TEAM]` instance
 *    exists for it;
 *  - kick-eaten F-K8 (ruling A23): Storm Conduit shortens the lockout of an
 *    interrupted Lightning Bolt / Chain Lightning — ×0.35 in a log dated
 *    before its 2026-08-18 hotfix, ×0.6 from then on (ruling 2026-10-11), on
 *    the cutover its cooldown half is dated with.
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { kickLockoutSeconds } from "../src/data/spellEffectData";
import {
  EVENT_COOLDOWN_REDUCTIONS,
  eventReductionSecondsAt,
  type IHolderSeconds,
  STORM_CONDUIT_HOTFIX_EPOCH_MS,
} from "../src/data/talentScriptedCooldowns";
import {
  buildCannotCastIntervals,
  castBlockingAuraIntervals,
} from "../src/utils/cannotCastIntervals";
import { analyzePlayerCCAndTrinket } from "../src/utils/ccTrinketAnalysis";
import {
  KICK_LOCKOUT_KICKER_TALENTS,
  KICK_LOCKOUT_VICTIM_MODIFIERS,
  kickLockoutSecondsFor,
  kickLockoutVictimMultiplierAt,
} from "../src/utils/kickLockout";
import {
  type ILogDatedNumber,
  LOG_ZONE_UNCERTAINTY_MS,
} from "../src/utils/logEra";
import {
  makeAuraEvent,
  makeInterruptEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const START = 1_000_000;
const aura = (
  event: LogEvent,
  spellId: string,
  s: number,
  src: string,
  dest: string,
) => ({
  ...makeAuraEvent(event, spellId, START + s * 1000, src, dest),
  spellName: spellId,
});
const enemies = new Set(["enemy-1"]);

describe("cc-dr F-BK1 — a dispel backlash locks the dispeller", () => {
  it.each([
    ["196364", "Unstable Affliction silence"],
    ["87204", "Sin and Punishment horror"],
  ])(
    "%s (%s) from the enemy is an interval; from a friend it is too (fact2)",
    (id) => {
      const enemySourced = makeUnit("player-1", {
        auraEvents: [
          aura(LogEvent.SPELL_AURA_APPLIED, id, 254.142, "enemy-1", "player-1"),
          aura(LogEvent.SPELL_AURA_REMOVED, id, 258.153, "enemy-1", "player-1"),
        ],
      });
      expect(buildCannotCastIntervals(enemySourced, enemies)).toEqual([
        { from: START + 254_142, to: START + 258_153 },
      ]);
      const friendSourced = makeUnit("player-1", {
        auraEvents: [
          aura(
            LogEvent.SPELL_AURA_APPLIED,
            id,
            254.142,
            "friend-1",
            "player-1",
          ),
          aura(
            LogEvent.SPELL_AURA_REMOVED,
            id,
            258.153,
            "friend-1",
            "player-1",
          ),
        ],
      });
      // fact2 (2026-10-20): a backlash sourced to a teammate (the dispelled
      // DoT was the teammate's) locks the dispeller all the same — e49b7c3b
      // logged "Can't do that while horrified" under one
      expect(buildCannotCastIntervals(friendSourced, enemies)).toEqual([
        { from: START + 254_142, to: START + 258_153 },
      ]);
    },
  );
});

describe("cc-dr F-SR1 — a CC sent back onto its caster locks the caster", () => {
  // Strangulate 47476 reflected back onto the Death Knight (82a2d681 0:57)
  const reflected = (reaction: CombatUnitReaction) =>
    makeUnit("player-1", {
      reaction,
      class: CombatUnitClass.DeathKnight,
      spec: CombatUnitSpec.DeathKnight_Unholy,
      auraEvents: [
        aura(
          LogEvent.SPELL_AURA_APPLIED,
          "47476",
          57.33,
          "player-1",
          "player-1",
        ),
        aura(
          LogEvent.SPELL_AURA_REMOVED,
          "47476",
          60.306,
          "player-1",
          "player-1",
        ),
      ],
    });

  it("the holder's own reflected silence is a cast-blocking interval, named with its source", () => {
    const u = reflected(CombatUnitReaction.Friendly);
    const ivs = castBlockingAuraIntervals(u, enemies);
    expect(ivs).toHaveLength(1);
    expect(ivs[0]).toMatchObject({
      spellId: "47476",
      srcUnitId: "player-1",
      from: START + 57_330,
      to: START + 60_306,
    });
    // an enemy's own reflected silence locks it too (a per-unit fact)
    expect(
      castBlockingAuraIntervals(reflected(CombatUnitReaction.Hostile), enemies),
    ).toHaveLength(1);
  });

  it("a reflected CC is a friendly holder's CC instance, never an enemy holder's", () => {
    // Freezing Trap 3355 reflected back onto the Hunter (1c12961d 0:15)
    const trap = (reaction: CombatUnitReaction) =>
      makeUnit("player-1", {
        reaction,
        auraEvents: [
          aura(LogEvent.SPELL_AURA_APPLIED, "3355", 15, "player-1", "player-1"),
          aura(LogEvent.SPELL_AURA_REMOVED, "3355", 18, "player-1", "player-1"),
        ],
      });
    const combat = {
      startTime: START,
      endTime: START + 300_000,
      startInfo: { zoneId: "1672" },
    };
    const enemy = makeUnit("enemy-1", { reaction: CombatUnitReaction.Hostile });
    const friendly = analyzePlayerCCAndTrinket(
      trap(CombatUnitReaction.Friendly),
      [enemy],
      combat,
    ).ccInstances;
    expect(friendly.map((c) => [c.spellId, c.sourceId])).toEqual([
      ["3355", "player-1"],
    ]);
    const hostile = analyzePlayerCCAndTrinket(
      trap(CombatUnitReaction.Hostile),
      [enemy],
      combat,
    ).ccInstances;
    expect(hostile).toEqual([]);
  });
});

describe("fact2 — a dispel backlash sourced to a teammate is a CC on the friendly holder", () => {
  it("e49b7c3b 1:28: Sin and Punishment from the healer's own Shadow Priest", () => {
    const healer = makeUnit("player-1", {
      reaction: CombatUnitReaction.Friendly,
      auraEvents: [
        aura(
          LogEvent.SPELL_AURA_APPLIED,
          "87204",
          88.908,
          "friend-1",
          "player-1",
        ),
        aura(
          LogEvent.SPELL_AURA_REMOVED,
          "87204",
          91.918,
          "friend-1",
          "player-1",
        ),
      ],
    });
    const r = analyzePlayerCCAndTrinket(
      healer,
      [makeUnit("enemy-1", { reaction: CombatUnitReaction.Hostile })],
      {
        startTime: START,
        endTime: START + 300_000,
        startInfo: { zoneId: "1672" },
      },
    );
    expect(r.ccInstances.map((c) => [c.spellId, c.sourceId])).toEqual([
      ["87204", "friend-1"],
    ]);
  });
});

describe("kick-eaten F-K8 — Storm Conduit shortens an interrupted Lightning Bolt's lockout", () => {
  const shaman = (pvpTalents: string[]) =>
    makeUnit("player-1", {
      class: CombatUnitClass.Shaman,
      spec: CombatUnitSpec.Shaman_Restoration,
      info: { pvpTalents, talents: [] } as never,
    });
  const WIND_SHEAR = "57994";
  const base = () => kickLockoutSeconds(WIND_SHEAR);

  const KICK = "1766";
  const COUNTERSPELL = "2139";
  const LIGHTNING_BOLT = "188196";
  const CHAIN_LIGHTNING = "188443";
  const AUG_14 = Date.UTC(2026, 7, 14, 23, 18, 13);
  const AUG_19 = Date.UTC(2026, 7, 19, 14, 57, 49);
  const NOT_A_DATE = [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    undefined as unknown as number,
  ];
  const holder = shaman(["0", "290250", "204336", "1217092"]);
  const conduit = KICK_LOCKOUT_VICTIM_MODIFIERS.find(
    (m) => m.talentId === "1217092",
  )!;

  it("the row: Lightning Bolt / Chain Lightning, ×0.35 → ×0.6 at the instant the cooldown half is dated with", () => {
    expect([...conduit.interruptedSpellIds].sort()).toEqual([
      LIGHTNING_BOLT,
      CHAIN_LIGHTNING,
    ]);
    expect(conduit.multiplier).toEqual({
      cutoverEpochMs: STORM_CONDUIT_HOTFIX_EPOCH_MS,
      before: 0.35,
      since: 0.6,
    });
    // one hotfix, one instant: the constant, and the cooldown entry's own
    const cooldownHalf = (
      EVENT_COOLDOWN_REDUCTIONS["1217092"]!.seconds as IHolderSeconds
    ).bySpec[CombatUnitSpec.Shaman_Restoration]!;
    expect((conduit.multiplier as ILogDatedNumber).cutoverEpochMs).toBe(
      cooldownHalf.cutoverEpochMs,
    );
  });

  it("a log dated before the hotfix → ×0.35 (18703d63, 08-14: Wind Shear 2.0 → 0.7 s); from it on → ×0.6 (fd324e2c, 08-19: Counterspell 6 → 3.6 s)", () => {
    for (const spell of [LIGHTNING_BOLT, CHAIN_LIGHTNING]) {
      expect(kickLockoutSecondsFor(WIND_SHEAR, holder, spell, AUG_14)).toBe(
        0.7,
      );
      expect(kickLockoutSecondsFor(WIND_SHEAR, holder, spell, AUG_19)).toBe(
        1.2,
      );
    }
    expect(base()).toBe(2);
    expect(
      kickLockoutSecondsFor(COUNTERSPELL, holder, LIGHTNING_BOLT, AUG_19),
    ).toBe(3.6);
  });

  it("the boundary: ×0.35 only before the cutover in every zone (14 h clear of 08-18 00:00 UTC), ×0.6 from there on", () => {
    const cut = STORM_CONDUIT_HOTFIX_EPOCH_MS - LOG_ZONE_UNCERTAINTY_MS;
    expect(
      kickLockoutVictimMultiplierAt(conduit, STORM_CONDUIT_HOTFIX_EPOCH_MS - 1),
    ).toBe(0.6);
    expect(kickLockoutVictimMultiplierAt(conduit, cut - 1)).toBe(0.35);
    expect(kickLockoutVictimMultiplierAt(conduit, cut)).toBe(0.6);
    expect(
      kickLockoutSecondsFor(WIND_SHEAR, holder, LIGHTNING_BOLT, cut - 1),
    ).toBe(0.7);
    expect(kickLockoutSecondsFor(WIND_SHEAR, holder, LIGHTNING_BOLT, cut)).toBe(
      1.2,
    );
  });

  it("no usable date → the CURRENT ×0.6, never the old ×0.35 (the longer lock keeps a 'was locked' exemption)", () => {
    for (const at of NOT_A_DATE) {
      expect(kickLockoutVictimMultiplierAt(conduit, at)).toBe(0.6);
      expect(
        kickLockoutSecondsFor(WIND_SHEAR, holder, LIGHTNING_BOLT, at),
      ).toBe(1.2);
    }
  });

  it("both halves of the hotfix put one timestamp on one side: 4 s with ×0.35, 2 s with ×0.6", () => {
    const cooldown = EVENT_COOLDOWN_REDUCTIONS["1217092"]!;
    const cut = STORM_CONDUIT_HOTFIX_EPOCH_MS - LOG_ZONE_UNCERTAINTY_MS;
    for (const at of [
      AUG_14,
      cut - 1,
      cut,
      STORM_CONDUIT_HOTFIX_EPOCH_MS - 1,
      STORM_CONDUIT_HOTFIX_EPOCH_MS,
      AUG_19,
      ...NOT_A_DATE,
    ]) {
      const seconds = eventReductionSecondsAt(
        cooldown,
        CombatUnitSpec.Shaman_Restoration,
        at,
      );
      expect([seconds, kickLockoutVictimMultiplierAt(conduit, at)]).toEqual(
        seconds === 4 ? [4, 0.35] : [2, 0.6],
      );
    }
    expect(
      eventReductionSecondsAt(
        cooldown,
        CombatUnitSpec.Shaman_Restoration,
        cut - 1,
      ),
    ).toBe(4);
  });

  it("the lockout is whole milliseconds: 3 × 0.6 is 1.8, 3 × 0.35 is 1.05, 6 × 0.35 is 2.1", () => {
    expect(3 * 0.6).not.toBe(1.8);
    expect(kickLockoutSecondsFor(KICK, holder, LIGHTNING_BOLT, AUG_19)).toBe(
      1.8,
    );
    expect(kickLockoutSecondsFor(KICK, holder, LIGHTNING_BOLT, AUG_14)).toBe(
      1.05,
    );
    expect(
      kickLockoutSecondsFor(COUNTERSPELL, holder, LIGHTNING_BOLT, AUG_14),
    ).toBe(2.1);
  });

  it("controls on either date: another spell, a victim without the talent, or no victim → the kick's own lockout", () => {
    for (const at of [AUG_14, AUG_19, Number.NaN]) {
      expect(
        kickLockoutSecondsFor(WIND_SHEAR, shaman(["1217092"]), "77472", at),
      ).toBe(base());
      expect(
        kickLockoutSecondsFor(
          WIND_SHEAR,
          shaman(["204336"]),
          LIGHTNING_BOLT,
          at,
        ),
      ).toBe(base());
      expect(
        kickLockoutSecondsFor(WIND_SHEAR, undefined, LIGHTNING_BOLT, at),
      ).toBe(base());
    }
  });

  // the readers are asked with the interrupt's own log timestamp
  const kicked = (startMs: number) =>
    makeUnit("player-1", {
      class: CombatUnitClass.Shaman,
      spec: CombatUnitSpec.Shaman_Restoration,
      info: { pvpTalents: ["1217092"], talents: [] } as never,
      actionIn: [
        makeInterruptEvent(
          WIND_SHEAR,
          "Wind Shear",
          LIGHTNING_BOLT,
          "Lightning Bolt",
          startMs + 154_570,
          "enemy-1",
          "Enemy",
        ),
      ],
    });

  it.each([
    ["before the hotfix", AUG_14, 0.7],
    ["since the hotfix", AUG_19, 1.2],
  ])(
    "the cannot-cast lockout interval reads the victim's lockout — %s",
    (_, startMs, lockS) => {
      const [iv] = buildCannotCastIntervals(kicked(startMs), enemies);
      expect(iv!.to - iv!.from).toBe(lockS * 1000);
    },
  );

  it.each([
    ["before the hotfix", AUG_14, 0.7],
    ["since the hotfix", AUG_19, 1.2],
  ])(
    "the kick instance's lockoutDurationSeconds reads it too — %s",
    (_, startMs, lockS) => {
      const { interruptInstances } = analyzePlayerCCAndTrinket(
        kicked(startMs),
        [makeUnit("enemy-1", { reaction: CombatUnitReaction.Hostile })],
        {
          startTime: startMs,
          endTime: startMs + 300_000,
          startInfo: { zoneId: "1672" },
        },
      );
      expect(interruptInstances.map((k) => k.lockoutDurationSeconds)).toEqual([
        lockS,
      ]);
    },
  );
});

// User ruling 2026-10-20 (fact1215 retest idx 11, 「都要」): Counterspell's
// ruled 6 s is the Improved Counterspell holder's value; a mage whose talents
// show the node missing locks for DB2's 5. 605 files: the 4 non-holder
// Counterspells were followed by a cast in the locked school at 4.93–5.00 s,
// the 501 holder ones at p50 6.01 s.
describe("kickLockoutSecondsFor — the kicker's Improved Counterspell", () => {
  const COUNTERSPELL = "2139";
  const FROSTBOLT = "116";
  const mage = (talents: unknown[]) =>
    makeUnit("enemy-mage", {
      class: CombatUnitClass.Mage,
      spec: CombatUnitSpec.Mage_Frost,
      info: { pvpTalents: [], talents } as never,
    });
  const victim = makeUnit("player-1", {
    class: CombatUnitClass.Priest,
    spec: CombatUnitSpec.Priest_Discipline,
    info: { pvpTalents: [], talents: [] } as never,
  });

  it("is registered for Counterspell only, as one second", () => {
    expect(KICK_LOCKOUT_KICKER_TALENTS).toEqual({
      [COUNTERSPELL]: { talentSpellId: "1270865", seconds: 1 },
    });
  });

  // a real Frost mage loadout without the node (605-file capture, one of
  // the four non-holder Counterspells), as COMBATANT_INFO lists it
  const NON_HOLDER = (
    [
      [62084, 80140, 1],
      [62086, 80142, 1],
      [62088, 80144, 1],
      [62091, 80147, 1],
      [62096, 80153, 1],
      [62098, 80155, 1],
      [62100, 80157, 1],
      [62102, 80159, 2],
      [62104, 80161, 1],
      [62114, 80173, 2],
      [62115, 80174, 1],
      [62116, 80175, 1],
      [62122, 80181, 1],
      [62123, 80182, 2],
      [62127, 80187, 1],
      [62129, 80189, 1],
      [62153, 80216, 1],
      [62157, 80220, 1],
      [62163, 80226, 1],
      [62164, 80227, 1],
      [62170, 80234, 1],
      [62176, 80241, 1],
      [62177, 80242, 1],
      [62178, 80243, 1],
      [62179, 80244, 1],
      [62180, 80245, 1],
      [62182, 80248, 1],
      [62184, 80250, 1],
      [81468, 102429, 1],
      [93524, 115877, 1],
      [62092, 115878, 1],
      [94654, 117257, 1],
      [94655, 117258, 1],
      [94656, 117259, 1],
      [94658, 117261, 1],
      [94659, 117262, 1],
      [94660, 117263, 1],
      [94661, 117264, 1],
      [94662, 117265, 1],
      [94663, 117266, 1],
      [99828, 123339, 1],
      [101883, 125819, 1],
      [62094, 126060, 1],
      [94657, 128267, 1],
      [108653, 134180, 1],
      [108654, 134182, 1],
      [108655, 134185, 1],
      [108657, 134187, 1],
      [108658, 134188, 1],
      [108659, 134189, 1],
      [108660, 134190, 1],
      [108661, 134191, 1],
      [62105, 134197, 1],
      [62087, 134199, 1],
      [108851, 134407, 1],
      [108852, 134408, 2],
      [108855, 134411, 1],
      [108858, 134414, 2],
      [108859, 134415, 1],
      [103771, 134418, 1],
      [108864, 134421, 1],
      [62150, 134540, 1],
      [109667, 135918, 1],
      [109668, 135919, 1],
      [109669, 135946, 1],
      [109915, 136182, 1],
      [109916, 136183, 1],
      [62110, 136466, 1],
      [110081, 136579, 1],
      [110258, 136796, 1],
      [110283, 136837, 1],
      [108850, 136839, 1],
      [62173, 136880, 1],
      [110422, 137032, 1],
      [110422, 137033, 2],
      [110422, 137034, 1],
      [62117, 80176, 1],
      [94664, 117267, 1],
    ] as const
  ).map(([id1, id2, count]) => ({
    id1,
    id2,
    count,
  }));

  it("a kicker without the talent locks 5 s; an unknown kicker keeps the ruled 6", () => {
    expect(kickLockoutSeconds(COUNTERSPELL)).toBe(6);
    expect(
      kickLockoutSecondsFor(
        COUNTERSPELL,
        victim,
        FROSTBOLT,
        0,
        mage(NON_HOLDER),
      ),
    ).toBe(5);
    // an empty loadout proves nothing either way
    expect(
      kickLockoutSecondsFor(COUNTERSPELL, victim, FROSTBOLT, 0, mage([])),
    ).toBe(6);
    expect(kickLockoutSecondsFor(COUNTERSPELL, victim, FROSTBOLT, 0)).toBe(6);
    expect(
      kickLockoutSecondsFor(
        COUNTERSPELL,
        victim,
        FROSTBOLT,
        0,
        mage([{ id1: 110079, id2: 136577, count: 1 }]),
      ),
    ).toBe(6);
    // another kick is never touched
    expect(
      kickLockoutSecondsFor("1766", victim, FROSTBOLT, 0, mage(NON_HOLDER)),
    ).toBe(kickLockoutSeconds("1766"));
  });

  // codex 20-F16-12: kick-eaten's `ccInWindowS` read the other kicks'
  // lockouts with no round units — a non-holder's Counterspell counted 6 s
  it("kick-eaten ccInWindowS reads an earlier Counterspell at its kicker's length", () => {
    const T = 1_000_000;
    const FLASH_HEAL = "2061";
    const caster = mage(NON_HOLDER);
    const rogue = makeUnit("enemy-rogue", {
      class: CombatUnitClass.Rogue,
      spec: CombatUnitSpec.Rogue_Subtlety,
      reaction: CombatUnitReaction.Hostile,
      info: { pvpTalents: [], talents: [] } as never,
    });
    const priest = makeUnit("player-1", {
      name: "Owner",
      class: CombatUnitClass.Priest,
      spec: CombatUnitSpec.Priest_Holy,
      reaction: CombatUnitReaction.Friendly,
      info: { pvpTalents: [], talents: [] } as never,
      spellCastEvents: [
        makeSpellCastEvent(
          FLASH_HEAL,
          T + 5_000,
          "player-1",
          "Owner",
          "player-1",
          "Owner",
          0,
          "Flash Heal",
        ),
      ],
      actionIn: [
        {
          ...makeInterruptEvent(
            COUNTERSPELL,
            "Counterspell",
            FLASH_HEAL,
            "Flash Heal",
            T + 10_000,
            "enemy-mage",
            "Mage",
          ),
          destUnitId: "player-1",
        },
        {
          ...makeInterruptEvent(
            "1766",
            "Kick",
            "605",
            "Mind Control",
            T + 12_000,
            "enemy-rogue",
            "Rogue",
          ),
          destUnitId: "player-1",
        },
      ],
    });
    const r = analyzePlayerCCAndTrinket(priest, [caster, rogue], {
      startTime: T,
      endTime: T + 60_000,
      startInfo: { zoneId: "1672" },
      units: { "player-1": priest, "enemy-mage": caster, "enemy-rogue": rogue },
    } as never);
    const kick = r.interruptInstances.find((k) => k.kickSpellId === "1766");
    // the Counterspell's Holy lockout stops every spell cast this round,
    // 12 → 15 (its 5 s), not 12 → 16
    expect(kick?.ccInWindowS).toBe(3);
  });
});
