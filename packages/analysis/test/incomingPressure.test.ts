import { CombatUnitReaction, CombatUnitSpec } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { computePressureWindows } from "../src/utils/cooldowns";
import {
  documentRecordsAttackSpell,
  incomingPressureBySchool,
  incomingPressureEvents,
  logSchoolMask,
  sumAbsorbedPressure,
  sumIncomingPressure,
} from "../src/utils/incomingPressure";
import { makeUnit } from "./ported/testHelpers";

const dmg = (t: number, amount: number) =>
  ({
    logLine: { event: "SPELL_DAMAGE", timestamp: t, parameters: [] },
    timestamp: t,
    amount: -amount,
    effectiveAmount: -amount,
    spellId: "50622",
    spellName: "Bladestorm",
    srcUnitId: "enemy-1",
  }) as never;

const abs = (t: number, amount: number) =>
  ({
    logLine: { event: "SPELL_ABSORBED", timestamp: t, parameters: [] },
    timestamp: t,
    absorbedAmount: amount,
    spellId: "17",
    spellName: "Power Word: Shield",
    srcUnitId: "healer-1",
    attackerId: "enemy-1",
  }) as never;

describe("incomingPressure — the single predicate for incoming pressure", () => {
  it("merges damage taken and damage absorbed into one time-ordered list", () => {
    const unit = makeUnit("victim", {
      damageIn: [dmg(3000, 500), dmg(1000, 100)],
      absorbsIn: [abs(2000, 300)],
    });
    const events = incomingPressureEvents(unit);
    expect(events.map((e) => e.timestamp)).toEqual([1000, 2000, 3000]);
    expect(events.map((e) => e.amount)).toEqual([100, 300, 500]);
    expect(events.map((e) => e.isAbsorb)).toEqual([false, true, false]);
  });

  it("reports positive magnitudes, unlike damageIn's negative effectiveAmount", () => {
    const unit = makeUnit("victim", { damageIn: [dmg(1000, 100)] });
    expect(unit.damageIn[0]!.effectiveAmount).toBe(-100);
    expect(incomingPressureEvents(unit)[0]!.amount).toBe(100);
  });

  it("attributes an absorb to the attacker, not to the shield's owner", () => {
    const unit = makeUnit("victim", { absorbsIn: [abs(1000, 300)] });
    expect(incomingPressureEvents(unit)[0]!.srcUnitId).toBe("enemy-1");
  });

  it("sums respect the window bounds, inclusive", () => {
    const unit = makeUnit("victim", {
      damageIn: [dmg(1000, 100), dmg(5000, 700)],
      absorbsIn: [abs(2000, 300)],
    });
    expect(sumIncomingPressure(unit, 1000, 2000)).toBe(400);
    expect(sumAbsorbedPressure(unit, 1000, 2000)).toBe(300);
    expect(sumIncomingPressure(unit, 0, 10_000)).toBe(1100);
  });

  it("drops NaN and non-positive absorbs rather than poisoning the sum", () => {
    const unit = makeUnit("victim", {
      damageIn: [dmg(1000, NaN), dmg(2000, 100)],
      absorbsIn: [abs(3000, 0)],
    });
    expect(incomingPressureEvents(unit)).toHaveLength(1);
    expect(sumIncomingPressure(unit, 0, 10_000)).toBe(100);
  });

  it("computePressureWindows counts absorbs — a fully shielded burst is pressure", () => {
    // Nothing but absorbs: damageIn is empty, so the old damageIn-only
    // predicate produced no window at all.
    const shielded = makeUnit("victim", {
      name: "Victim",
      spec: CombatUnitSpec.Priest_Discipline,
      reaction: CombatUnitReaction.Friendly,
      absorbsIn: [abs(1000, 400_000), abs(2000, 400_000)],
    });
    const windows = computePressureWindows([shielded], {
      startTime: 0,
    } as never);
    expect(windows.length).toBeGreaterThan(0);
    expect(windows[0]!.totalDamage).toBe(800_000);
    expect(windows[0]!.targetName).toBe("Victim");
  });
  describe("incomingPressureBySchool — what was aimed at a unit, per school", () => {
    const hit = (t: number, amount: number, school: string) =>
      ({ ...(dmg(t, amount) as object), spellSchoolId: school }) as never;
    /** a spell-form SPELL_ABSORBED: the attack's school is parameters[10] */
    const eaten = (
      t: number,
      amount: number,
      attackSpellId: string | undefined,
      loggedSchool?: string,
    ) =>
      ({
        ...(abs(t, amount) as object),
        ...(attackSpellId !== undefined ? { attackSpellId } : {}),
        logLine: {
          event: "SPELL_ABSORBED",
          timestamp: t,
          parameters:
            loggedSchool !== undefined
              ? [0, 0, 0, 0, 0, 0, 0, 0, 0, "x", loggedSchool]
              : [],
        },
      }) as never;

    it("reads the log's school bits of a hit", () => {
      expect(logSchoolMask("0x20")).toBe(32);
      expect(logSchoolMask("0x1")).toBe(1);
      expect(logSchoolMask(undefined)).toBe(0);
    });

    it("sums landed and absorbed damage per school inside the window", () => {
      const unit = makeUnit("victim", {
        damageIn: [
          hit(1000, 100, "0x1"),
          hit(2000, 40, "0x20"),
          hit(9000, 999, "0x20"), // outside the window
        ],
        absorbsIn: [
          eaten(1500, 60, "686", "0x20"), // the line's own school
          eaten(1600, 10, "686"), // slimmed line → Shadow Bolt's DB2 school, 32
          eaten(1700, 5, undefined), // a swing absorb is physical
          eaten(1800, 7, "999999999"), // a spell nobody can place: left out
          eaten(9500, 999, "686", "0x20"), // outside the window
        ],
      });
      expect(incomingPressureBySchool(unit, 0, 5000)).toEqual({
        "1": 105,
        "32": 110,
      });
    });

    it("a unit whose only absorbs are swings, in a document that records attack spells: they are physical", () => {
      const unit = makeUnit("victim", {
        damageIn: [hit(1000, 60, "0x20"), hit(1100, 40, "0x1")],
        absorbsIn: [eaten(1500, 40, undefined)],
      });
      // decided from this unit alone, the swing is unknown and left out …
      expect(incomingPressureBySchool(unit, 0, 5000)).toEqual({
        "1": 40,
        "32": 60,
      });
      // … with the round's evidence it is the physical hit it was
      const other = makeUnit("other", {
        absorbsIn: [eaten(1, 1, "686", "0x20")],
      });
      expect(documentRecordsAttackSpell([unit, other])).toBe(true);
      expect(incomingPressureBySchool(unit, 0, 5000, undefined, true)).toEqual({
        "1": 80,
        "32": 60,
      });
    });

    it("a document that records no attack spell at all cannot call a bare absorb a swing", () => {
      const unit = makeUnit("victim", {
        damageIn: [hit(1000, 100, "0x1")],
        absorbsIn: [eaten(1500, 60, undefined)],
      });
      expect(incomingPressureBySchool(unit, 0, 5000)).toEqual({ "1": 100 });
    });
  });
});
