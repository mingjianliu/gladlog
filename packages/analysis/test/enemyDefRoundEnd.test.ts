/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * One round end for every line that says "the round ended" (2026-10-11):
 * `roundEndMs` — a Solo Shuffle round's first player death, else the log's
 * end. `[ENEMY DEF] … (Ns — still up when the round ended)` counted to the
 * LOG's end, ~2 s after the death that `[BUFF FADED]` / `[ENEMY BUFF END]` /
 * the control lines stop at (605-file capture: 360 of the 432 such lines in
 * Solo Shuffle contexts end outside the death's second).
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { SYNC_LOCK_ENDED_BY_ROUND_END } from "../src/analysis/candidates/cooldownTiming";
import { emitEnemyDefEntries } from "../src/context/timelineSections/enemyDef";
import { ensureAnalysisData } from "../src/data/ensure";
import { CC_STILL_ON_AT_ROUND_END } from "../src/utils/ccTrinketAnalysis";
import {
  ENEMY_DEF_END_NOT_LOGGED,
  enemyDefensiveEvents,
} from "../src/utils/enemyDefensives";
import {
  AURA_STILL_UP_AT_ROUND_END,
  ROUND_ENDED_WORDS,
  roundEndLegend,
  roundEndMs,
  SOLO_SHUFFLE_BRACKET,
} from "../src/utils/roundEnd";

const MATCH_START = Date.UTC(2026, 9, 11);
const ms = (s: number): number => MATCH_START + Math.round(s * 1000);
const BARKSKIN = "22812"; // wall, 8 s base
const DIVINE_SHIELD = "642"; // 8 s
const IRONBARK = "102342"; // external, 12 s
const VANISH_AURA = "11327"; // its carrier goes unseen
const SURVIVAL_TACTICS = "202748"; // Feign Death's shield

function unit(id: string, over: Record<string, unknown> = {}): any {
  return {
    id,
    name: id,
    type: 1,
    spec: "105",
    reaction: 1,
    info: {},
    auraEvents: [],
    actionIn: [],
    absorbsIn: [],
    damageOut: [],
    damageIn: [],
    healIn: [],
    deathRecords: [],
    advancedActions: [],
    ...over,
    // F15 C5: a wall aura the unit put on itself is a PRESS in these
    // fixtures — the cast the log writes beside it (an aura with no press
    // of it is a copy: `noPressLogged`)
    spellCastEvents: [
      ...((over.spellCastEvents as any[] | undefined) ?? []),
      ...((over.auraEvents as any[] | undefined) ?? [])
        .filter(
          (a) =>
            a.logLine?.event === LogEvent.SPELL_AURA_APPLIED &&
            a.srcUnitId === id &&
            (a.destUnitId ?? id) === id,
        )
        .map((a) => ({
          spellId: a.spellId,
          spellName: a.spellName,
          srcUnitId: id,
          destUnitId: id,
          timestamp: a.timestamp,
          logLine: {
            event: LogEvent.SPELL_CAST_SUCCESS,
            timestamp: a.logLine.timestamp,
            parameters: [],
          },
        })),
    ],
  };
}
const aura = (
  event: LogEvent,
  spellId: string,
  src: string,
  dest: string,
  atS: number,
): any => ({
  spellId,
  spellName: `S${spellId}`,
  srcUnitId: src,
  srcUnitName: src,
  destUnitId: dest,
  destUnitName: dest,
  timestamp: ms(atS),
  logLine: { event, timestamp: ms(atS), parameters: [] },
  auraType: "BUFF",
});
const applied = (id: string, src: string, dest: string, atS: number) =>
  aura(LogEvent.SPELL_AURA_APPLIED, id, src, dest, atS);
const removed = (id: string, src: string, dest: string, atS: number) =>
  aura(LogEvent.SPELL_AURA_REMOVED, id, src, dest, atS);
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
const absorbedBy = (spellId: string, atS: number, amount: number): any => ({
  spellId,
  spellName: `S${spellId}`,
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

// a Solo Shuffle round: the ending death at 148.4 s, the log's end 2 s later
const DEATH_S = 148.4;
const LOG_END_S = 150.4;
const combat = { startTime: ms(0), endTime: ms(LOG_END_S) };

function render(enemies: any[], roundEndS: number | undefined): string[] {
  const lines: string[] = [];
  emitEnemyDefEntries({
    matchStartMs: combat.startTime,
    matchEndSeconds: LOG_END_S,
    ...(roundEndS === undefined ? {} : { roundEndAtMs: ms(roundEndS) }),
    enemies,
    enemyPid: (n: string) => `E:${n}`,
    friends: [unit("f1")],
    roundBounds: undefined,
    pid: (n: string) => `F:${n}`,
    actorLabel: (n: string, side: "friendly" | "enemy") =>
      side === "friendly" ? `F:${n}` : `E:${n}`,
    addEntry: (_t: number, line: string) => lines.push(line),
    _allUnits: enemies,
  } as never);
  return lines;
}
/** the line from the ability's name on */
const body = (line: string): string => line.slice(line.indexOf("): ") + 3);

describe("[ENEMY DEF] reads the round's end from roundEndMs, not from the log's end", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("a wall pressed 1.4 s before the round-ending death, its REMOVED after the log's end: 1.4s, not the 3.4 s to the log's end", () => {
    // s0/101-1-549 2:27: `Barkskin (30%, 3.5s — still up when the round
    // ended)` under a `[DEATH]` at 2:28 — the line's end was 2:30.5
    const druid = unit("e1", {
      auraEvents: [applied(BARKSKIN, "e1", "e1", 147)],
    });
    const [line] = render([druid], DEATH_S);
    expect(line.startsWith("2:27  [ENEMY DEF]")).toBe(true);
    expect(body(line)).toMatch(
      new RegExp(
        `^Barkskin \\(\\d+%, 1\\.4s — ${AURA_STILL_UP_AT_ROUND_END}\\)`,
      ),
    );
    // read against the log's end (no round end passed) it is the old line
    expect(body(render([druid], undefined)[0])).toMatch(
      new RegExp(
        `^Barkskin \\(\\d+%, 3\\.4s — ${AURA_STILL_UP_AT_ROUND_END}\\)`,
      ),
    );
    const [d] = enemyDefensiveEvents(druid, [druid], combat, ms(DEATH_S));
    expect(d).toMatchObject({ removedEarly: false, upAtRoundEnd: true });
    expect(d.observedSeconds).toBeCloseTo(1.4, 6);
  });

  it("a REMOVED logged between the death and the log's end is not the aura's end in the round", () => {
    // 5 s into an 8 s Divine Shield at the death, dispelled 1 s after it:
    // the round did not see it end, and nothing after the round is its cause
    const pal = unit("e1", {
      auraEvents: [
        applied(DIVINE_SHIELD, "e1", "e1", 143.4),
        removed(DIVINE_SHIELD, "e1", "e1", 149.4),
      ],
    });
    expect(body(render([pal], DEATH_S)[0])).toBe(
      `Divine Shield (immune, 5.0s — ${AURA_STILL_UP_AT_ROUND_END})`,
    );
    const [d] = enemyDefensiveEvents(pal, [pal], combat, ms(DEATH_S));
    expect(d.earlyEnd).toBeUndefined();
    // one removed AT the death's millisecond did end there, and says how
    const atDeath = unit("e1", {
      auraEvents: [
        applied(DIVINE_SHIELD, "e1", "e1", 143.4),
        removed(DIVINE_SHIELD, "e1", "e1", DEATH_S),
      ],
    });
    expect(body(render([atDeath], DEATH_S)[0])).toBe(
      "Divine Shield (immune, 5.0s — removed early)",
    );
  });

  it("an aura that ended inside the round is untouched", () => {
    const pal = unit("e1", {
      auraEvents: [
        applied(DIVINE_SHIELD, "e1", "e1", 100),
        removed(DIVINE_SHIELD, "e1", "e1", 108),
      ],
    });
    expect(render([pal], DEATH_S)).toEqual(render([pal], undefined));
    expect(body(render([pal], DEATH_S)[0])).toBe(
      "Divine Shield (immune, 8.0s)",
    );
  });

  it("an external across the round's end: the length and the `during it` window both stop there", () => {
    const tree = unit("e1", { spellCastEvents: [cast(IRONBARK, "e2", 145)] });
    const mate = unit("e2", {
      auraEvents: [
        applied(IRONBARK, "e1", "e2", 145),
        removed(IRONBARK, "e1", "e2", 150),
      ],
    });
    const lines = render([tree, mate], DEATH_S);
    expect(lines).toHaveLength(1);
    expect(body(lines[0])).toMatch(
      new RegExp(
        `^Ironbark → E:e2 \\(3\\.4s — ${AURA_STILL_UP_AT_ROUND_END}\\)`,
      ),
    );
  });

  it("a press after the round was over keeps its line and prints no length; an unseen carrier's stays `end not logged`", () => {
    const pal = unit("e1", {
      auraEvents: [applied(DIVINE_SHIELD, "e1", "e1", 149)],
    });
    const [late] = render([pal], DEATH_S);
    expect(late.startsWith("2:29  [ENEMY DEF]")).toBe(true);
    expect(body(late)).toBe("Divine Shield (immune)");
    expect(late).not.toContain(ROUND_ENDED_WORDS);
    const rogue = unit("e1", {
      auraEvents: [applied(VANISH_AURA, "e1", "e1", 147)],
    });
    expect(body(render([rogue], DEATH_S)[0])).toContain(
      `(immune, ${ENEMY_DEF_END_NOT_LOGGED})`,
    );
  });

  it("a shield's `absorb Nk` is what it absorbed up to the round's end", () => {
    const hunter = unit("e1", {
      auraEvents: [
        applied(SURVIVAL_TACTICS, "e1", "e1", 147.4),
        removed(SURVIVAL_TACTICS, "e1", "e1", 149.4),
      ],
      absorbsIn: [
        absorbedBy(SURVIVAL_TACTICS, 148, 30_000),
        // after the round-ending death
        absorbedBy(SURVIVAL_TACTICS, 149, 50_000),
      ],
    });
    expect(body(render([hunter], DEATH_S)[0])).toBe(
      `Feign Death (absorb 30k, 1.0s — ${AURA_STILL_UP_AT_ROUND_END})`,
    );
  });

  it("another bracket: the round's end IS the log's end, and nothing changes", () => {
    const druid = unit("e1", {
      auraEvents: [applied(BARKSKIN, "e1", "e1", 147)],
      deathRecords: [],
    });
    const end = roundEndMs({
      endTime: combat.endTime,
      startInfo: { bracket: "2v2" },
      units: { e1: druid },
    });
    expect(end).toBe(combat.endTime);
    expect(render([druid], (end - combat.startTime) / 1000)).toEqual(
      render([druid], undefined),
    );
  });
});

describe("the round's end is one instant, stated once", () => {
  it("every phrase that states it carries ROUND_ENDED_WORDS — what the legend's presence test keys on", () => {
    for (const phrase of [
      AURA_STILL_UP_AT_ROUND_END,
      CC_STILL_ON_AT_ROUND_END,
      "still channeling when the round ended, 2.1s in",
      "no end logged; the round ended 1.2s after it began",
      "not released before the round ended",
    ])
      expect(phrase, phrase).toContain(ROUND_ENDED_WORDS);
    // the candidate fact `endedBy` names it as a noun, in the findings prompt
    expect(SYNC_LOCK_ENDED_BY_ROUND_END).toBe("the round's end");
  });

  it("the legend says which instant, per bracket", () => {
    const shuffle = roundEndLegend(SOLO_SHUFFLE_BRACKET).join("\n");
    expect(shuffle).toContain(`\`${ROUND_ENDED_WORDS}\` on any line`);
    expect(shuffle).toContain("first player death");
    const other = roundEndLegend("3v3").join("\n");
    expect(other).toContain("the end of the log");
    expect(other).not.toContain("first player death");
    expect(roundEndLegend(undefined)).toEqual(roundEndLegend("2v2"));
  });
});
