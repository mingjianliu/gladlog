/* eslint-disable @typescript-eslint/no-explicit-any -- synthetic legacy unit fixtures */
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
import {
  PERIODIC_TRIGGER_SPELLS,
  SCRIPTED_PERIODIC_TRIGGER_AURA_IDS,
} from "../src/data/periodicAuraGenerated";
import { burstDamageEndMs } from "../src/utils/burstLedger";
import {
  isOwnTickChannelAura,
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
  return observedEffectEndSeconds(
    unit as never,
    BOOMSTICK,
    119.247,
    Infinity,
    combat,
  );
};

describe("fact10 D29 — a periodic trigger's last tick after the REMOVED", () => {
  it("DB2 links Boomstick to its volley (effect 23)", () => {
    expect(PERIODIC_TRIGGER_SPELLS.get(BOOMSTICK)).toContain(VOLLEY);
  });
  it("1cbbdcb3 2:01.766: the volley 1 ms after the REMOVED ends the effect", () => {
    expect(endOf(121.767)).toBeCloseTo(121.767, 6);
  });
  it("a row past the slack, or of another spell, does not", () => {
    expect(
      endOf(121.766 + (PERIODIC_LAST_TRIGGER_SLACK_MS + 1) / 1000),
    ).toBeCloseTo(121.766, 6);
    expect(endOf(121.767, "1261216")).toBeCloseTo(121.766, 6);
  });
});

describe("fact10 D29 residual — a scripted periodic trigger reads its ticks by name", () => {
  const VOID_RAY = "473728";
  const TICK = "1214595";
  const endOf = (tickName: string, tickS: number, tickId = TICK) => {
    const { unit, combat } = combatWith(120.3);
    const dh = unit as any;
    dh.spellCastEvents[0] = {
      ...dh.spellCastEvents[0],
      spellId: VOID_RAY,
      spellName: "Void Ray",
    };
    dh.auraEvents = dh.auraEvents.map((a: any) => ({
      ...a,
      spellId: VOID_RAY,
      spellName: "Void Ray",
    }));
    dh.damageOut = [
      { ...hit(120.3, TICK), spellName: "Void Ray" },
      { ...hit(tickS, tickId), spellName: tickName },
    ];
    return observedEffectEndSeconds(dh, VOID_RAY, 119.247, Infinity, combat);
  };
  it("DB2: Void Ray is effect 23 with no trigger id", () => {
    expect(PERIODIC_TRIGGER_SPELLS.has(VOID_RAY)).toBe(false);
    expect(SCRIPTED_PERIODIC_TRIGGER_AURA_IDS.has(VOID_RAY)).toBe(true);
  });
  it("cover set 32-4 r4: its tick 1 ms after the REMOVED ends the effect; another name does not", () => {
    expect(endOf("Void Ray", 121.767)).toBeCloseTo(121.767, 6);
    expect(endOf("Eye Beam", 121.767, "198030")).toBeCloseTo(121.766, 6);
  });
});

describe("pipeline T248 — a channel whose own aura ticks: the tick after the REMOVED", () => {
  const DISINTEGRATE = "356995";
  const endOf = (tickS: number, tickId = DISINTEGRATE) => {
    const { unit, combat } = combatWith(120.3);
    const evoker = unit as any;
    evoker.spellCastEvents[0] = {
      ...evoker.spellCastEvents[0],
      spellId: DISINTEGRATE,
      spellName: "Disintegrate",
    };
    evoker.auraEvents = evoker.auraEvents.map((a: any) => ({
      ...a,
      spellId: DISINTEGRATE,
      spellName: "Disintegrate",
    }));
    evoker.damageOut = [
      { ...hit(120.3, DISINTEGRATE), spellName: "Disintegrate" },
      { ...hit(tickS, tickId), spellName: "Disintegrate" },
    ];
    return observedEffectEndSeconds(
      evoker,
      DISINTEGRATE,
      119.247,
      Infinity,
      combat,
    );
  };
  it("DB2: Disintegrate is a channel with a periodic-damage aura of its own, and no trigger spell", () => {
    expect(isOwnTickChannelAura(DISINTEGRATE)).toBe(true);
    expect(PERIODIC_TRIGGER_SPELLS.has(DISINTEGRATE)).toBe(false);
    // a channel that triggers another spell is the trigger table's, not this
    expect(isOwnTickChannelAura(BOOMSTICK)).toBe(false);
  });
  it("605 s2 201-1: its tick 4 ms after the REMOVED ends the effect", () => {
    expect(endOf(121.77)).toBeCloseTo(121.77, 6);
  });
  it("a row past the slack, or of another id, does not", () => {
    expect(
      endOf(121.766 + (PERIODIC_LAST_TRIGGER_SLACK_MS + 1) / 1000),
    ).toBeCloseTo(121.766, 6);
    expect(endOf(121.77, "357209")).toBeCloseTo(121.766, 6);
  });
});

describe("pipeline T248 — the burst ledger's damage reads on to a trailing last tick", () => {
  const DISINTEGRATE = "356995";
  // the burst [119.0, 121.766]: the channel's aura comes off at its end
  const endMs = (
    tickS: number,
    capS = 300,
    removedS = 121.766,
    backUpS?: number,
    absorbedBy?: string,
  ) => {
    const { unit, combat } = combatWith(120.3);
    const evoker = unit as any;
    evoker.auraEvents = [
      { ...aura(LogEvent.SPELL_AURA_APPLIED, 119.247), spellId: DISINTEGRATE },
      { ...aura(LogEvent.SPELL_AURA_REMOVED, removedS), spellId: DISINTEGRATE },
      ...(backUpS === undefined
        ? []
        : [
            {
              ...aura(LogEvent.SPELL_AURA_APPLIED, backUpS),
              spellId: DISINTEGRATE,
            },
          ]),
    ];
    evoker.damageOut = [
      hit(120.3, DISINTEGRATE),
      absorbedBy ? absorbed(tickS, absorbedBy) : hit(tickS, DISINTEGRATE),
    ];
    return burstDamageEndMs(evoker, at(119), at(121.766), at(capS), combat);
  };
  // a SPELL_ABSORBED row: `spellId` the shield, `attackSpellId` the tick
  const absorbed = (s: number, shieldId: string) => ({
    ...hit(s, shieldId),
    spellName: "Anti-Magic Shell",
    attackSpellId: DISINTEGRATE,
    logLine: { event: LogEvent.SPELL_ABSORBED, timestamp: at(s) },
  });
  it("4da68e83 r4: a last tick a shield took whole (SPELL_ABSORBED) is the channel's too", () => {
    expect(endMs(121.767, 300, 121.766, undefined, "48707")).toBe(at(121.767));
  });
  it("605 s2 201-1: the tick 4 ms after the channel's REMOVED is inside", () => {
    expect(endMs(121.77)).toBe(at(121.77));
  });
  it("a tick past the slack, a channel that ended after the burst, and the round's end leave the burst's end", () => {
    expect(endMs(121.766 + (PERIODIC_LAST_TRIGGER_SLACK_MS + 1) / 1000)).toBe(
      at(121.766),
    );
    // the aura came off after the burst's end: not this burst's channel
    expect(endMs(121.9, 300, 121.85)).toBe(at(121.766));
    // never past the round's end
    expect(endMs(121.77, 121.768)).toBe(at(121.768));
  });
  it("a channel chained into its next one: the row after the aura is back up is the next channel's", () => {
    // 605 s2 27-1 1:39.574: REMOVED and APPLIED in one millisecond
    expect(endMs(121.77, 300, 121.766, 121.766)).toBe(at(121.766));
    expect(endMs(121.77, 300, 121.766, 121.77)).toBe(at(121.766));
    // back up only after the tick: the tick is the ending channel's
    expect(endMs(121.77, 300, 121.766, 121.9)).toBe(at(121.77));
  });
});
