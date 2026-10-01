/* eslint-disable @typescript-eslint/no-explicit-any */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { MITIGATION_TABLE } from "../src/data/mitigationData";
import spellIdLists, {
  ENEMY_HEAL_SAVE_IDS,
  ENEMY_REDIRECT_SAVE_IDS,
  ENEMY_SELF_SAVE_ONLY_IDS,
} from "../src/data/spellIdLists";
import { EXTERNAL_DEFENSIVE_SPELLS } from "../src/utils/deathOutcomeAnalysis";
import {
  enemyDefensiveEvents,
  EXTERNAL_DEF_IDS,
  IMMUNITY_IDS,
  isExternalSaveId,
  MITIGATION_AURA_IDS,
  MITIGATION_AURA_MIN_PCT,
  REMOVED_EARLY_SLACK_S,
  SELF_SAVE_IDS,
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
    for (const id of [...ENEMY_HEAL_SAVE_IDS, ...ENEMY_REDIRECT_SAVE_IDS])
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
      ...ENEMY_HEAL_SAVE_IDS,
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
    expect(evs.map((e) => [e.kind, e.recipientId, e.observedSeconds])).toEqual(
      [
        ["external", "e2", undefined],
        ["self-save", undefined, undefined],
      ],
    );
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
