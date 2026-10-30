import type { IPressureEvent } from "@gladlog/analysis/src/utils/incomingPressure";
import { incomingPressureEvents } from "@gladlog/analysis/src/utils/incomingPressure";
import { CombatUnitReaction, type ICombatUnit } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  addDeferredTally,
  newDeferredTally,
  reconcile,
  RECONCILE_FLAG_BELOW,
  scanLegacy,
  TABLE,
} from "../scripts/deferredDamageScan";

// The FT-T02b deferral scan: RECONCILE's arithmetic and DOUBLE, on a hand-built
// unit — the product predicate (clean) and an injected one that still returns
// the deferral absorb (DOUBLE fires).

const T0 = 1_000_000;
const TIME_DILATION = "357170";
const ITS_TICK = TABLE[TIME_DILATION]!;
const absorb = (
  spellId: string,
  absorbedAmount: number,
  attackSpellId: string,
  atMs: number,
) => ({
  logLine: { event: "SPELL_ABSORBED", timestamp: T0 + atMs, parameters: [] },
  timestamp: T0 + atMs,
  spellId,
  spellName: spellId,
  absorbedAmount,
  attackSpellId,
  attackerId: "e1",
  srcUnitId: "p1",
  srcUnitFlags: 0x511,
  destUnitId: "p1",
  destUnitFlags: 0x511,
});
const damage = (spellId: string, effectiveAmount: number, atMs: number) => ({
  logLine: { event: "SPELL_DAMAGE", timestamp: T0 + atMs, parameters: [] },
  timestamp: T0 + atMs,
  spellId,
  spellName: spellId,
  effectiveAmount,
  amount: effectiveAmount,
  srcUnitId: "e1",
  srcUnitFlags: 0x548,
  destUnitId: "p1",
  destUnitFlags: 0x511,
});
const unit = {
  id: "p1",
  name: "P",
  reaction: CombatUnitReaction.Friendly,
  info: {},
  absorbsIn: [
    // the shield delayed 5,000 of a Fireball
    absorb(TIME_DILATION, 5_000, "133", 1_000),
    // 1,000 of its tick was eaten by a real shield (Power Word: Shield)
    absorb("17", 1_000, ITS_TICK, 3_000),
  ],
  damageIn: [
    // 3,000 of the tick landed; an ordinary hit beside it
    damage(ITS_TICK, -3_000, 3_000),
    damage("133", -2_000, 1_000),
  ],
} as unknown as ICombatUnit;
const noInfo = { ...unit, id: "p2", info: undefined } as unknown as ICombatUnit;
const legacy = { units: { p1: unit, p2: noInfo } };

describe("scanLegacy — RECONCILE and DOUBLE", () => {
  it("premise: the product predicate does not return the deferral absorb", () => {
    expect(
      incomingPressureEvents(unit).some(
        (e) => e.isAbsorb && e.spellId === TIME_DILATION,
      ),
    ).toBe(false);
  });

  it("delayed vs came back, per shield; a unit without COMBATANT_INFO is not read; DOUBLE 0 with the product predicate", () => {
    const t = scanLegacy(legacy);
    expect([t.rounds, t.roundsWithDeferral, t.double, t.doubleEvents]).toEqual(
      [1, 1, 0, 0],
    );
    const s = t.byShield.get(TIME_DILATION)!;
    expect(s).toEqual({
      delayed: 5_000,
      ticksLanded: 3_000,
      ticksAbsorbed: 1_000,
      rounds: 1,
    });
    // 4,000 of 5,000 came back: 0.8, under the flag line
    expect(reconcile(s)).toEqual({ ratio: 0.8, flag: true });
    expect(RECONCILE_FLAG_BELOW).toBe(0.9);
  });

  it("DOUBLE: a pressure predicate that still returns the deferral absorb", () => {
    const stale = (u: { absorbsIn?: unknown[] }): IPressureEvent[] =>
      (u.absorbsIn ?? []).map((a) => {
        const x = a as ReturnType<typeof absorb>;
        return {
          timestamp: x.timestamp,
          amount: x.absorbedAmount,
          isAbsorb: true,
          spellId: x.spellId,
          spellName: x.spellName,
          srcUnitId: x.attackerId,
        };
      });
    const t = scanLegacy(legacy, stale);
    expect([t.double, t.doubleEvents]).toEqual([5_000, 1]);
  });

  it("reconcile with nothing delayed is 1 and not flagged; tallies add per shield", () => {
    expect(
      reconcile({ delayed: 0, ticksLanded: 0, ticksAbsorbed: 0, rounds: 0 }),
    ).toEqual({ ratio: 1, flag: false });
    const total = newDeferredTally();
    addDeferredTally(total, scanLegacy(legacy));
    addDeferredTally(total, scanLegacy(legacy));
    expect(total.rounds).toBe(2);
    expect(total.byShield.get(TIME_DILATION)).toEqual({
      delayed: 10_000,
      ticksLanded: 6_000,
      ticksAbsorbed: 2_000,
      rounds: 2,
    });
  });
});
