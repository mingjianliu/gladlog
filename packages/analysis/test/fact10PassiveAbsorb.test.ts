/* eslint-disable @typescript-eslint/no-explicit-any -- synthetic legacy unit fixtures */
/**
 * fact10 D25 (user ruling 2026-11-04): Angelic Bulwark 114214 — a Priest's
 * passive shield that goes up by itself at low HP — gets an `[ENEMY DEF]`
 * fact line like Shield of Vengeance's `(absorb Nk, Ts) [no press logged]`.
 * It is a fact only: no KILL ATTEMPTS cause, no defenseless-span cut, no
 * aura-only activation (there is no press to hide).
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { emitEnemyDefEntries } from "../src/context/timelineSections/enemyDef";
import { ensureAnalysisData } from "../src/data/ensure";
import { auraOnlyActivations } from "../src/utils/auraOnlyActivations";
import {
  ENEMY_DEF_NO_PRESS_TAG,
  enemyDefensiveEvents,
  ownSaveSpanS,
  PASSIVE_ABSORB_PROC_AURAS,
} from "../src/utils/enemyDefensives";

beforeAll(async () => {
  await ensureAnalysisData();
});

const MATCH_START = Date.UTC(2026, 10, 4);
const ms = (s: number): number => MATCH_START + s * 1000;
const BULWARK = "114214";
const combat = { startTime: ms(0), endTime: ms(120) };

function unit(id: string, over: Record<string, unknown> = {}): any {
  return {
    id,
    name: id,
    type: 1,
    spec: "258",
    reaction: 1,
    info: {},
    spellCastEvents: [],
    auraEvents: [],
    damageOut: [],
    damageIn: [],
    healIn: [],
    absorbsIn: [],
    deathRecords: [],
    advancedActions: [],
    ...over,
  };
}
const aura = (src: string, atS: number, event: LogEvent): any => ({
  spellId: BULWARK,
  spellName: "Angelic Bulwark",
  srcUnitId: src,
  srcUnitName: src,
  destUnitId: "e1",
  destUnitName: "e1",
  timestamp: ms(atS),
  logLine: { event, timestamp: ms(atS), parameters: [] },
  auraType: "BUFF",
});
const absorbed = (atS: number, amount: number): any => ({
  spellId: BULWARK,
  spellName: "Angelic Bulwark",
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
const priest = (src = "e1") =>
  unit("e1", {
    auraEvents: [
      aura(src, 40.2, LogEvent.SPELL_AURA_APPLIED),
      aura(src, 42.9, LogEvent.SPELL_AURA_REMOVED),
    ],
    absorbsIn: [absorbed(40.5, 30_000), absorbed(42.8, 26_000)],
  });

function render(enemies: any[]): string[] {
  const lines: string[] = [];
  emitEnemyDefEntries({
    matchStartMs: combat.startTime,
    matchEndSeconds: 120,
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

describe("fact10 D25: Angelic Bulwark is a passive [ENEMY DEF] fact line", () => {
  it("is registered, and reads as a passive absorb with what it absorbed", () => {
    expect(PASSIVE_ABSORB_PROC_AURAS.get(BULWARK)).toBe("Angelic Bulwark");
    const p = priest();
    const ev = enemyDefensiveEvents(p, [p], combat).filter(
      (e) => e.spellId === BULWARK,
    );
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      kind: "passive",
      effect: "absorb",
      noPressLogged: true,
      absorbedAmount: 56_000,
      atSeconds: 40.2,
    });
    const line = render([p]).find((l) => l.includes("Angelic Bulwark"));
    expect(line).toBeDefined();
    expect(line).toContain("Angelic Bulwark (absorb 56k");
    expect(line).toContain(ENEMY_DEF_NO_PRESS_TAG);
  });

  it("another unit's Bulwark on it is not its own (source must be the holder)", () => {
    const p = priest("e2");
    expect(
      enemyDefensiveEvents(p, [p], combat).filter((e) => e.spellId === BULWARK),
    ).toEqual([]);
  });

  it("cuts no span and is no aura-only activation", () => {
    const p = priest();
    const ev = enemyDefensiveEvents(p, [p], combat).find(
      (e) => e.spellId === BULWARK,
    )!;
    expect(ownSaveSpanS(ev, false)).toBeUndefined();
    expect(
      auraOnlyActivations(p, [p], combat.startTime, combat.endTime).filter(
        (a) => a.spellId === BULWARK,
      ),
    ).toEqual([]);
  });
});
