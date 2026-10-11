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
  KICK_LOCKOUT_VICTIM_MODIFIERS,
  kickLockoutSecondsFor,
  kickLockoutVictimMultiplierAt,
} from "../src/utils/kickLockout";
import type { ILogDatedNumber } from "../src/utils/logEra";
import {
  makeAuraEvent,
  makeInterruptEvent,
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
  ])("%s (%s) from the enemy is an interval; from a friend it is not", (id) => {
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
        aura(LogEvent.SPELL_AURA_APPLIED, id, 254.142, "friend-1", "player-1"),
        aura(LogEvent.SPELL_AURA_REMOVED, id, 258.153, "friend-1", "player-1"),
      ],
    });
    expect(buildCannotCastIntervals(friendSourced, enemies)).toEqual([]);
  });
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

  it("the boundary: the last millisecond of 08-17 UTC is ×0.35, 08-18 00:00:00.000 UTC is ×0.6", () => {
    const cut = STORM_CONDUIT_HOTFIX_EPOCH_MS;
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
    const cut = STORM_CONDUIT_HOTFIX_EPOCH_MS;
    for (const at of [AUG_14, cut - 1, cut, AUG_19, ...NOT_A_DATE]) {
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
