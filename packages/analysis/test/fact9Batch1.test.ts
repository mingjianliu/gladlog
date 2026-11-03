/**
 * fact9 (F24) batch 1 — the high and the two regressions of the round-9 audit:
 *  - D30 / D32: kick-eaten's kicker sweep counts a ready enemy pet kicker
 *    (Felhunter Spell Lock) that did not land the kick (dcff7ebb r0 2:06,
 *    f73f4f15 r0 0:39 / 1:34);
 *  - D6: a Nether Ward own-id return goes to the reflect its own millisecond
 *    names (14bb43b3 r0 2:40: Haunt, not the Agony reflected after it);
 *  - D21: the burst ledger's "major defensive up" is no heal and no
 *    control-only immunity (6f7c0839 r0: Lichborne; user 2026-11-02).
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  netherWardNamedSpells,
  pairNetherWardReturns,
} from "../src/context/spellOutcomeLines";
import {
  abilityProfile,
  isKillWindowMajorDefensive,
  isMajorDefenseUp,
  KW_NOT_UP_AS_DEFENSE_IDS,
} from "../src/data/abilityProfile";
import { ensureAnalysisData } from "../src/data/ensure";
import { analyzePlayerCCAndTrinket } from "../src/utils/ccTrinketAnalysis";
import { interruptCasterAt } from "../src/utils/enemyInterrupts";
import {
  makeInterruptEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const START = 1_000_000;
const at = (ms: number, x: number, y: number) =>
  [
    { timestamp: ms, advancedActorPositionX: x, advancedActorPositionY: y },
  ] as never;

describe("fact9 D30 / D32 — a ready pet kicker is a kicker", () => {
  const CAST = START + 126_930;
  const KICK = START + 128_104;
  /** dcff7ebb 2:06: Lightning Bolt from 126.930, the Mage's Counterspell
   * from 25 yd lands at 128.104; the Warlock stands 30 yd off, its Felhunter
   * 0.5 yd from the owner, its last Spell Lock at `lastLockMs`. */
  const scene = (lastLockMs: number) => {
    const owner = makeUnit("player-1", {
      name: "Owner",
      actionIn: [
        makeInterruptEvent(
          "2139",
          "Counterspell",
          "188196",
          "Lightning Bolt",
          KICK,
          "enemy-1",
          "Mage",
        ),
      ],
      castStartEvents: [
        {
          spellId: "188196",
          logLine: { event: LogEvent.SPELL_CAST_START, timestamp: CAST },
        },
      ] as never,
      advancedActions: at(CAST, 0, 0),
    });
    const mage = makeUnit("enemy-1", {
      name: "Mage",
      reaction: CombatUnitReaction.Hostile,
      class: CombatUnitClass.Mage,
      spec: CombatUnitSpec.Mage_Frost,
      advancedActions: at(CAST, 0, 25),
    });
    const lock = makeSpellCastEvent(
      "19647",
      lastLockMs,
      "player-1",
      "Owner",
      "Pet-0-1-1-417-1",
      "Felhunter",
      0,
      "Spell Lock",
    );
    const warlock = makeUnit("enemy-2", {
      name: "Warlock",
      reaction: CombatUnitReaction.Hostile,
      class: CombatUnitClass.Warlock,
      spec: CombatUnitSpec.Warlock_Affliction,
      advancedActions: at(CAST, 0, -30),
      petSpellCastEvents: [lock],
    });
    const pet = makeUnit("Pet-0-1-1-417-1", {
      name: "Felhunter",
      reaction: CombatUnitReaction.Hostile,
      ownerId: "enemy-2",
      advancedActions: at(CAST, 0.5, 0),
      spellCastEvents: [lock],
    });
    const combat = {
      startTime: START,
      endTime: START + 300_000,
      startInfo: { zoneId: "1672" },
      units: { owner, mage, warlock, pet },
    };
    return analyzePlayerCCAndTrinket(owner, [mage, warlock], combat, [pet])
      .interruptInstances[0]!;
  };

  it("dcff7ebb 2:06: the Felhunter, Spell Lock back since 119 s, 0.5 yd away, is the nearest of two kickers", () => {
    const inst = scene(START + 95_391);
    expect(inst.kickersInRange).toBe(2);
    expect(inst.nearestKickerDistYd).toBe(0.5);
    expect(inst.nearestKickerName).toBe("Warlock's pet");
  });

  it("control: a Spell Lock 10 s before the cast is still cooling at the kick — the Mage alone", () => {
    const inst = scene(CAST - 10_000);
    expect(inst.kickersInRange).toBe(1);
    expect(inst.nearestKickerName).toBe("Mage");
  });

  it("interruptCasterAt: the enemy for its own kick, the pet out for a pet kick, nothing for a pet that died", () => {
    const lock = makeSpellCastEvent(
      "19647",
      START + 5_000,
      "x",
      "x",
      "Pet-a",
      "Felhunter",
      0,
      "Spell Lock",
    );
    const warlock = makeUnit("w", {
      petSpellCastEvents: [lock],
    });
    const pet = makeUnit("Pet-a", {
      ownerId: "w",
      spellCastEvents: [lock],
      advancedActions: at(START + 4_000, 0, 0),
    });
    expect(
      interruptCasterAt(warlock, "19647", START + 10_000, [warlock, pet]).caster
        ?.id,
    ).toBe("Pet-a");
    const dead = {
      ...pet,
      deathRecords: [{ timestamp: START + 8_000 }],
    } as never;
    expect(
      interruptCasterAt(warlock, "19647", START + 10_000, [warlock, dead]).gone,
    ).toBe(true);
    const mage = makeUnit("m", {});
    expect(interruptCasterAt(mage, "2139", START, [mage]).caster).toBe(mage);
  });
});

describe("fact9 D6 — a Nether Ward return goes to the reflect it names", () => {
  // 14bb43b3 2:39: Haunt reflected at 159.767, Agony at 159.877; the 92k
  // under 212295 at 160.133 names Haunt in its own millisecond
  const HAUNT = 159_767;
  const AGONY = 159_877;
  const ROW = 160_133;
  it("without names the latest reflect takes it (the old reading)", () => {
    expect(pairNetherWardReturns([HAUNT, AGONY], [ROW]).get(ROW)).toBe(AGONY);
  });
  it("named Haunt, it goes to Haunt's reflect", () => {
    const p = pairNetherWardReturns([HAUNT, AGONY], [ROW], {
      reflectRowSpells: new Map([
        [HAUNT, new Set(["48181"])],
        [AGONY, new Set(["980"])],
      ]),
      ownRowNames: new Map([[ROW, new Set(["48181"])]]),
    });
    expect(p.get(ROW)).toBe(HAUNT);
  });
  it("a name no reflect behind it carries keeps the timing rule", () => {
    const p = pairNetherWardReturns([HAUNT, AGONY], [ROW], {
      reflectRowSpells: new Map([
        [HAUNT, new Set(["48181"])],
        [AGONY, new Set(["980"])],
      ]),
      ownRowNames: new Map([[ROW, new Set(["116858"])]]),
    });
    expect(p.get(ROW)).toBe(AGONY);
  });
  it("netherWardNamedSpells reads the reflector's same-ms absorb and aura rows only", () => {
    const caster = {
      absorbsIn: [
        { timestamp: ROW, attackerId: "r", attackSpellId: "48181" },
        { timestamp: ROW, attackerId: "r", attackSpellId: "212295" },
        { timestamp: ROW, attackerId: "x", attackSpellId: "686" },
        { timestamp: ROW + 1, attackerId: "r", attackSpellId: "980" },
      ],
      auraEvents: [
        {
          spellId: "48181",
          srcUnitId: "r",
          logLine: { event: LogEvent.SPELL_AURA_APPLIED, timestamp: ROW },
        },
        {
          spellId: "316099",
          srcUnitId: "r",
          logLine: { event: LogEvent.SPELL_AURA_REMOVED, timestamp: ROW },
        },
      ],
    } as never;
    expect([...netherWardNamedSpells(caster, "r", ROW)]).toEqual(["48181"]);
  });
});

describe("fact9 D21 — the ledger's major defensive up is a damage defense", () => {
  it("every member is in the kill-window roster and is a heal or a control-only immunity by its official profile", () => {
    for (const id of KW_NOT_UP_AS_DEFENSE_IDS) {
      expect(isKillWindowMajorDefensive(id), id).toBe(true);
      expect(isMajorDefenseUp(id), id).toBe(false);
      const p = abilityProfile(id);
      expect(p.mitigationPct, id).toBeUndefined();
      expect(p.immuneSchools, id).toBeUndefined();
      const heal = p.healsSelf || p.healsOthers;
      const controlOnly =
        !p.absorbs &&
        (p.immuneMechanics ?? []).length > 0 &&
        (p.immuneMechanics ?? []).every((m) => [1, 5, 10, 23].includes(m));
      expect(heal || controlOnly, id).toBe(true);
    }
  });
  it("the walls, shields, immunities and the kept avoidance stay", () => {
    for (const id of [
      "871", // Shield Wall
      "48707", // Anti-Magic Shell
      "108416", // Dark Pact (a heal and a shield)
      "642", // Divine Shield
      "5277", // Evasion
      "212295", // Nether Ward
      "47788", // Guardian Spirit
      "97462", // Rallying Cry
      "1856", // Vanish
      "409293", // Burrow
    ])
      expect(isMajorDefenseUp(id), id).toBe(true);
  });
});
