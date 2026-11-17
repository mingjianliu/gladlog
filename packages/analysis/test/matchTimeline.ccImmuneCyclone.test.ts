/**
 * weekly review 2026-10-24: the uncredited `[CC AVOIDED?] … logged IMMUNE`
 * line named `(a Cyclone was on them)` off its own copy of the Cyclone walk,
 * without the lost-REMOVED cap the `[CC NOT LANDED]` note has (codex
 * 60-POSTHOC-05a #1: a 0:10 Cyclone blamed for a 0:44 IMMUNE). Both now read
 * `damageImmuneControlUpAt`.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { buildMatchTimeline } from "../src/context/matchTimeline";
import { IPlayerCCTrinketSummary } from "../src/utils/ccTrinketAnalysis";
import { makeAuraEvent } from "./ported/testHelpers";

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
    spec: CombatUnitSpec.Shaman_Restoration,
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

function immuneLine(
  missAtS: number,
  cycloneRemovedAtS?: number,
  missType?: string,
  /** the REFLECT row on the caster's missesOut — what `reflectedSpells`
   * reads; without it no [REFLECTED] line states the row */
  reflectRow = missType === "REFLECT",
  spellId = "118",
  spellName = "Polymorph",
  /** damage the reflected spell then did to its caster (of 1M max HP) */
  backDamage = 0,
  /** another spell reflected by them in the same ms (its own row) */
  otherReflect?: [string, string],
): string {
  const cyclone = [
    makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      "33786",
      T0 + 10_000,
      "E1",
      "P1",
    ),
    ...(cycloneRemovedAtS === undefined
      ? []
      : [
          makeAuraEvent(
            LogEvent.SPELL_AURA_REMOVED,
            "33786",
            T0 + cycloneRemovedAtS * 1000,
            "E1",
            "P1",
          ),
        ]),
  ];
  const owner = unit("P1", "Owner", { auraEvents: cyclone as never });
  const enemy = unit("E1", "EnemyDruid", {
    reaction: CombatUnitReaction.Hostile,
    spec: CombatUnitSpec.Druid_Balance,
    missesOut: [
      ...(reflectRow ? [[spellId, spellName]] : []),
      ...(otherReflect ? [otherReflect] : []),
    ].map(([id, name]) => ({
      spellId: id,
      spellName: name,
      srcUnitId: "E1",
      destUnitId: "P1",
      missType: "REFLECT",
      timestamp: T0 + missAtS * 1000,
      logLine: {
        event: LogEvent.SPELL_MISSED,
        timestamp: T0 + missAtS * 1000,
      },
    })) as never,
    ...(backDamage > 0
      ? {
          damageIn: [
            {
              spellId,
              spellName,
              srcUnitId: "P1",
              destUnitId: "E1",
              effectiveAmount: -backDamage,
              amount: -backDamage,
              timestamp: T0 + missAtS * 1000 + 100,
              logLine: {
                event: LogEvent.SPELL_DAMAGE,
                timestamp: T0 + missAtS * 1000 + 100,
              },
            },
          ] as never,
          advancedActions: [
            {
              advancedActorId: "E1",
              advancedActorMaxHp: 1_000_000,
              advancedActorCurrentHp: 900_000,
              timestamp: T0 + missAtS * 1000,
              logLine: { timestamp: T0 + missAtS * 1000 },
            },
          ] as never,
        }
      : {}),
  });
  const summary = {
    playerName: "Owner",
    playerSpec: "Restoration Shaman",
    trinketType: "Gladiator",
    trinketCooldownSeconds: 120,
    ccInstances: [],
    trinketUseTimes: [],
    missedTrinketWindows: [],
    rootInstances: [],
    disarmInstances: [],
    interruptInstances: [],
    ccAvoidedInstances: [],
    ccImmuneUncredited: [
      {
        atSeconds: missAtS,
        castAtSeconds: missAtS,
        spellId,
        spellName,
        sourceName: "EnemyDruid",
        sourceId: "E1",
        missMs: T0 + missAtS * 1000,
        ...(missType ? { missType } : {}),
      },
    ],
  } as unknown as IPlayerCCTrinketSummary;
  const text = buildMatchTimeline({
    owner,
    ownerSpec: "Restoration Shaman",
    friends: [owner],
    enemies: [enemy],
    allUnits: [owner, enemy],
    playerIdMap: new Map([["Owner", 1]]),
    enemyIdMap: new Map([["EnemyDruid", 4]]),
    matchStartMs: T0,
    matchEndMs: T0 + 60_000,
    isHealer: true,
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
  return text.split("\n").find((l) => l.includes("[CC AVOIDED?]")) ?? "";
}

describe("[CC AVOIDED?] logged IMMUNE: the Cyclone cause reads the shared, capped walk", () => {
  it("a Cyclone up at the miss is named", () => {
    expect(immuneLine(12)).toContain("logged IMMUNE (a Cyclone was on them)");
  });
  it("a Cyclone whose REMOVED the log lost is over at its full length", () => {
    const line = immuneLine(44);
    expect(line).toContain("logged IMMUNE");
    expect(line).not.toContain("Cyclone was on them");
  });
  it("a logged REMOVED closes it", () => {
    expect(immuneLine(13, 12)).not.toContain("Cyclone was on them");
  });
  it("T120: a MISS row is stated bare — the causes read are IMMUNE's", () => {
    const line = immuneLine(12, undefined, "MISS");
    expect(line).toMatch(/\(by 4\([^)]*\)\) logged MISS$/);
  });
  // codex 85-tk-L-T120-2b #1: the row's own [REFLECTED] line decides
  it("T120: a REFLECT row no [REFLECTED] line states keeps its line", () => {
    expect(
      immuneLine(12, undefined, "REFLECT", false, "15487", "Silence"),
    ).toContain("Silence (by 4(");
    expect(
      immuneLine(12, undefined, "REFLECT", true, "15487", "Silence"),
    ).toContain("logged REFLECT");
  });
  // codex 85-tk-L-T120-2c #1: another spell's [REFLECTED] line in the same
  // ms states only its own row
  it("T120: a Polymorph reflected in the same ms leaves the Silence its line", () => {
    expect(
      immuneLine(12, undefined, "REFLECT", true, "15487", "Silence", 0, [
        "118",
        "Polymorph",
      ]),
    ).toContain("Silence (by 4(");
  });
  it("T120: a reflected silence with damage back is stated by its [REFLECTED] line alone", () => {
    expect(
      immuneLine(12, undefined, "REFLECT", true, "15487", "Silence", 100_000),
    ).toBe("");
  });
  it("T120: a reflected control gets no line here — its [REFLECTED] line states it", () => {
    expect(immuneLine(12, undefined, "REFLECT")).toBe("");
  });
});
