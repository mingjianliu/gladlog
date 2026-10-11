/**
 * FT-T16 D15 "3c" (user approval 2026-10-10): a `[CC AVOIDED?]` line says the
 * log's own miss type when the log wrote a SPELL_MISSED row for that cast on
 * that player, and stays `did not land` when it wrote none. 2c6e85ec round 6:
 *   L75206  19:01:46.490  SPELL_CAST_SUCCESS  Vräel → Herbivore  853 "Hammer of Justice"
 *   L75207  19:01:46.490  SPELL_MISSED        Vräel → Herbivore  853 "Hammer of Justice", IMMUNE
 *   0:40  [CC AVOIDED?]   1(BDruid): Hammer of Justice (by 5(RPaladin)) logged IMMUNE; Precognition (own) active
 * Wording only: which casts get a line is unchanged.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { buildMatchTimeline } from "../src/context/matchTimeline";
import { ensureAnalysisData } from "../src/data/ensure";
import { getEnglishSpellName } from "../src/data/spellEffectData";
import {
  CAST_MISS_LEAD_MS,
  CAST_MISS_WINDOW_MS,
  CC_MISS_TAG_WORD,
  CONTROL_FAILED_MISS_TYPES,
  missBelongsToCast,
} from "../src/utils/castMissRows";
import {
  analyzePlayerCCAndTrinket,
  ccAvoidedOutcomeText,
  IPlayerCCTrinketSummary,
} from "../src/utils/ccTrinketAnalysis";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const MATCH_START = 1_000_000;
const CAST_AT = MATCH_START + 40_400;
const combat = {
  startTime: MATCH_START,
  endTime: MATCH_START + 300_000,
  startInfo: { zoneId: "1672" },
};
const PRECOGNITION = "377362";
const BLADESTORM = "227847";
const HAMMER_OF_JUSTICE = "853";
const POLYMORPH = "118";
const STORM_BOLT = "107570";
const STORM_BOLT_STUN = "132169";
const CAPACITOR_TOTEM = "192058";
const STATIC_CHARGE = "118905";

interface Miss {
  spellId: string;
  missType: string;
  /** ms after CAST_AT */
  afterMs: number;
  srcUnitId?: string;
}

/** The enemy casts each `[castId, msAfterCastAt]` (aimed at the player unless
 *  `unaimed`) while the player has `buffId` up; `misses` are the SPELL_MISSED
 *  rows the log wrote on the player. */
function avoided(opts: {
  casts: Array<[string, number]>;
  misses: Miss[];
  buffId?: string;
  unaimed?: boolean;
  enemyPets?: ICombatUnit[];
}) {
  const enemy = makeUnit("enemy-1", {
    name: "Enemy",
    spec: CombatUnitSpec.Paladin_Retribution,
    reaction: CombatUnitReaction.Hostile,
    spellCastEvents: opts.casts.map(([castId, afterMs]) =>
      makeSpellCastEvent(
        castId,
        CAST_AT + afterMs,
        opts.unaimed ? "0000000000000000" : "player-1",
        opts.unaimed ? "nil" : "Player",
        "enemy-1",
        "Enemy",
        0,
        getEnglishSpellName(castId),
      ),
    ),
  });
  const buffId = opts.buffId ?? BLADESTORM;
  const player = makeUnit("player-1", {
    name: "Player",
    spec: CombatUnitSpec.Druid_Balance,
    reaction: CombatUnitReaction.Friendly,
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        buffId,
        CAST_AT - 1_000,
        "player-1",
        "player-1",
        "BUFF",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        buffId,
        CAST_AT + 20_000,
        "player-1",
        "player-1",
        "BUFF",
      ),
    ],
  });
  player.missesIn = opts.misses.map((m) => ({
    timestamp: CAST_AT + m.afterMs,
    spellId: m.spellId,
    srcUnitId: m.srcUnitId ?? "enemy-1",
    destUnitId: "player-1",
    missType: m.missType,
    amount: 0,
  })) as never;
  return analyzePlayerCCAndTrinket(
    player,
    [enemy],
    combat as never,
    opts.enemyPets ?? [],
  ).ccAvoidedInstances.map((a) => [a.spellName, a.loggedMissType ?? null]);
}

describe("castMissRows — the one reading of 'this miss row is that cast's'", () => {
  it("the window: 100 ms before the cast to 2.5 s after it, unless a landing delay is asked for", () => {
    expect([CAST_MISS_LEAD_MS, CAST_MISS_WINDOW_MS]).toEqual([100, 2500]);
    expect(missBelongsToCast([1000], 1000, 900)).toBe(true);
    expect(missBelongsToCast([1000], 1000, 899)).toBe(false);
    expect(missBelongsToCast([1000], 1000, 3500)).toBe(true);
    expect(missBelongsToCast([1000], 1000, 3501)).toBe(false);
    expect(missBelongsToCast([1000], 1000, 3501, 4500)).toBe(true);
  });

  it("a miss belongs to the latest cast of that spell before it", () => {
    // casts at 1.0 s and 2.6 s, the miss at 2.6 s is the second cast's
    expect(missBelongsToCast([1000, 2600], 1000, 2600)).toBe(false);
    expect(missBelongsToCast([1000, 2600], 2600, 2600)).toBe(true);
  });

  it("the types that say a control failed: IMMUNE and the cast-line tag words — never ABSORB", () => {
    expect([...CONTROL_FAILED_MISS_TYPES].sort()).toEqual(
      ["IMMUNE", ...Object.keys(CC_MISS_TAG_WORD)].sort(),
    );
    expect(CONTROL_FAILED_MISS_TYPES.has("REFLECT")).toBe(true);
    expect(CONTROL_FAILED_MISS_TYPES.has("ABSORB")).toBe(false);
  });
});

describe("[CC AVOIDED?] — the log's own miss type for the avoided cast", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("2c6e85ec 0:40: Hammer of Justice's IMMUNE row in the cast's millisecond", () => {
    expect(
      avoided({
        casts: [[HAMMER_OF_JUSTICE, 0]],
        misses: [
          { spellId: HAMMER_OF_JUSTICE, missType: "IMMUNE", afterMs: 0 },
        ],
        buffId: PRECOGNITION,
      }),
    ).toEqual([["Hammer of Justice", "IMMUNE"]]);
  });

  it("other types are said as the log wrote them: REFLECT, MISS", () => {
    for (const missType of ["REFLECT", "MISS"])
      expect(
        avoided({
          casts: [[POLYMORPH, 0]],
          misses: [{ spellId: POLYMORPH, missType, afterMs: 0 }],
        }),
        missType,
      ).toEqual([["Polymorph", missType]]);
  });

  it("no miss row in the log: nothing is claimed (the line stays `did not land`)", () => {
    expect(avoided({ casts: [[HAMMER_OF_JUSTICE, 0]], misses: [] })).toEqual([
      ["Hammer of Justice", null],
    ]);
  });

  it("an ABSORB row is the control's damage part, not a failed control", () => {
    expect(
      avoided({
        casts: [[HAMMER_OF_JUSTICE, 0]],
        misses: [
          { spellId: HAMMER_OF_JUSTICE, missType: "ABSORB", afterMs: 0 },
        ],
      }),
    ).toEqual([["Hammer of Justice", null]]);
  });

  it("a miss logged under the cast's effect aura is the cast's: Storm Bolt 107570 → 132169", () => {
    expect(
      avoided({
        casts: [[STORM_BOLT, 0]],
        misses: [
          { spellId: STORM_BOLT_STUN, missType: "IMMUNE", afterMs: 250 },
        ],
      }),
    ).toEqual([["Storm Bolt", "IMMUNE"]]);
  });

  it("a row of another spell, or of another unit's cast, is not this cast's", () => {
    expect(
      avoided({
        casts: [[HAMMER_OF_JUSTICE, 0]],
        misses: [{ spellId: POLYMORPH, missType: "IMMUNE", afterMs: 0 }],
      }),
    ).toEqual([["Hammer of Justice", null]]);
    expect(
      avoided({
        casts: [[HAMMER_OF_JUSTICE, 0]],
        misses: [
          {
            spellId: HAMMER_OF_JUSTICE,
            missType: "IMMUNE",
            afterMs: 0,
            srcUnitId: "enemy-2",
          },
        ],
      }),
    ).toEqual([["Hammer of Justice", null]]);
  });

  it("two casts of one spell: the row belongs to the latest cast before it", () => {
    expect(
      avoided({
        casts: [
          [POLYMORPH, 0],
          [POLYMORPH, 1_700],
        ],
        misses: [{ spellId: POLYMORPH, missType: "IMMUNE", afterMs: 1_700 }],
      }),
    ).toEqual([
      ["Polymorph", null],
      ["Polymorph", "IMMUNE"],
    ]);
  });

  // composes with WP-I: a control that lands seconds after its cast is looked
  // for as far as it can land (`ccLandedMatchWindowMs`), and its row comes
  // from the totem, not the shaman
  it("a delayed control: Capacitor Totem's IMMUNE row 2.9 s after the cast, from the shaman's totem", () => {
    const totem = makeUnit("totem-1", { name: "Totem", ownerId: "enemy-1" });
    const row = (afterMs: number, srcUnitId: string): Miss => ({
      spellId: STATIC_CHARGE,
      missType: "IMMUNE",
      afterMs,
      srcUnitId,
    });
    const run = (m: Miss) =>
      avoided({
        casts: [[CAPACITOR_TOTEM, 0]],
        misses: [m],
        unaimed: true,
        enemyPets: [totem],
      });
    expect(run(row(2_900, "totem-1"))).toEqual([["Capacitor Totem", "IMMUNE"]]);
    // past the totem's landing window (4.5 s): not this totem's
    expect(run(row(5_000, "totem-1"))).toEqual([["Capacitor Totem", null]]);
    // a totem that is not this enemy's
    expect(run(row(2_900, "totem-9"))).toEqual([["Capacitor Totem", null]]);
  });

  it("a control with no landing delay is not given one: a row 3 s after Polymorph is not that cast's", () => {
    expect(
      avoided({
        casts: [[POLYMORPH, 0]],
        misses: [{ spellId: POLYMORPH, missType: "IMMUNE", afterMs: 3_000 }],
      }),
    ).toEqual([["Polymorph", null]]);
  });
});

describe("[CC AVOIDED?] — the rendered line", () => {
  const T0 = 1_000_000;
  function unit(
    id: string,
    name: string,
    over: Partial<ICombatUnit> = {},
  ): ICombatUnit {
    return {
      id,
      name,
      type: CombatUnitType.Player,
      spec: CombatUnitSpec.Druid_Balance,
      reaction: CombatUnitReaction.Friendly,
      spellCastEvents: [],
      auraEvents: [],
      damageIn: [],
      damageOut: [],
      healIn: [],
      healOut: [],
      absorbsIn: [],
      absorbsOut: [],
      missesIn: [],
      missesOut: [],
      advancedActions: [],
      ...over,
    } as ICombatUnit;
  }
  const emptyDispel = {
    allyCleanse: [],
    ourPurges: [],
    hostilePurges: [],
    missedCleanseWindows: [],
    missedPurgeWindows: [],
  };
  function line(loggedMissType: string | undefined): string {
    const owner = unit("P1", "Owner");
    const enemy = unit("E1", "EnemyPaladin", {
      reaction: CombatUnitReaction.Hostile,
      spec: CombatUnitSpec.Paladin_Retribution,
    });
    const summary = {
      playerName: "Owner",
      playerSpec: "Balance Druid",
      trinketType: "Gladiator",
      trinketCooldownSeconds: 120,
      ccInstances: [],
      trinketUseTimes: [],
      missedTrinketWindows: [],
      rootInstances: [],
      disarmInstances: [],
      interruptInstances: [],
      ccAvoidedInstances: [
        {
          atSeconds: 40.4,
          spellId: "853",
          spellName: "Hammer of Justice",
          avoidanceSpellName: "Precognition",
          avoidanceSpellId: "377362",
          avoidanceSourceName: "Owner",
          sourceName: "EnemyPaladin",
          sourceId: "E1",
          sourceSpec: "Retribution Paladin",
          ...(loggedMissType ? { loggedMissType } : {}),
        },
      ],
    } as IPlayerCCTrinketSummary;
    const text = buildMatchTimeline({
      owner,
      ownerSpec: "Balance Druid",
      friends: [owner],
      enemies: [enemy],
      allUnits: [owner, enemy],
      playerIdMap: new Map([["Owner", 1]]),
      enemyIdMap: new Map([["EnemyPaladin", 5]]),
      matchStartMs: T0,
      matchEndMs: T0 + 60_000,
      isHealer: false,
      ownerCDs: [],
      teammateCDs: [],
      enemyCDTimeline: { players: [], alignedBurstWindows: [] },
      ccTrinketSummaries: [summary],
      enemyCCSummaries: [],
      dispelSummary: emptyDispel as never,
      enemyDispelSummary: emptyDispel as never,
      pressureWindows: [],
      healingGaps: [],
      friendlyDeaths: [],
      enemyDeaths: [],
      criticalWindowSeconds: new Set(),
      outgoingCCChains: [],
    } as never);
    return (
      text
        .split("\n")
        .find((l) => l.includes("[CC AVOIDED?]"))
        ?.trim() ?? ""
    );
  }

  it("with a miss row: `logged <TYPE>`; the tag's `?` and the `X active` half stay", () => {
    expect(line("IMMUNE")).toBe(
      "0:40  [CC AVOIDED?]   1(BDruid): Hammer of Justice (by 5(RPaladin)) logged IMMUNE; Precognition (own) active",
    );
    expect(line("REFLECT")).toContain(") logged REFLECT; Precognition (own)");
  });

  it("without one the line is what it was", () => {
    expect(line(undefined)).toBe(
      "0:40  [CC AVOIDED?]   1(BDruid): Hammer of Justice (by 5(RPaladin)) did not land; Precognition (own) active",
    );
  });

  it("ccAvoidedOutcomeText is the one wording of that half", () => {
    expect(ccAvoidedOutcomeText({})).toBe("did not land");
    expect(ccAvoidedOutcomeText({ loggedMissType: "MISS" })).toBe(
      "logged MISS",
    );
  });
});
