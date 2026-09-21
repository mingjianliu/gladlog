/* eslint-disable @typescript-eslint/no-explicit-any */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { MITIGATION_TABLE } from "../src/data/mitigationData";
import {
  enemyDefensiveEvents,
  EXTERNAL_DEF_IDS,
  IMMUNITY_IDS,
  MITIGATION_AURA_IDS,
  MITIGATION_AURA_MIN_PCT,
  REMOVED_EARLY_SLACK_S,
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

