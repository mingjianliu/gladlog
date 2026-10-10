/* eslint-disable @typescript-eslint/no-explicit-any */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { saveSchoolMask } from "../src/analysis/candidates/cooldownTiming";
import { CRISIS_PROC_ANSWERS } from "../src/analysis/crisisDecisionPoints";
import { ABILITY_EFFECTS_GENERATED } from "../src/data/abilityEffectsGenerated";
import castEffectAurasJson from "../src/data/castEffectAuraGenerated.json";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  MITIGATION_TABLE,
  SELF_WALL_AURA_TO_CAST_ID,
} from "../src/data/mitigationData";
import spellIdLists, {
  ENEMY_ALLY_SAVE_IDS,
  ENEMY_AREA_SAVE_IDS,
  ENEMY_IMMUNITY_HOLDS_ITS_AURA_IDS,
  ENEMY_IMMUNITY_SAVE_AURAS,
  ENEMY_PROC_SAVES,
  ENEMY_REDIRECT_SAVE_IDS,
  ENEMY_SELF_SAVE_ONLY_IDS,
} from "../src/data/spellIdLists";
import { immunitySchoolMask } from "../src/data/spellSchools";
import talentEffectInventory from "../src/data/talentEffectInventoryGenerated.json";
import { AURA_ONLY_ACTIVATION_IDS } from "../src/utils/cooldowns";
import { EXTERNAL_DEFENSIVE_SPELLS } from "../src/utils/deathOutcomeAnalysis";
import {
  absorbedDuring,
  effectSaves,
  ENEMY_SAVE_EFFECT_BY_NAME,
  enemyDefensiveEvents,
  enemySaveEffectNote,
  enemySaveEffectOfNote,
  EXTERNAL_DEF_IDS,
  externalAuraOf,
  FEIGN_DEATH_ABSORB_AURA_IDS,
  IMMUNITY_IDS,
  IMMUNITY_SAVE_AURA_NAMES,
  immunityCountsWhenAlreadyUp,
  immunityLastsItsAura,
  isExternalSaveId,
  isImmunitySaveAura,
  isIntervalFrom,
  joinReappliedIntervals,
  limitedAbsorbSchoolMask,
  limitedImmunitySchoolMask,
  MITIGATION_AURA_IDS,
  MITIGATION_AURA_MIN_PCT,
  REMOVED_EARLY_SLACK_S,
  saveAuraIntervals,
  SELF_SAVE_IDS,
  wallTableIdOfAura,
} from "../src/utils/enemyDefensives";

/**
 * GH #97 `[ENEMY DEF]` source predicate. Pins the boundaries that would
 * silently produce a wrong timeline line:
 *  1. a wall an ALLY put on the unit (talent-shared copy) is not "the unit
 *     popped a wall" — source must be the unit itself;
 *  2. an external is attributed to the CASTER, with the recipient named, and
 *     its duration comes from the recipient's aura interval;
 *  3. `removedEarly` needs a real REMOVED event (never an inferred end) and
 *     the observed span short of the full duration by more than the slack;
 *  4. the id sets are the same slice of the official table the KILL
 *     ATTEMPTS attribution uses (Shared-Predicate Rule).
 */

const MATCH_START = Date.UTC(2026, 8, 15);
const ms = (s: number): number => MATCH_START + s * 1000;
const BARKSKIN = "22812"; // 20 %, 12 s
const IRONBARK = "102342"; // external, 12 s
const DIVINE_SHIELD = "642"; // immunity (pct 100), 8 s

function unit(id: string, over: Record<string, unknown> = {}): any {
  return {
    id,
    name: id,
    type: 1,
    spec: "105",
    reaction: 1,
    info: {},
    spellCastEvents: [],
    auraEvents: [],
    damageOut: [],
    damageIn: [],
    healIn: [],
    deathRecords: [],
    advancedActions: [],
    ...over,
  };
}

function aura(
  spellId: string,
  src: string,
  dest: string,
  atS: number,
  event: LogEvent,
): any {
  return {
    spellId,
    spellName: `S${spellId}`,
    srcUnitId: src,
    srcUnitName: src,
    destUnitId: dest,
    destUnitName: dest,
    timestamp: ms(atS),
    logLine: { event, timestamp: ms(atS), parameters: [] },
    auraType: "BUFF",
  };
}
const applied = (id: string, src: string, dest: string, atS: number) =>
  aura(id, src, dest, atS, LogEvent.SPELL_AURA_APPLIED);
const removed = (id: string, src: string, dest: string, atS: number) =>
  aura(id, src, dest, atS, LogEvent.SPELL_AURA_REMOVED);
const cast = (spellId: string, dest: string, atS: number): any => ({
  spellId,
  spellName: `S${spellId}`,
  destUnitId: dest,
  destUnitName: dest,
  logLine: {
    event: LogEvent.SPELL_CAST_SUCCESS,
    timestamp: ms(atS),
    parameters: [],
  },
});

const combat = { startTime: ms(0), endTime: ms(120) };

describe("enemyDefensiveEvents", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("id sets are the official-table slice killAttempts attributes on", () => {
    expect(MITIGATION_TABLE[BARKSKIN]?.pct).toBe(20);
    expect(MITIGATION_AURA_IDS.has(BARKSKIN)).toBe(true);
    expect(IMMUNITY_IDS.has(DIVINE_SHIELD)).toBe(true);
    expect(MITIGATION_AURA_IDS.has(DIVINE_SHIELD)).toBe(false);
    expect(EXTERNAL_DEF_IDS.has(IRONBARK)).toBe(true);
    for (const id of MITIGATION_AURA_IDS) {
      const pct = MITIGATION_TABLE[id].pct;
      expect(pct).toBeGreaterThanOrEqual(MITIGATION_AURA_MIN_PCT);
      expect(pct).toBeLessThan(100);
    }
    for (const id of IMMUNITY_IDS) expect(MITIGATION_TABLE[id].pct).toBe(100);
  });

  it("an aura kind carries its press: the nearest logged cast, up to 1 s before or 50 ms after the aura", () => {
    const at = (castS: number | null) => {
      const u = unit("e1", {
        auraEvents: [
          applied(BARKSKIN, "e1", "e1", 10),
          removed(BARKSKIN, "e1", "e1", 22),
        ],
        spellCastEvents: castS === null ? [] : [cast(BARKSKIN, "e1", castS)],
      });
      // the caster is looked up among the enemies passed in
      return enemyDefensiveEvents(u, [u], combat)[0]!.pressSeconds;
    };
    expect(at(9.8)).toBeCloseTo(9.8, 6);
    // the cast line logged a few ms AFTER its aura (review of F-E11)
    expect(at(10.02)).toBeCloseTo(10.02, 6);
    // exactly 50 ms after (10.05 - 10 is not 0.05 in floating point)
    expect(at(10.05)).toBeCloseTo(10.05, 6);
    // too far either side: no press, the line falls back to the aura time
    expect(at(8.5)).toBeUndefined();
    expect(at(10.2)).toBeUndefined();
    expect(at(null)).toBeUndefined();
  });

  it("self wall / immunity / external, in cast order, with observed duration", () => {
    const druid = unit("e1", {
      auraEvents: [
        applied(BARKSKIN, "e1", "e1", 10),
        removed(BARKSKIN, "e1", "e1", 22),
      ],
      spellCastEvents: [cast(IRONBARK, "e2", 30)],
    });
    const pal = unit("e2", {
      auraEvents: [
        applied(IRONBARK, "e1", "e2", 30),
        removed(IRONBARK, "e1", "e2", 42),
        applied(DIVINE_SHIELD, "e2", "e2", 50),
        removed(DIVINE_SHIELD, "e2", "e2", 53),
      ],
    });
    const enemies = [druid, pal];

    const fromDruid = enemyDefensiveEvents(druid, enemies, combat);
    expect(
      fromDruid.map((e) => [e.kind, e.spellId, e.atSeconds, e.observedSeconds]),
    ).toEqual([
      ["self", BARKSKIN, 10, 12],
      ["external", IRONBARK, 30, 12],
    ]);
    expect(fromDruid[0].pct).toBe(20);
    expect(fromDruid[0].removedEarly).toBe(false);
    expect(fromDruid[1].casterName).toBe("e1");
    expect(fromDruid[1].recipientName).toBe("e2");
    expect(fromDruid[1].removedEarly).toBe(false);

    const fromPal = enemyDefensiveEvents(pal, enemies, combat);
    // the Ironbark the druid put on the paladin is NOT the paladin's own
    // defensive — it belongs to the caster's list above
    expect(fromPal.map((e) => [e.kind, e.spellId, e.atSeconds])).toEqual([
      ["immune", DIVINE_SHIELD, 50],
    ]);
    expect(fromPal[0].pct).toBe(100);
    // 3 s observed against an 8 s Divine Shield → removed early (cancelled)
    expect(fromPal[0].observedSeconds).toBe(3);
    expect(fromPal[0].removedEarly).toBe(true);
  });

  it("an ally-sourced copy of a self wall does not count for the recipient", () => {
    const a = unit("e1");
    const b = unit("e2", {
      auraEvents: [
        applied(BARKSKIN, "e1", "e2", 5),
        removed(BARKSKIN, "e1", "e2", 17),
      ],
    });
    expect(enemyDefensiveEvents(b, [a, b], combat)).toEqual([]);
    // and it is not an external either (Barkskin is not in the external set)
    expect(enemyDefensiveEvents(a, [a, b], combat)).toEqual([]);
  });

  // 138e632d: the Demon Hunter's unit is named "Antagonist" (9 log lines) and
  // every one of his aura events says "Antagonist-Balnazzar-US" (20,778). The
  // unit id is the same on both; the name is not a key.
  it("the unit's own wall is recognised by unit id when the log names the player two ways", () => {
    const withRealm = (e: any) => ({ ...e, srcUnitName: "e1-Balnazzar-US" });
    const a = unit("e1", {
      auraEvents: [
        withRealm(applied(BARKSKIN, "e1", "e1", 5)),
        withRealm(removed(BARKSKIN, "e1", "e1", 17)),
      ],
    });
    const ev = enemyDefensiveEvents(a, [a], combat);
    expect(ev.map((d) => [d.kind, d.spellId, d.casterName])).toEqual([
      ["self", BARKSKIN, "e1"],
    ]);
    const iv = saveAuraIntervals(a, [a], combat)[0]!;
    expect(iv.srcUnitId).toBe("e1");
    expect(isIntervalFrom(iv, a)).toBe(true);
    // an interval with no id falls back to the name
    expect(isIntervalFrom({ ...iv, srcUnitId: undefined }, a)).toBe(false);
    // and an ally's copy is still not the unit's own (same test as above, by id)
    expect(isIntervalFrom(iv, unit("e2"))).toBe(false);
  });

  it("removedEarly needs a real REMOVED event and more than the slack short", () => {
    // no REMOVED → the interval end is inferred (round end) → never "early"
    const inferred = unit("e1", {
      auraEvents: [applied(BARKSKIN, "e1", "e1", 100)],
    });
    const [ev] = enemyDefensiveEvents(inferred, [inferred], combat);
    expect(ev.removedEarly).toBe(false);

    // within slack of the full 12 s → not early; beyond → early
    const mk = (durS: number) =>
      unit("e1", {
        auraEvents: [
          applied(BARKSKIN, "e1", "e1", 10),
          removed(BARKSKIN, "e1", "e1", 10 + durS),
        ],
      });
    const within = mk(12 - REMOVED_EARLY_SLACK_S);
    expect(enemyDefensiveEvents(within, [within], combat)[0].removedEarly).toBe(
      false,
    );
    const short = mk(12 - REMOVED_EARLY_SLACK_S - 0.5);
    expect(enemyDefensiveEvents(short, [short], combat)[0].removedEarly).toBe(
      true,
    );
  });

  it("an external cast with no recipient aura still lists, without a duration", () => {
    const druid = unit("e1", { spellCastEvents: [cast(IRONBARK, "e2", 30)] });
    const pal = unit("e2");
    const [ev] = enemyDefensiveEvents(druid, [druid, pal], combat);
    expect(ev.kind).toBe("external");
    expect(ev.observedSeconds).toBeUndefined();
    expect(ev.removedEarly).toBe(false);
    // a self-cast external (Ironbark on the druid itself) is a self wall, listed once
    const selfCast = unit("e1", {
      spellCastEvents: [cast(IRONBARK, "e1", 30)],
      auraEvents: [
        applied(IRONBARK, "e1", "e1", 30),
        removed(IRONBARK, "e1", "e1", 42),
      ],
    });
    const evs = enemyDefensiveEvents(selfCast, [selfCast, pal], combat);
    expect(evs.map((e) => e.kind)).toEqual(["self"]);
  });

  it("an external seen only as the recipient's aura (cast event missing) still lists — GH #103 F", () => {
    // match 44f529e3: Ironbark applied on the ally at 9.724 s, no SPELL_CAST_SUCCESS
    const druid = unit("e1");
    const ally = unit("e2", {
      auraEvents: [
        applied(IRONBARK, "e1", "e2", 9.7),
        removed(IRONBARK, "e1", "e2", 21.7),
      ],
    });
    const [ev] = enemyDefensiveEvents(druid, [druid, ally], combat);
    expect(ev).toMatchObject({
      kind: "external",
      spellId: IRONBARK,
      recipientId: "e2",
      atSeconds: 9.7,
    });
    expect(ev.observedSeconds).toBeCloseTo(12, 5);
    // with the cast present it stays one event (cast-paired), not two
    const withCast = unit("e1", {
      spellCastEvents: [cast(IRONBARK, "e2", 9.7)],
    });
    expect(
      enemyDefensiveEvents(withCast, [withCast, ally], combat),
    ).toHaveLength(1);
  });

  it("carries recipientId for external defensives", () => {
    const druid = unit("druid", {
      spellCastEvents: [cast(IRONBARK, "rogue", 10)],
    });
    const rogue = unit("rogue", {
      auraEvents: [
        applied(IRONBARK, "druid", "rogue", 10),
        removed(IRONBARK, "druid", "rogue", 22),
      ],
    });
    const events = enemyDefensiveEvents(druid, [druid, rogue], combat);
    const ext = events.find((e) => e.kind === "external");
    expect(ext).toBeDefined();
    expect(ext?.recipientId).toBe("rogue");
    expect(ext?.recipientName).toBe("rogue");
  });
});

describe("Greater Invisibility is never double-counted (signed 2026-09-26, codex astra)", () => {
  // The cast 110959 carries no mitigation row; its −60 % is on buff 113862.
  // It is registered cast-keyed (the Blur 198589 → 212800 pattern). Listing
  // 110959 in NO_MITIGATION_IDS as well would make it a self-save, and
  // listing 113862 in the table would make its aura a wall — one activation,
  // two defensive events (codex reproduced 0 → 2 with the real collector).
  // This pins "no duplicate", NOT recognition: today an enemy GI yields ZERO
  // events, because the aura branch matches buff ids and 113862 is not a key.
  // Every cast-keyed override shares that gap (Blur, AMZ, Barrier, SLT), and
  // so does the death-window mitigation audit (whitelisted aura ids only).
  // It is ledgered for an explicit cast → buff link.
  it("priced on the cast id, never as a no-mitigation self-save, the buff id unlisted", () => {
    expect(MITIGATION_TABLE["110959"]?.pct).toBe(60);
    expect(MITIGATION_TABLE["113862"]).toBeUndefined();
    expect(SELF_SAVE_IDS.has("110959")).toBe(false);
  });

  it("a GI cast plus its 113862 buff yields at most one enemy defensive event", () => {
    const mage: any = {
      id: "mage",
      name: "mage",
      spellCastEvents: [
        {
          spellId: "110959",
          spellName: "Greater Invisibility",
          destUnitId: "mage",
          logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: 10_000 },
        },
      ],
      auraEvents: [
        {
          spellId: "113862",
          spellName: "Greater Invisibility",
          srcUnitId: "mage",
          destUnitId: "mage",
          logLine: { event: LogEvent.SPELL_AURA_APPLIED, timestamp: 10_000 },
        },
        {
          spellId: "113862",
          spellName: "Greater Invisibility",
          srcUnitId: "mage",
          destUnitId: "mage",
          logLine: { event: LogEvent.SPELL_AURA_REMOVED, timestamp: 13_000 },
        },
      ],
    };
    const events = enemyDefensiveEvents(mage, [mage], {
      startTime: 0,
      endTime: 60_000,
    });
    expect(events.length).toBeLessThanOrEqual(1);
  });
});

/**
 * Triage 2026-09-29, enemy-def F-E7 / F-E4 / F-E9 (rulings A11, A20, U3).
 * The enemy-only save sets render and count in KILL ATTEMPTS, and must never
 * reach a friendly roster: every list they are kept out of is an accusation
 * source ("had X available", cd-hoarded, a Critical purge target).
 */
describe("enemy-only saves: self-saves, instant heals, grips / redirects", () => {
  const LAY_ON_HANDS = "471195";
  const LEAP_OF_FAITH = "73325";
  const ROAR_OF_SACRIFICE = "53480";
  const DARK_PACT = "108416";
  const NIL = "0000000000000000";

  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("the enemy-only sets stay out of every friendly roster", () => {
    const friendly = new Set<string>([
      ...spellIdLists.externalDefensiveSpellIds,
      ...spellIdLists.bigDefensiveSpellIds,
      ...Object.keys(EXTERNAL_DEFENSIVE_SPELLS),
    ]);
    for (const id of [...ENEMY_ALLY_SAVE_IDS, ...ENEMY_REDIRECT_SAVE_IDS])
      expect(friendly.has(id), id).toBe(false);
    for (const id of ENEMY_SELF_SAVE_ONLY_IDS) {
      expect(spellIdLists.externalDefensiveSpellIds.includes(id), id).toBe(
        false,
      );
      expect(spellIdLists.bigDefensiveSpellIds.includes(id), id).toBe(false);
    }
  });

  it("no enemy-only save is also a %-wall or an immunity (it would render twice)", () => {
    for (const id of [
      ...ENEMY_SELF_SAVE_ONLY_IDS,
      ...ENEMY_ALLY_SAVE_IDS,
      ...ENEMY_REDIRECT_SAVE_IDS,
    ]) {
      expect(MITIGATION_AURA_IDS.has(id), id).toBe(false);
      expect(IMMUNITY_IDS.has(id), id).toBe(false);
      expect(SELF_SAVE_IDS.has(id), id).toBe(true);
    }
    expect(isExternalSaveId(LAY_ON_HANDS)).toBe(true);
    expect(isExternalSaveId(LEAP_OF_FAITH)).toBe(true);
    expect(isExternalSaveId(DARK_PACT)).toBe(false);
    // the friendly roster itself is unchanged by the enemy-only sets
    expect(EXTERNAL_DEF_IDS.has(LAY_ON_HANDS)).toBe(false);
    expect(EXTERNAL_DEF_IDS.has(LEAP_OF_FAITH)).toBe(false);
  });

  it("a nil-dest self-save (Dark Pact) is one self-save event", () => {
    const lock = unit("e1", { spellCastEvents: [cast(DARK_PACT, NIL, 7)] });
    const evs = enemyDefensiveEvents(lock, [lock], combat);
    expect(evs.map((e) => [e.kind, e.spellId, e.atSeconds])).toEqual([
      ["self-save", DARK_PACT, 7],
    ]);
  });

  it("Lay on Hands on an ally is an external without a duration; on oneself a self-save", () => {
    const pal = unit("e1", {
      spellCastEvents: [
        cast(LAY_ON_HANDS, "e2", 127.19),
        cast(LAY_ON_HANDS, "e1", 200),
      ],
    });
    const lock = unit("e2");
    const evs = enemyDefensiveEvents(pal, [pal, lock], {
      startTime: ms(0),
      endTime: ms(300),
    });
    expect(evs.map((e) => [e.kind, e.recipientId, e.observedSeconds])).toEqual([
      ["external", "e2", undefined],
      ["self-save", undefined, undefined],
    ]);
  });

  it("a grip renders the move, not its 1 s aura: no duration, no removed-early, no paired interval", () => {
    const priest = unit("e1", {
      spellCastEvents: [cast(LEAP_OF_FAITH, "e2", 66.9)],
    });
    const dk = unit("e2", {
      auraEvents: [
        applied(LEAP_OF_FAITH, "e1", "e2", 66.9),
        removed(LEAP_OF_FAITH, "e1", "e2", 67.9),
      ],
    });
    const evs = enemyDefensiveEvents(priest, [priest, dk], combat);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({
      kind: "external",
      recipientId: "e2",
      removedEarly: false,
    });
    expect(evs[0].observedSeconds).toBeUndefined();
    expect(evs[0].auraFromS).toBeUndefined();
  });

  it("Roar of Sacrifice on oneself is a self-save; on an ally an external", () => {
    const hunter = unit("e1", {
      spellCastEvents: [
        cast(ROAR_OF_SACRIFICE, "e1", 17.8),
        cast(ROAR_OF_SACRIFICE, "e2", 80),
      ],
    });
    const mate = unit("e2");
    const evs = enemyDefensiveEvents(hunter, [hunter, mate], combat);
    expect(evs.map((e) => e.kind)).toEqual(["self-save", "external"]);
  });
});

/**
 * Triage 2026-09-29, enemy-def F-E5 / F-E6 (ruling A25): untargetable saves
 * are kind `immune` — from enemy-only tables, never from `MITIGATION_TABLE`,
 * so `IMMUNITY_IDS` stays the pct-100 slice other predicates read. Ruling D8
 * (2026-10-10) split A25's list by effect: Feign Death (an absorb), Nature's
 * Guardian (a heal proc), Cheat Death and Cauterize (cheat-death procs) are
 * self-saves named by that effect, no longer `immune`.
 */
describe("immunity-kind saves (Burrow, Time Stop, Vanish, Guardian of the Forgotten Queen …) and the effect saves ruling D8 took out of them", () => {
  const TIME_STOP = "378441";
  const BURROW = "409293";
  const SURVIVAL_TACTICS = "202748";
  const GOTFQ_CAST = "228049";
  const GOTFQ_AURA = "228050";
  const NATURES_GUARDIAN = "31616";

  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("IMMUNITY_IDS is untouched; the save auras are a separate, table-free set", () => {
    for (const id of IMMUNITY_SAVE_AURA_NAMES.keys()) {
      expect(IMMUNITY_IDS.has(id), id).toBe(false);
      expect(id in MITIGATION_TABLE, id).toBe(false);
      expect(isImmunitySaveAura(id), id).toBe(true);
    }
    for (const id of Object.keys(ENEMY_IMMUNITY_SAVE_AURAS))
      expect(IMMUNITY_SAVE_AURA_NAMES.has(id), id).toBe(true);
    expect(isImmunitySaveAura(DIVINE_SHIELD)).toBe(true);
    expect(isImmunitySaveAura(BARKSKIN)).toBe(false);
  });

  it("Feign Death is read from the ledger's own aura table, not a second copy — and is no immunity (ruling D8)", () => {
    const auras = AURA_ONLY_ACTIVATION_IDS["5384"];
    expect(auras).toContain(SURVIVAL_TACTICS);
    expect([...FEIGN_DEATH_ABSORB_AURA_IDS].sort()).toEqual([...auras].sort());
    for (const a of auras) {
      expect(IMMUNITY_SAVE_AURA_NAMES.has(a), a).toBe(false);
      expect(isImmunitySaveAura(a), a).toBe(false);
    }
  });

  it("a self Burrow / Time Stop aura is one `immune` event named after the ability; Feign Death's is an absorb self-save", () => {
    const u = unit("e1", {
      auraEvents: [
        applied(BURROW, "e1", "e1", 10),
        removed(BURROW, "e1", "e1", 15),
        applied(TIME_STOP, "e1", "e1", 30.35),
        removed(TIME_STOP, "e1", "e1", 35.35),
        applied(SURVIVAL_TACTICS, "e1", "e1", 52.6),
        removed(SURVIVAL_TACTICS, "e1", "e1", 54.1),
      ],
      // the Time Stop cast itself (dest = the caster) adds nothing
      spellCastEvents: [cast(TIME_STOP, "e1", 30.35)],
    });
    const evs = enemyDefensiveEvents(u, [u], combat);
    expect(
      evs.map((e) => [e.kind, e.effect, e.spellName, e.atSeconds]),
    ).toEqual([
      ["immune", undefined, "Burrow", 10],
      ["immune", undefined, "Time Stop", 30.35],
      ["self-save", "absorb", "Feign Death", 52.6],
    ]);
    expect(evs[0].observedSeconds).toBeCloseTo(5, 5);
    // the shield lasts its aura; with no absorb line in the log, no amount
    expect(evs[2].observedSeconds).toBeCloseTo(1.5, 5);
    expect(evs[2].absorbedAmount).toBeUndefined();
  });

  it("Time Stop cast on an ally is an external timed by the ally's aura, with no during-it interval", () => {
    const evoker = unit("e1", { spellCastEvents: [cast(TIME_STOP, "e2", 40)] });
    const ally = unit("e2", {
      auraEvents: [
        applied(TIME_STOP, "e1", "e2", 40),
        removed(TIME_STOP, "e1", "e2", 45),
      ],
    });
    const evs = enemyDefensiveEvents(evoker, [evoker, ally], combat);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ kind: "external", recipientId: "e2" });
    expect(evs[0].observedSeconds).toBeCloseTo(5, 5);
    expect(evs[0].auraFromS).toBeUndefined();
    // the ally itself did not press anything
    expect(enemyDefensiveEvents(ally, [evoker, ally], combat)).toEqual([]);
  });

  it("Guardian of the Forgotten Queen: the paladin's cast is the external, timed by the guardian's 228050 on the ally", () => {
    // dfcccbf2 round 5: cast 47.549 → 228050 from the summoned guardian 47.777
    const pal = unit("e1", {
      spellCastEvents: [cast(GOTFQ_CAST, "e2", 47.549)],
    });
    const warrior = unit("e2", {
      auraEvents: [
        applied(GOTFQ_AURA, "guardian", "e2", 47.777),
        removed(GOTFQ_AURA, "guardian", "e2", 53.777),
      ],
    });
    const evs = enemyDefensiveEvents(pal, [pal, warrior], combat);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({
      kind: "external",
      spellId: GOTFQ_CAST,
      recipientId: "e2",
      atSeconds: 47.549,
    });
    expect(evs[0].observedSeconds).toBeCloseTo(6, 5);
    // the guardian-sourced aura is not "the warrior pressed an immunity"
    expect(enemyDefensiveEvents(warrior, [pal, warrior], combat)).toEqual([]);
  });

  it("Nature's Guardian: the self heal is a `heal proc` self-save without a duration (ruling D8 — it was `immune`)", () => {
    const sham = unit("e1", {
      healIn: [
        {
          spellId: NATURES_GUARDIAN,
          srcUnitId: "e1",
          destUnitId: "e1",
          effectiveAmount: 150_000,
          logLine: {
            event: LogEvent.SPELL_HEAL,
            timestamp: ms(77),
            parameters: [],
          },
        },
        // somebody else's heal with a different id is nothing
        {
          spellId: "8004",
          srcUnitId: "e2",
          destUnitId: "e1",
          effectiveAmount: 50_000,
          logLine: {
            event: LogEvent.SPELL_HEAL,
            timestamp: ms(78),
            parameters: [],
          },
        },
      ],
    });
    const evs = enemyDefensiveEvents(sham, [sham], combat);
    expect(
      evs.map((e) => [e.kind, e.effect, e.spellName, e.atSeconds]),
    ).toEqual([["self-save", "heal proc", "Nature's Guardian", 77]]);
    expect(evs[0].observedSeconds).toBeUndefined();
  });

  it("Cheat Death / Cauterize: the proc's own aura is a `cheat-death proc` self-save at the moment it fired — no duration", () => {
    for (const [auraId, name] of [
      ["45182", "Cheat Death"],
      ["87023", "Cauterize"],
    ] as const) {
      const u = unit("e1", {
        auraEvents: [
          applied(auraId, "e1", "e1", 40),
          removed(auraId, "e1", "e1", 43),
        ],
      });
      const evs = enemyDefensiveEvents(u, [u], combat);
      expect(evs, name).toHaveLength(1);
      expect(evs[0], name).toMatchObject({
        kind: "self-save",
        effect: "cheat-death proc",
        spellName: name,
        atSeconds: 40,
        removedEarly: false,
      });
      // the aura the proc leaves is not how long anything protected the unit
      expect(evs[0].observedSeconds, name).toBeUndefined();
      expect(evs[0].earlyEnd, name).toBeUndefined();
    }
  });

  it("Feign Death's amount is the SPELL_ABSORBED lines that name its aura while it was up — 0e0663e6 0:21: 594,477 → 530,795", () => {
    const absorbedLine = (
      atS: number,
      amount: number,
      shield: string,
    ): any => ({
      spellId: shield,
      spellName: `S${shield}`,
      srcUnitId: "e1",
      srcUnitName: "e1",
      destUnitId: "e1",
      destUnitName: "e1",
      attackerId: "f1",
      absorbedAmount: amount,
      timestamp: ms(atS),
      logLine: {
        event: LogEvent.SPELL_ABSORBED,
        timestamp: ms(atS),
        parameters: [],
      },
    });
    const hunter = unit("e1", {
      auraEvents: [
        { ...applied(SURVIVAL_TACTICS, "e1", "e1", 21.3), amount: 594_477 },
        { ...removed(SURVIVAL_TACTICS, "e1", "e1", 23.3), amount: 530_795 },
      ],
      absorbsIn: [
        absorbedLine(21.4, 3_002, SURVIVAL_TACTICS),
        absorbedLine(22.0, 40_000, SURVIVAL_TACTICS),
        absorbedLine(23.1, 20_680, SURVIVAL_TACTICS),
        // another shield on the hunter is not Feign Death's
        absorbedLine(22.5, 9_000, "17"),
        // …nor is a hit after the aura dropped
        absorbedLine(24, 5_000, SURVIVAL_TACTICS),
      ],
    });
    const [d] = enemyDefensiveEvents(hunter, [hunter], combat);
    expect(d).toMatchObject({
      kind: "self-save",
      effect: "absorb",
      absorbedAmount: 63_682,
      removedEarly: false,
    });
    expect(d.observedSeconds).toBeCloseTo(2, 5);
    // the same reader, called directly
    const [iv] = saveAuraIntervals(hunter, [hunter], combat);
    expect(absorbedDuring(hunter, iv, combat.startTime)).toBe(63_682);
  });

  it("effectSaves is the one reader of the four: Feign Death's aura, the two proc auras, the heal — the unit's OWN only", () => {
    const u = unit("e1", {
      auraEvents: [
        applied(SURVIVAL_TACTICS, "e1", "e1", 10),
        removed(SURVIVAL_TACTICS, "e1", "e1", 12),
        applied("87023", "e1", "e1", 30),
        removed("87023", "e1", "e1", 36),
        // somebody else's aura of the same id on this unit is not its save
        applied("45182", "e2", "e1", 50),
        removed("45182", "e2", "e1", 53),
        // a wall and an immunity are not effect saves
        applied(BARKSKIN, "e1", "e1", 60),
        removed(BARKSKIN, "e1", "e1", 72),
        applied(BURROW, "e1", "e1", 80),
        removed(BURROW, "e1", "e1", 85),
      ],
      healIn: [
        {
          spellId: NATURES_GUARDIAN,
          srcUnitId: "e1",
          destUnitId: "e1",
          effectiveAmount: 1,
          logLine: {
            event: LogEvent.SPELL_HEAL,
            timestamp: ms(20),
            parameters: [],
          },
        },
        // the same heal id from another unit is not this unit's proc
        {
          spellId: NATURES_GUARDIAN,
          srcUnitId: "e2",
          destUnitId: "e1",
          effectiveAmount: 1,
          logLine: {
            event: LogEvent.SPELL_HEAL,
            timestamp: ms(25),
            parameters: [],
          },
        },
      ],
    });
    const saves = effectSaves(
      u,
      saveAuraIntervals(u, [u], combat),
      combat.startTime,
    );
    expect(saves.map((s) => [s.atSeconds, s.spellName, s.effect])).toEqual([
      [10, "Feign Death", "absorb"],
      [20, "Nature's Guardian", "heal proc"],
      [30, "Cauterize", "cheat-death proc"],
    ]);
    expect(saves[1].interval).toBeUndefined();
    expect(saves[0].interval?.spellId).toBe(SURVIVAL_TACTICS);
  });

  /**
   * Game-Behaviour rule, the DB2 leg, re-read on every run: what each of the
   * four IS in the official data, and that none of them carries a school
   * immunity. A build that changes one turns this red.
   */
  it("DB2: Feign Death's aura is an all-school absorb, Nature's Guardian a heal, Cheat Death / Cauterize aura 316 on every school — none an immunity", () => {
    for (const a of FEIGN_DEATH_ABSORB_AURA_IDS) {
      expect(ABILITY_EFFECTS_GENERATED[a]?.absorbs, a).toBe(true);
      expect(ABILITY_EFFECTS_GENERATED[a]?.absorbSchoolMask, a).toBe(0x7f);
      expect(immunitySchoolMask(a), a).toBeUndefined();
    }
    const rows = (
      talentEffectInventory as {
        rows: Array<{
          spellId: string;
          effect: number;
          aura: number;
          misc0: number;
          basePoints: number;
        }>;
      }
    ).rows;
    const rowsOf = (id: string) => rows.filter((r) => r.spellId === id);
    // Nature's Guardian 31616: effect 136 (heal, % of max health), 40
    expect(ABILITY_EFFECTS_GENERATED["31616"]?.healsSelf).toBe(true);
    expect(
      rowsOf("31616").map((r) => [r.effect, r.aura, r.basePoints]),
    ).toEqual([[136, 0, 40]]);
    // the talents behind the two proc auras: aura 316, mask 127
    for (const talent of ["31230", "86949"])
      expect(
        rowsOf(talent).some((r) => r.aura === 316 && r.misc0 === 0x7f),
        talent,
      ).toBe(true);
    for (const id of [...Object.keys(ENEMY_PROC_SAVES), "31230", "86949"]) {
      expect(immunitySchoolMask(id), id).toBeUndefined();
      expect(
        rowsOf(id).some((r) => r.aura === 39),
        id,
      ).toBe(false);
      expect(id in MITIGATION_TABLE, id).toBe(false);
      expect(isImmunitySaveAura(id), id).toBe(false);
    }
  });

  it("the proc saves read the same as the owner-side CRISIS_PROC_ANSWERS: heal → proc, aura → cheatDeath, same names", () => {
    for (const [id, p] of Object.entries(ENEMY_PROC_SAVES)) {
      const owner = CRISIS_PROC_ANSWERS.get(id);
      expect(owner, id).toBeDefined();
      expect(owner!.name, id).toBe(p.name);
      expect(owner!.via, id).toBe(p.via);
      expect(owner!.kind, id).toBe(
        p.effect === "cheat-death proc" ? "cheatDeath" : "proc",
      );
    }
    // and every cheat-death the owner side knows is one here
    for (const [id, a] of CRISIS_PROC_ANSWERS)
      if (a.kind === "cheatDeath")
        expect(ENEMY_PROC_SAVES[id]?.effect, id).toBe("cheat-death proc");
  });

  it("the rendered note and its reader agree: every effect, with and without an amount", () => {
    expect(enemySaveEffectNote("absorb", 63_682, "2.0s")).toBe(
      "absorb 64k, 2.0s",
    );
    expect(enemySaveEffectNote("absorb", undefined, "2.0s")).toBe(
      "absorb, 2.0s",
    );
    expect(enemySaveEffectNote("absorb", 300, "0.4s — removed early")).toBe(
      "absorb <1k, 0.4s — removed early",
    );
    expect(enemySaveEffectNote("heal proc", undefined, "")).toBe("heal proc");
    expect(enemySaveEffectNote("cheat-death proc", undefined, "")).toBe(
      "cheat-death proc",
    );
    for (const [effect, amount, dur] of [
      ["absorb", 63_682, "2.0s"],
      ["absorb", undefined, "2.0s"],
      ["absorb", 300, "0.4s — removed early"],
      ["absorb", 594_000, "1.2s — used up"],
      ["heal proc", undefined, ""],
      ["cheat-death proc", undefined, ""],
    ] as const)
      expect(
        enemySaveEffectOfNote(
          `(${enemySaveEffectNote(effect, amount, dur)}) (at 67% HP)`,
        ),
        `${effect} ${amount}`,
      ).toBe(effect);
    for (const other of [
      "(immune, 2.0s)",
      "(30%, 12.0s)",
      "(self-save)",
      "(area)",
      "",
    ])
      expect(enemySaveEffectOfNote(other), other).toBeUndefined();
    expect([...ENEMY_SAVE_EFFECT_BY_NAME].sort()).toEqual([
      ["Cauterize", "cheat-death proc"],
      ["Cheat Death", "cheat-death proc"],
      ["Feign Death", "absorb"],
      ["Nature's Guardian", "heal proc"],
    ]);
  });
});

/**
 * Triage 2026-09-29, enemy-def F-E12: a second APPLIED of an aura that is
 * still up is the same press re-announced, not a second press.
 */
describe("a re-applied aura with no REMOVED between is one press (F-E12)", () => {
  const GUARDIAN_SPIRIT = "47788";

  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("f4eb8c87 2:47: Divine Shield applied, re-applied 0.87 s later, removed at 8.0 s → one 8.0 s immunity", () => {
    const pal = unit("e1", {
      spellCastEvents: [cast(DIVINE_SHIELD, "e1", 47.295)],
      auraEvents: [
        applied(DIVINE_SHIELD, "e1", "e1", 47.293),
        applied(DIVINE_SHIELD, "e1", "e1", 48.159),
        removed(DIVINE_SHIELD, "e1", "e1", 55.299),
      ],
    });
    const evs = enemyDefensiveEvents(pal, [pal], combat);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ kind: "immune", atSeconds: 47.293 });
    expect(evs[0].observedSeconds).toBeCloseTo(8.006, 3);
    expect(evs[0].removedEarly).toBe(false);
  });

  it("69546267 2:05: Guardian Spirit on an ally, re-applied 1.6 s later → one external, full duration, not removed early", () => {
    const priest = unit("e1", {
      spellCastEvents: [cast(GUARDIAN_SPIRIT, "e2", 5.975)],
    });
    const mage = unit("e2", {
      auraEvents: [
        applied(GUARDIAN_SPIRIT, "e1", "e2", 5.975),
        applied(GUARDIAN_SPIRIT, "e1", "e2", 7.587),
        removed(GUARDIAN_SPIRIT, "e1", "e2", 17.973),
      ],
    });
    const evs = enemyDefensiveEvents(priest, [priest, mage], combat);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ kind: "external", recipientId: "e2" });
    expect(evs[0].observedSeconds).toBeCloseTo(11.998, 3);
    expect(evs[0].removedEarly).toBe(false);
  });

  it("two real presses stay two: a second cast behind the second APPLIED keeps the split", () => {
    const iv = (fromS: number, toS: number, inferredEnd: boolean) => ({
      spellId: BARKSKIN,
      spellName: "Barkskin",
      srcUnitName: "e1",
      fromS,
      toS,
      inferredStart: false,
      inferredEnd,
    });
    const split = [iv(10, 14, true), iv(14, 26, false)];
    expect(joinReappliedIntervals(split, () => [10])).toEqual([
      iv(10, 26, false),
    ]);
    expect(joinReappliedIntervals(split, () => [])).toEqual([
      iv(10, 26, false),
    ]);
    expect(joinReappliedIntervals(split, () => [10, 14])).toEqual(split);
    // a real end (REMOVED logged) followed by a new application is never joined
    const ended = [iv(10, 14, false), iv(14, 26, false)];
    expect(joinReappliedIntervals(ended, () => [10])).toEqual(ended);
    // a gap between the two is not a re-announce
    const gap = [iv(10, 14, true), iv(15, 26, false)];
    expect(joinReappliedIntervals(gap, () => [10])).toEqual(gap);
  });
});

/**
 * Triage 2026-09-29, enemy-def F-E1a: Blur and Greater Invisibility are table
 * rows keyed by the cast id; the log carries another aura id on the caster.
 */
const castEffectAuras = castEffectAurasJson as unknown as {
  casts: Record<
    string,
    { aura: string; casts: number; hits: number; via: string }[]
  >;
};

describe("a wall keyed by its cast is found under its logged aura (F-E1a)", () => {
  const BLUR_CAST = "198589";
  const BLUR_AURA = "212800";
  const GI_CAST = "110959";
  const GI_AURA = "110960";

  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("the alias points at real table rows and never at an aura that is itself a row", () => {
    for (const [aura, castId] of Object.entries(SELF_WALL_AURA_TO_CAST_ID)) {
      expect(MITIGATION_TABLE[castId], castId).toBeDefined();
      expect(MITIGATION_TABLE[aura], aura).toBeUndefined();
      expect(MITIGATION_AURA_IDS.has(castId), castId).toBe(true);
      expect(wallTableIdOfAura(aura)).toBe(castId);
    }
    expect(wallTableIdOfAura(BARKSKIN)).toBe(BARKSKIN);
  });

  it("FT-T05: every table row whose cast logs a same-named aura under another id is linked (forward check against the generated cast→aura table)", () => {
    // rows read some other way than "an aura with the row's id on the unit":
    // an area save renders from its cast (ENEMY_AREA_SAVE_IDS)
    const readFromCast = new Set(["98008"]); // Spirit Link Totem
    const linked = new Set(Object.values(SELF_WALL_AURA_TO_CAST_ID));
    const unlinked: string[] = [];
    for (const castId of Object.keys(MITIGATION_TABLE)) {
      if (linked.has(castId) || readFromCast.has(castId)) continue;
      for (const e of castEffectAuras.casts[castId] ?? []) {
        // the cast's own buff: applied by (nearly) every cast, under the
        // cast's name — not a rider another talent adds to some casts
        if (e.aura === castId || !e.via.includes("name")) continue;
        if (e.hits / e.casts < 0.9) continue;
        unlinked.push(`${castId} → ${e.aura} (${e.hits}/${e.casts})`);
      }
    }
    expect(unlinked).toEqual([]);
    expect(SELF_WALL_AURA_TO_CAST_ID["120954"]).toBe("115203");
  });

  it("an enemy Fortifying Brew: one self wall at 20 %, timed by the 120954 aura", () => {
    const monk = unit("e1", {
      spec: "269",
      spellCastEvents: [cast("115203", "0000000000000000", 40)],
      auraEvents: [
        applied("120954", "e1", "e1", 40),
        removed("120954", "e1", "e1", 55),
      ],
    });
    const evs = enemyDefensiveEvents(monk, [monk], combat);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({
      kind: "self",
      spellId: "120954",
      pct: MITIGATION_TABLE["115203"].pct,
      atSeconds: 40,
    });
    expect(evs[0].observedSeconds).toBeCloseTo(15, 5);
  });

  it("an enemy Blur: one self wall at 25 %, timed by the 212800 aura", () => {
    const dh = unit("e1", {
      spec: "577",
      spellCastEvents: [cast(BLUR_CAST, "0000000000000000", 82)],
      auraEvents: [
        applied(BLUR_AURA, "e1", "e1", 82),
        removed(BLUR_AURA, "e1", "e1", 92),
      ],
    });
    const evs = enemyDefensiveEvents(dh, [dh], combat);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({
      kind: "self",
      spellId: BLUR_AURA,
      pct: MITIGATION_TABLE[BLUR_CAST].pct,
      atSeconds: 82,
    });
    expect(evs[0].observedSeconds).toBeCloseTo(10, 5);
  });

  it("an enemy Greater Invisibility: one self wall at the signed 60 %, from the 110960 aura", () => {
    const mage = unit("e1", {
      spec: "63",
      spellCastEvents: [cast(GI_CAST, "0000000000000000", 40)],
      auraEvents: [
        applied(GI_AURA, "e1", "e1", 40),
        removed(GI_AURA, "e1", "e1", 60),
      ],
    });
    const evs = enemyDefensiveEvents(mage, [mage], combat);
    expect(evs.map((e) => [e.kind, e.pct])).toEqual([["self", 60]]);
  });
});

/**
 * Triage 2026-09-29, enemy-def F-E1b + crisis-external F-A1b (ruling A15):
 * an area save is one `area` event per cast — the caster and the second.
 */
describe("area saves are anchored on the cast (F-E1b / F-A1b)", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("the area saves are friendly-roster externals with a nil-dest cast", () => {
    for (const id of ENEMY_AREA_SAVE_IDS)
      expect(EXTERNAL_DEF_IDS.has(id), id).toBe(true);
  });

  it.each([
    ["51052", "Anti-Magic Zone"],
    ["196718", "Darkness"],
    ["97462", "Rallying Cry"],
    // user ruling P-E1b2 (2026-10-01): the same shape, the same line
    ["98008", "Spirit Link Totem"],
    ["62618", "Power Word: Barrier"],
  ])("%s (%s): one `area` event, no recipient, no duration", (id) => {
    const caster = unit("e1", {
      spellCastEvents: [cast(id, "0000000000000000", 99.55)],
    });
    const mate = unit("e2", {
      // Rallying Cry's 97463 / Anti-Magic Zone's 145629 / Spirit Link's 325174
      // / Barrier's 81782 on a teammate add nothing
      auraEvents: [
        applied("97463", "e1", "e2", 99.55),
        applied("325174", "totem", "e2", 99.6),
        applied("81782", "barrier", "e2", 99.6),
      ],
    });
    const evs = enemyDefensiveEvents(caster, [caster, mate], combat);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({
      kind: "area",
      spellId: id,
      atSeconds: 99.55,
    });
    expect(evs[0].recipientId).toBeUndefined();
    expect(evs[0].observedSeconds).toBeUndefined();
    expect(evs[0].pct).toBeUndefined();
    expect(enemyDefensiveEvents(mate, [caster, mate], combat)).toEqual([]);
  });
});

/**
 * Triage 2026-09-29: Anti-Magic Shell (enemy-def F-E7's AMS half, crisis-
 * external F-A7; rulings A7, A11, A7-补) and the school masks KILL ATTEMPTS
 * gates on (F-E24, ruling A30).
 */
describe("Anti-Magic Shell routing and the school-limited save masks", () => {
  const AMS_SELF = "48707";
  const AMS_ALLY = "410358";
  const BOP = "1022";
  const SPELLWARDING = "204018";

  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("48707 is a self-save only; 410358 is an external on an ally and a self-save on oneself; neither is a table row", () => {
    expect(SELF_SAVE_IDS.has(AMS_SELF)).toBe(true);
    expect(isExternalSaveId(AMS_SELF)).toBe(false);
    expect(SELF_SAVE_IDS.has(AMS_ALLY)).toBe(true);
    expect(isExternalSaveId(AMS_ALLY)).toBe(true);
    expect(MITIGATION_TABLE[AMS_SELF]).toBeUndefined();
    expect(MITIGATION_TABLE[AMS_ALLY]).toBeUndefined();
    // and it stays out of the friendly missed-options roster
    expect(spellIdLists.externalDefensiveSpellIds.includes(AMS_ALLY)).toBe(
      false,
    );
  });

  it("410358 on an ally renders as an external timed by the ally's aura; on oneself as a self-save", () => {
    const dk = unit("e1", {
      spellCastEvents: [cast(AMS_ALLY, "e2", 9.684), cast(AMS_ALLY, "e1", 47)],
      auraEvents: [
        applied(AMS_ALLY, "e1", "e1", 47),
        removed(AMS_ALLY, "e1", "e1", 52),
      ],
    });
    const evoker = unit("e2", {
      auraEvents: [
        applied(AMS_ALLY, "e1", "e2", 9.684),
        removed(AMS_ALLY, "e1", "e2", 15.684),
      ],
    });
    const evs = enemyDefensiveEvents(dk, [dk, evoker], combat);
    expect(evs.map((e) => [e.kind, e.recipientId])).toEqual([
      ["external", "e2"],
      ["self-save", undefined],
    ]);
    expect(evs[0].observedSeconds).toBeCloseTo(6, 5);
  });

  it("an external's aura is the one from THAT caster, nearest to its cast (two Death Knights' shells 0.8 s apart)", () => {
    const iv = (src: string, fromS: number, toS: number) => ({
      spellId: AMS_ALLY,
      spellName: "Anti-Magic Shell",
      srcUnitName: src,
      srcUnitId: src,
      fromS,
      toS,
      inferredStart: false,
      inferredEnd: false,
    });
    const intervals = [iv("dk1", 8.8, 9.2), iv("dk2", 9.6, 15.6)];
    expect(externalAuraOf(AMS_ALLY, 8.8, intervals, "dk1")?.toS).toBe(9.2);
    expect(externalAuraOf(AMS_ALLY, 9.0, intervals, "dk2")?.toS).toBe(15.6);
    // no caster known: the nearest application
    expect(externalAuraOf(AMS_ALLY, 9.5, intervals)?.toS).toBe(15.6);
  });

  it("410358 seen only as the ally's aura (the cast is missing from the log) still lists, once", () => {
    const dk = unit("e1", {});
    const evoker = unit("e2", {
      auraEvents: [
        applied(AMS_ALLY, "e1", "e2", 9.684),
        removed(AMS_ALLY, "e1", "e2", 15.684),
      ],
    });
    const evs = enemyDefensiveEvents(dk, [dk, evoker], combat);
    expect(evs.map((e) => [e.kind, e.recipientId, e.atSeconds])).toEqual([
      ["external", "e2", 9.684],
    ]);
    // with the cast logged, the aura is that cast's — no second line
    const logged = unit("e1", {
      spellCastEvents: [cast(AMS_ALLY, "e2", 9.684)],
    });
    expect(enemyDefensiveEvents(logged, [logged, evoker], combat)).toHaveLength(
      1,
    );
  });

  it("an immunity lasts its aura for a pct-100 table row, an aura with DB2's all-school immunity, and Burrow / Vanish / Mass Invisibility (rulings U-KA3, U-KA3b)", () => {
    // table rows
    for (const id of ["642", "45438", BOP, SPELLWARDING])
      expect(immunityLastsItsAura(id), id).toBe(true);
    // Time Stop, Guardian of the Forgotten Queen: aura 39, every school
    for (const id of ["378441", "228050"]) {
      expect(immunitySchoolMask(id), id).toBe(0x7f);
      expect(immunityLastsItsAura(id), id).toBe(true);
    }
    // Burrow and Vanish: user ruling U-KA3 (2026-10-06) — the unit cannot
    // be attacked while the aura is up; a DoT already on it and area damage
    // still land, and are not evidence against the immunity. Neither has a
    // school immunity in DB2, so the signed list is what admits them.
    // Mass Invisibility: U-KA3b, "和消失一样算免疫".
    for (const id of ["409293", "11327", "414664"]) {
      expect(isImmunitySaveAura(id), id).toBe(true);
      expect(immunitySchoolMask(id) ?? 0, id).not.toBe(0x7f);
      expect(ENEMY_IMMUNITY_HOLDS_ITS_AURA_IDS.has(id), id).toBe(true);
      expect(immunityLastsItsAura(id), id).toBe(true);
    }
    // Cheat Death, Cauterize, Feign Death's Survival Tactics: no immunity at
    // all since ruling D8 (other-than-periodic damage lands through 7 / 10,
    // 62 / 72 and 1,135 / 1,474 of their auras) — they were `immune` auras
    // that did not last (A25) before it
    for (const id of ["45182", "87023", "202748"]) {
      expect(isImmunitySaveAura(id), id).toBe(false);
      expect(immunityLastsItsAura(id), id).toBe(false);
    }
    // so every aura left in the immunity list holds while it is up
    for (const id of IMMUNITY_SAVE_AURA_NAMES.keys())
      expect(immunityLastsItsAura(id), id).toBe(true);
    // the signed list never admits an aura the enemy-save predicate does not know
    for (const id of ENEMY_IMMUNITY_HOLDS_ITS_AURA_IDS)
      expect(id in ENEMY_IMMUNITY_SAVE_AURAS, id).toBe(true);
  });

  it("already-up immunities: the ruled-in stealth-kind auras count only when the log saw them end (ruling P-FU-b8)", () => {
    const iv = (spellId: string, inferredEnd: boolean) => ({
      spellId,
      inferredEnd,
    });
    for (const id of ["409293", "11327", "414664"]) {
      expect(immunityCountsWhenAlreadyUp(iv(id, false)), id).toBe(true);
      // closed at the official length because the REMOVED was lost
      expect(immunityCountsWhenAlreadyUp(iv(id, true)), id).toBe(false);
    }
    // a pct-100 table row and a DB2 all-school immunity keep the cap
    for (const id of ["642", "45438", "378441"])
      expect(immunityCountsWhenAlreadyUp(iv(id, true)), id).toBe(true);
    // an effect save (ruling D8) is no immunity, up or not
    for (const id of ["87023", "45182", "202748"])
      expect(immunityCountsWhenAlreadyUp(iv(id, false)), id).toBe(false);
  });

  it("the absorb mask is the DB2 one (datagen), read through cd-hoarded's saveSchoolMask — no literal", () => {
    for (const id of [AMS_SELF, AMS_ALLY]) {
      const db2 = ABILITY_EFFECTS_GENERATED[id]?.absorbSchoolMask;
      expect(db2, id).toBeDefined();
      expect(limitedAbsorbSchoolMask(id)).toBe(db2);
      expect(limitedAbsorbSchoolMask(id)).toBe(saveSchoolMask(id));
      // magic only: every school bit but physical
      expect((db2! & 0x1) === 0 && (db2! & 0x7e) === 0x7e).toBe(true);
      // not an immunity
      expect(limitedImmunitySchoolMask(id)).toBeUndefined();
    }
    // an all-school absorb and a %-wall are not gated
    expect(limitedAbsorbSchoolMask("11426")).toBeUndefined(); // Ice Barrier
    expect(limitedAbsorbSchoolMask(BARKSKIN)).toBeUndefined();
  });

  it("a school-limited immunity's mask is its pct-100 table row's; a full immunity and a wall have none", () => {
    expect(limitedImmunitySchoolMask(BOP)).toBe(
      MITIGATION_TABLE[BOP].schoolMask,
    );
    expect(limitedImmunitySchoolMask(BOP)).toBe(0x1);
    expect(limitedImmunitySchoolMask(SPELLWARDING)).toBe(0x7e);
    expect(limitedImmunitySchoolMask(DIVINE_SHIELD)).toBeUndefined();
    expect(limitedImmunitySchoolMask(BARKSKIN)).toBeUndefined();
    // a table row is never read as an absorb
    expect(limitedAbsorbSchoolMask(BOP)).toBeUndefined();
  });
});

/** crisis-external F-A9: the Ultimate Sacrifice cast id of Blessing of
 * Sacrifice is an enemy external, and stays out of the friendly roster (a
 * second roster row for the same button doubled the missed-option line). */
describe("Blessing of Sacrifice 199448 (Ultimate Sacrifice)", () => {
  const BOSAC_HOLY = "199448";

  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("is an external save for the enemy predicate and absent from the friendly rosters", () => {
    expect(isExternalSaveId(BOSAC_HOLY)).toBe(true);
    expect(EXTERNAL_DEF_IDS.has(BOSAC_HOLY)).toBe(false);
    expect(spellIdLists.externalDefensiveSpellIds.includes(BOSAC_HOLY)).toBe(
      false,
    );
    expect(BOSAC_HOLY in EXTERNAL_DEFENSIVE_SPELLS).toBe(false);
  });

  it("renders as an external timed by the recipient's 199448 aura (7f67e778 4:46)", () => {
    const pal = unit("e1", {
      spellCastEvents: [cast(BOSAC_HOLY, "e2", 46)],
    });
    const warrior = unit("e2", {
      auraEvents: [
        applied(BOSAC_HOLY, "e1", "e2", 46),
        removed(BOSAC_HOLY, "e1", "e2", 52),
      ],
    });
    const evs = enemyDefensiveEvents(pal, [pal, warrior], combat);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ kind: "external", recipientId: "e2" });
    expect(evs[0].observedSeconds).toBeCloseTo(6, 5);
  });
});
