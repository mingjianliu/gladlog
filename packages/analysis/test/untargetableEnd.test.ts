import { LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { untargetableEndS } from "../src/utils/enemyDefensives";

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
