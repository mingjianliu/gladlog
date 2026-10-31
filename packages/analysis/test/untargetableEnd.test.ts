import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { untargetableEndS } from "../src/utils/enemyDefensives";

beforeAll(async () => {
  await ensureAnalysisData();
});

// weekly review 2026-10-24: the unseen-end reading ended a Mass Invisibility
// at the holder's pet hit or DoT tick (parser-compat folds pet damage into
// the owner's damageOut) — `holderFirstOwnActionAfterMs` reads the holder's
// own press or direct hit only, for the kill windows and the burst ledger
const START = 1_000_000;
const hit = (src: string, atS: number, event = LogEvent.SPELL_DAMAGE) =>
  ({
    srcUnitId: src,
    logLine: { event, timestamp: START + atS * 1000 },
  }) as never;
const mage = (damageOut: never[], casts: never[] = []) => ({
  id: "e1",
  spellCastEvents: casts,
  damageOut,
});
const iv = { fromS: 5, toS: 17, inferredEnd: true };

describe("untargetableEndS — the holder's own action ends an unseen end", () => {
  it("a pet's hit does not end it", () => {
    expect(untargetableEndS(mage([hit("pet-1", 6)]), iv, START)).toBe(17);
  });
  it("a periodic tick does not end it", () => {
    expect(
      untargetableEndS(
        mage([hit("e1", 6, LogEvent.SPELL_PERIODIC_DAMAGE)]),
        iv,
        START,
      ),
    ).toBe(17);
  });
  it("a tick a shield ate does not end it; a swing a shield ate does", () => {
    // codex 30-RV-01 #1 (0373256a r1): the SPELL_ABSORBED row of a Flame
    // Shock tick — `spellId` the shield, `attackSpellId` the hit
    const absorbed = (atS: number, attackSpellId?: string) =>
      ({
        srcUnitId: "e1",
        spellId: "367364",
        ...(attackSpellId ? { attackSpellId } : {}),
        logLine: {
          event: LogEvent.SPELL_ABSORBED,
          timestamp: START + atS * 1000,
        },
      }) as never;
    const tick = {
      srcUnitId: "e1",
      spellId: "188389",
      logLine: {
        event: LogEvent.SPELL_PERIODIC_DAMAGE,
        timestamp: START + 5_500,
      },
    } as never;
    expect(
      untargetableEndS(mage([tick, absorbed(6.3, "188389")]), iv, START),
    ).toBe(17);
    expect(
      untargetableEndS(mage([tick, absorbed(6.3)]), iv, START),
    ).toBeCloseTo(6.3);
  });
  it("the holder's own direct hit ends it", () => {
    expect(untargetableEndS(mage([hit("e1", 7.5)]), iv, START)).toBe(7.5);
  });
  it("the holder's own successful press ends it", () => {
    const cast = {
      logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: START + 6_200 },
    } as never;
    expect(untargetableEndS(mage([], [cast]), iv, START)).toBeCloseTo(6.2);
  });
  it("a logged end stands", () => {
    expect(
      untargetableEndS(
        mage([hit("e1", 7)]),
        { ...iv, inferredEnd: false },
        START,
      ),
    ).toBe(17);
  });
});

describe("fact7 D59 — an opener whose cast row the log lost", () => {
  const debuff = (spellId: string, atS: number, src = "e1") =>
    ({
      spellId,
      srcUnitId: src,
      auraType: "DEBUFF",
      logLine: {
        event: LogEvent.SPELL_AURA_APPLIED,
        timestamp: START + atS * 1000,
      },
    }) as never;
  const CHEAP_SHOT = "1833";
  const IGNITE = "12654";
  const victim = (auraEvents: never[]) => ({ id: "t1", auraEvents }) as never;
  const vanish = { fromS: 5, toS: 6.5, inferredEnd: true };

  it("4f8a5947 0:26: Cheap Shot's aura on the target ends the Vanish (a mechanic of its own)", () => {
    expect(
      untargetableEndS(mage([]), vanish, START, [
        victim([debuff(CHEAP_SHOT, 5.47)]),
      ]),
    ).toBeCloseTo(5.47, 3);
  });
  it("a passive's rider has no mechanic and ends nothing; nor does another unit's control", () => {
    expect(
      untargetableEndS(mage([]), vanish, START, [
        victim([debuff(IGNITE, 5.47), debuff(CHEAP_SHOT, 5.47, "e2")]),
      ]),
    ).toBe(6.5);
  });
  it("without the round's units the reading is what it was", () => {
    expect(untargetableEndS(mage([]), vanish, START)).toBe(6.5);
  });
});
