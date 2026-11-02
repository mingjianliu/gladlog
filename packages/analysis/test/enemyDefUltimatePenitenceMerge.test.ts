/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GH #173 (user 2026-11-02): one Ultimate Penitence press printed an
 * `[ENEMY CD]` line and an `[ENEMY DEF]` line in the same second (137 pairs on
 * 605 files). Its shield and bolts now sit on the `[ENEMY CD]` line, the one
 * the 2026-10-28 ruling names it by.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { emitEnemyDefEntries } from "../src/context/timelineSections/enemyDef";
import { ensureAnalysisData } from "../src/data/ensure";
import { isShieldOnEnemyCdLine } from "../src/utils/enemyDefensives";
import { fmtTime } from "../src/utils/renderGrid";

const MATCH_START = Date.UTC(2026, 10, 2);
const ms = (s: number): number => MATCH_START + Math.round(s * 1000);
const UP = "421453";
const ROUND_S = 120;

const auraRow = (event: LogEvent, atS: number): any => ({
  spellId: UP,
  spellName: "Ultimate Penitence",
  srcUnitId: "e1",
  srcUnitName: "e1",
  destUnitId: "e1",
  destUnitName: "e1",
  timestamp: ms(atS),
  logLine: { event, timestamp: ms(atS), parameters: [] },
  auraType: "BUFF",
});
const priest = (): any => ({
  id: "e1",
  name: "e1",
  type: 1,
  spec: "256",
  reaction: 1,
  info: {},
  auraEvents: [
    auraRow(LogEvent.SPELL_AURA_APPLIED, 37),
    auraRow(LogEvent.SPELL_AURA_REMOVED, 43.5),
  ],
  actionIn: [],
  absorbsIn: [],
  damageOut: [],
  damageIn: [],
  healIn: [],
  deathRecords: [],
  advancedActions: [],
  spellCastEvents: [
    {
      spellId: UP,
      spellName: "Ultimate Penitence",
      srcUnitId: "e1",
      destUnitId: "e1",
      timestamp: ms(37),
      logLine: {
        event: LogEvent.SPELL_CAST_SUCCESS,
        timestamp: ms(37),
        parameters: [],
      },
    },
  ],
});

/** `cdLine`: the `[ENEMY CD]` line the timeline already holds, if any. */
function render(cdLine: string | null) {
  const lines: string[] = [];
  const held = cdLine == null ? [] : [cdLine];
  const enemies = [priest()];
  emitEnemyDefEntries({
    matchStartMs: ms(0),
    matchEndSeconds: ROUND_S,
    enemies,
    enemyPid: (n: string) => `4(${n})`,
    friends: [],
    roundBounds: undefined,
    pid: (n: string) => `1(${n})`,
    actorLabel: (n: string, side: "friendly" | "enemy") =>
      side === "friendly" ? `1(${n})` : `4(${n})`,
    addEntry: (_t: number, line: string) => lines.push(line),
    _allUnits: enemies,
    extendEnemyCdLine: (head: string, text: string) => {
      const i = held.findIndex((l) => l.startsWith(head));
      if (i < 0) return false;
      held[i] = head + text + held[i]!.slice(head.length);
      return true;
    },
  } as never);
  return { lines, held };
}

const WHO = "4(e1) (Discipline Priest)";
const CD_LINE = `${fmtTime(37)}  [ENEMY CD]   ${WHO}: Ultimate Penitence`;

describe("Ultimate Penitence prints one line a press (GH #173)", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("moves the shield onto the [ENEMY CD] line of its second", () => {
    const { lines, held } = render(CD_LINE);
    expect(lines.filter((l) => l.includes("[ENEMY DEF]"))).toEqual([]);
    expect(held).toHaveLength(1);
    expect(held[0]).toMatch(
      /^0:37 {2}\[ENEMY CD\] {3}4\(e1\) \(Discipline Priest\): Ultimate Penitence \(absorb, 6\.5s\)/,
    );
  });

  it("keeps the shield next to the name, ahead of a repeated press's ordinal", () => {
    const { held } = render(`${CD_LINE} (cast 2 of 2)`);
    expect(held[0]).toContain(": Ultimate Penitence (absorb, 6.5s)");
    expect(held[0]).toMatch(/\(cast 2 of 2\)$/);
    expect(isShieldOnEnemyCdLine(held[0]!)).toBe(true);
  });

  it("keeps the [ENEMY DEF] line when no [ENEMY CD] line stands in that second", () => {
    const { lines, held } = render(null);
    expect(held).toEqual([]);
    expect(lines.filter((l) => l.includes("[ENEMY DEF]"))).toHaveLength(1);
    expect(lines[0]).toContain("Ultimate Penitence (absorb, 6.5s)");
  });

  it("does not attach to a line of another second", () => {
    const other = `${fmtTime(38)}  [ENEMY CD]   ${WHO}: Ultimate Penitence`;
    const { lines, held } = render(other);
    expect(held).toEqual([other]);
    expect(lines.filter((l) => l.includes("[ENEMY DEF]"))).toHaveLength(1);
  });
});
