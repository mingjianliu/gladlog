/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Pipeline T69 (GH #134): an aura on the victim changes how long an
 * interrupt locks it — Concentration Aura 317920 (DB2 aura 232 / misc 26,
 * −30 × PvpMultiplier 0.67) and Oppressing Roar 372048 / 406971 (+50 × 0.6)
 * — and the kick-eaten text and its pressure window end the lock at one
 * instant (`kickTextLockEndMs`).
 */
import { LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { kickLockoutSeconds } from "../src/data/spellEffectData";
import {
  KICK_LOCKOUT_VICTIM_AURAS,
  kickLockoutSecondsFor,
  kickLockoutVictimAuraMultiplierAt,
  kickTextLockEndMs,
} from "../src/utils/kickLockout";

const T0 = 1_790_000_000_000;
const PUMMEL = "6552"; // 3 s
const SPELL_LOCK = "19647"; // 5 s
const CONCENTRATION = "317920";
const ROAR = "372048";
const ROAR_B = "406971";

const row = (event: LogEvent, id: string, atMs: number) =>
  ({ spellId: id, logLine: { event, timestamp: T0 + atMs } }) as any;
const victim = (auraEvents: any[], startList?: unknown[]) =>
  ({
    id: "v",
    auraEvents,
    info: startList
      ? { interestingAurasJSON: JSON.stringify(startList) }
      : undefined,
  }) as any;

describe("KICK_LOCKOUT_VICTIM_AURAS", () => {
  it("the numbers are the DB2 rows' PvP values: 1 + base × PvpMultiplier / 100", () => {
    expect(KICK_LOCKOUT_VICTIM_AURAS[CONCENTRATION]!.multiplier).toBeCloseTo(
      1 + (-30 * 0.67) / 100,
      3,
    );
    for (const id of [ROAR, ROAR_B])
      expect(KICK_LOCKOUT_VICTIM_AURAS[id]!.multiplier).toBeCloseTo(
        1 + (50 * 0.6) / 100,
        3,
      );
  });

  it("Concentration Aura up at the interrupt: Pummel 3 → 2.397 s, Spell Lock 5 → 3.995 s — with or without an interrupted spell", () => {
    const v = victim([row(LogEvent.SPELL_AURA_APPLIED, CONCENTRATION, 0)]);
    expect(kickLockoutSeconds(PUMMEL)).toBe(3);
    expect(kickLockoutSecondsFor(PUMMEL, v, "116", T0 + 5000)).toBe(2.397);
    expect(kickLockoutSecondsFor(PUMMEL, v, undefined, T0 + 5000)).toBe(2.397);
    expect(kickLockoutSecondsFor(SPELL_LOCK, v, "116", T0 + 5000)).toBe(3.995);
  });

  it("listed as up at the log's start counts; out of the aura's range (REMOVED before the interrupt) does not; back in does", () => {
    const v = victim(
      [
        row(LogEvent.SPELL_AURA_REMOVED, CONCENTRATION, 4000),
        row(LogEvent.SPELL_AURA_APPLIED, CONCENTRATION, 9000),
      ],
      ["Player-1-0000000A", 317920, 1],
    );
    expect(kickLockoutSecondsFor(PUMMEL, v, "116", T0 + 3000)).toBe(2.397);
    expect(kickLockoutSecondsFor(PUMMEL, v, "116", T0 + 5000)).toBe(3);
    expect(kickLockoutSecondsFor(PUMMEL, v, "116", T0 + 9500)).toBe(2.397);
    // a REMOVED in the interrupt's own millisecond: the aura was up for it
    expect(kickLockoutSecondsFor(PUMMEL, v, "116", T0 + 4000)).toBe(2.397);
  });

  it("no aura, no victim: the kick's own lockout", () => {
    expect(kickLockoutSecondsFor(PUMMEL, victim([]), "116", T0)).toBe(3);
    expect(kickLockoutSecondsFor(PUMMEL, undefined, "116", T0)).toBe(3);
  });

  it("Oppressing Roar on the victim: 3 → 3.9 s; its two ids are one debuff; with Concentration Aura the two multiply", () => {
    const roared = victim([
      row(LogEvent.SPELL_AURA_APPLIED, ROAR, 0),
      row(LogEvent.SPELL_AURA_APPLIED, ROAR_B, 0),
    ]);
    expect(kickLockoutVictimAuraMultiplierAt(roared, T0 + 100)).toBe(1.3);
    expect(kickLockoutSecondsFor(PUMMEL, roared, "116", T0 + 100)).toBe(3.9);
    const both = victim([
      row(LogEvent.SPELL_AURA_APPLIED, CONCENTRATION, 0),
      row(LogEvent.SPELL_AURA_APPLIED, ROAR, 0),
    ]);
    expect(kickLockoutSecondsFor(PUMMEL, both, "116", T0 + 100)).toBe(3.116);
  });

  it("a Roar whose REMOVED the log never shows is over at its 10 s; Concentration Aura has no length and stays", () => {
    const lost = victim([
      row(LogEvent.SPELL_AURA_APPLIED, ROAR, 0),
      row(LogEvent.SPELL_AURA_APPLIED, CONCENTRATION, 0),
    ]);
    expect(kickLockoutVictimAuraMultiplierAt(lost, T0 + 10_000)).toBe(
      1.3 * 0.799,
    );
    expect(kickLockoutSecondsFor(PUMMEL, lost, "116", T0 + 60_000)).toBe(2.397);
  });

  it("rows out of time order: the latest row at or before the interrupt decides", () => {
    const stepped = victim([
      row(LogEvent.SPELL_AURA_REMOVED, CONCENTRATION, 1001),
      row(LogEvent.SPELL_AURA_APPLIED, CONCENTRATION, 999),
    ]);
    expect(kickLockoutSecondsFor(PUMMEL, stepped, "116", T0 + 1000)).toBe(
      2.397,
    );
    const back = victim([
      row(LogEvent.SPELL_AURA_REMOVED, CONCENTRATION, 500),
      row(LogEvent.SPELL_AURA_APPLIED, CONCENTRATION, 100),
    ]);
    expect(kickLockoutSecondsFor(PUMMEL, back, "116", T0 + 1000)).toBe(3);
  });
});

describe("kickTextLockEndMs — one lock end for the text and the pressure window", () => {
  it("the modelled end, or the first covered success when earlier, in whole ms", () => {
    expect(
      kickTextLockEndMs({ atSeconds: 10.2, lockoutDurationSeconds: 3 }),
    ).toBe(13_200);
    expect(
      kickTextLockEndMs({
        atSeconds: 10.2,
        lockoutDurationSeconds: 3,
        lockEndedBySuccessS: 1.25,
      }),
    ).toBe(11_450);
    expect(
      kickTextLockEndMs({
        atSeconds: 10.2,
        lockoutDurationSeconds: 3,
        lockEndedBySuccessS: null,
      }),
    ).toBe(13_200);
  });
  it("the inexact subtraction lands on the cast's own millisecond", () => {
    // kick 0.177 s, cast 0.838 s: 0.177 + (0.838 − 0.177) is one ulp above
    expect(
      kickTextLockEndMs({
        atSeconds: 0.177,
        lockoutDurationSeconds: 3,
        lockEndedBySuccessS: 0.838 - 0.177,
      }),
    ).toBe(838);
  });
});
