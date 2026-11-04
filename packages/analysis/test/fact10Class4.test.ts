/**
 * fact10 (F25) class 4 — effect span ends, D29: a periodic-trigger aura's
 * last trigger, logged just after its REMOVED, is the effect's own (1cbbdcb3
 * Burst #3: Boomstick 1261193 off at 2:01.766, its fourth volley 1261215 1 ms
 * later; Burst #1 12 ms). The corpus check is
 * `packages/eval/scripts/scan5/fact10.ts` channelLastTickDropped.
 */
import {
  CombatUnitClass,
  CombatUnitSpec,
  CombatUnitType,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { PERIODIC_TRIGGER_SPELLS } from "../src/data/periodicAuraGenerated";
import {
  observedEffectEndSeconds,
  PERIODIC_LAST_TRIGGER_SLACK_MS,
} from "../src/utils/enemyCDs";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const BOOMSTICK = "1261193";
const VOLLEY = "1261215";
const at = (s: number) => T0 + Math.round(s * 1000);
const aura = (event: LogEvent, s: number) => ({
  spellId: BOOMSTICK,
  spellName: "Boomstick",
  srcUnitId: "h",
  srcUnitName: "Hunter",
  destUnitId: "h",
  destUnitName: "Hunter",
  timestamp: at(s),
  logLine: { event, timestamp: at(s) },
});
const hit = (s: number, spellId = VOLLEY) => ({
  spellId,
  spellName: "Boomstick",
  srcUnitId: "h",
  destUnitId: "e",
  amount: -50_000,
  effectiveAmount: -50_000,
  timestamp: at(s),
  logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: at(s) },
});
const combatWith = (lastHitS: number, spellId = VOLLEY) => {
  const hunter = {
    id: "h",
    name: "Hunter",
    type: CombatUnitType.Player,
    class: CombatUnitClass.Hunter,
    spec: CombatUnitSpec.Hunter_Survival,
    spellCastEvents: [
      {
        spellId: BOOMSTICK,
        spellName: "Boomstick",
        srcUnitId: "h",
        logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: at(119.247) },
      },
    ],
    auraEvents: [
      aura(LogEvent.SPELL_AURA_APPLIED, 119.247),
      aura(LogEvent.SPELL_AURA_REMOVED, 121.766),
    ],
    damageOut: [hit(120.3), hit(lastHitS, spellId)],
    healOut: [],
    damageIn: [],
    healIn: [],
    absorbsIn: [],
    absorbsOut: [],
    actionIn: [],
    actionOut: [],
    deathRecords: [],
  };
  return {
    unit: hunter,
    combat: {
      startTime: T0,
      endTime: T0 + 300_000,
      units: { h: hunter },
    } as never,
  };
};
const endOf = (lastHitS: number, spellId?: string) => {
  const { unit, combat } = combatWith(lastHitS, spellId);
  return observedEffectEndSeconds(unit as never, BOOMSTICK, 119.247, Infinity, combat);
};

describe("fact10 D29 — a periodic trigger's last tick after the REMOVED", () => {
  it("DB2 links Boomstick to its volley (effect 23)", () => {
    expect(PERIODIC_TRIGGER_SPELLS.get(BOOMSTICK)).toContain(VOLLEY);
  });
  it("1cbbdcb3 2:01.766: the volley 1 ms after the REMOVED ends the effect", () => {
    expect(endOf(121.767)).toBeCloseTo(121.767, 6);
  });
  it("a row past the slack, or of another spell, does not", () => {
    expect(endOf(121.766 + (PERIODIC_LAST_TRIGGER_SLACK_MS + 1) / 1000)).toBeCloseTo(
      121.766,
      6,
    );
    expect(endOf(121.767, "1261216")).toBeCloseTo(121.766, 6);
  });
});
