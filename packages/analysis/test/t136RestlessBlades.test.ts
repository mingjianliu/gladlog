/**
 * T136 — three talents that change what a finisher gives back through
 * Restless Blades: Supercharger (+ Forced Induction), Coup de Grace and
 * Dragon-Bone Dice.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  EVENT_COOLDOWN_REDUCTIONS,
  eventReducedCooldownSeconds,
  powerSpendTriggers,
} from "../src/data/talentScriptedCooldowns";

const T0 = 1_000_000;
const rb = EVENT_COOLDOWN_REDUCTIONS["79096"]!.triggerPowerSpend!;
const cast = (spellId: string, atS: number, comboPoints?: number) => ({
  spellId,
  logLine: {
    event: LogEvent.SPELL_CAST_SUCCESS,
    timestamp: T0 + Math.round(atS * 1000),
  },
  powerCosts: comboPoints === undefined ? [] : [{ type: 4, cost: comboPoints }],
});
const aura = (spellId: string, event: LogEvent, atS: number) => ({
  spellId,
  srcUnitId: "r",
  destUnitId: "r",
  logLine: { event, timestamp: T0 + Math.round(atS * 1000) },
});
const AR = "13750";
const DISPATCH = "2098";
const BTE = "315341";
const KIDNEY = "408";
const COUP = "441776";
const holds =
  (...ids: string[]) =>
  (t: string) =>
    ids.includes(t);
const seconds = (u: unknown, h: (t: string) => boolean) =>
  powerSpendTriggers(u as never, rb, "260", h).map(
    (g) => Math.round(g.seconds * 100) / 100,
  );

describe("Supercharger — the first damaging finisher after Adrenaline Rush counts 2 points more", () => {
  const u = {
    id: "r",
    spellCastEvents: [
      cast(DISPATCH, 5, 7),
      cast(AR, 10),
      cast(KIDNEY, 11, 5),
      cast(DISPATCH, 12, 7),
      cast(BTE, 13, 7),
    ],
    auraEvents: [],
  };
  it("a holder: the Dispatch after the press, not the Kidney Shot before it nor the next finisher", () => {
    expect(seconds(u, holds("470347"))).toEqual([7, 5, 9, 7]);
  });
  it("with Forced Induction: 3 more", () => {
    expect(seconds(u, holds("470347", "470668"))).toEqual([7, 5, 10, 7]);
  });
  it("Forced Induction alone, or no talent known: the stated points", () => {
    expect(seconds(u, holds("470668"))).toEqual([7, 5, 7, 7]);
    expect(seconds(u, () => false)).toEqual([7, 5, 7, 7]);
  });
});

describe("Supercharger — the point in hand (codex 85-tk-CD-T136-1 #2 #3)", () => {
  it("a finisher whose cost the log does not state still takes the point", () => {
    const u = {
      id: "r",
      spellCastEvents: [
        cast(AR, 10),
        cast(DISPATCH, 11), // no cost stated
        cast(DISPATCH, 13, 7),
      ],
      auraEvents: [],
    };
    expect(seconds(u, holds("470347", "470668"))).toEqual([7]);
  });
  it("a second Adrenaline Rush with the point unused adds another", () => {
    const u = {
      id: "r",
      spellCastEvents: [
        cast(AR, 10),
        cast(AR, 12),
        cast(DISPATCH, 13, 7),
        cast(DISPATCH, 14, 7),
        cast(DISPATCH, 15, 7),
      ],
      auraEvents: [],
    };
    expect(seconds(u, holds("470347", "470668"))).toEqual([10, 10, 7]);
  });
  it("6bf9a4d0 r4: one point a press whatever the rank — the second finisher gets the stated points (codex 85-tk-L1-T273-1b #1: its credit put Sprint back 4 s before the server's refusals)", () => {
    const u = {
      id: "r",
      spellCastEvents: [cast(AR, 10), cast(BTE, 11, 7), cast(BTE, 12, 6)],
      auraEvents: [],
    };
    expect(seconds(u, holds("470347", "470668"))).toEqual([10, 6]);
  });
});

describe("Coup de Grace — counts 5 points more than its row states", () => {
  it("441776 stating 7 gives back 12", () => {
    const u = {
      id: "r",
      spellCastEvents: [cast(DISPATCH, 5, 7), cast(COUP, 9, 7)],
      auraEvents: [],
    };
    expect(seconds(u, () => false)).toEqual([7, 12]);
  });
});

describe("Dragon-Bone Dice — the Roll the Bones bonus is 10 points greater", () => {
  const u = {
    id: "r",
    spellCastEvents: [cast(DISPATCH, 5, 7), cast(DISPATCH, 20, 7)],
    auraEvents: [
      aura("1214935", LogEvent.SPELL_AURA_APPLIED, 1),
      aura("1214935", LogEvent.SPELL_AURA_REMOVED, 10),
    ],
  };
  it("30 % without it, 40 % with it, only while the outcome is up", () => {
    expect(seconds(u, () => false)).toEqual([9.1, 7]);
    expect(seconds(u, holds("1259481"))).toEqual([9.8, 7]);
  });
});

describe("the audited pair (round 14 D24)", () => {
  it("Sprint pressed 98.39 s is back at 112.2 s — it was pressed again at 115.35 s", () => {
    // Adrenaline Rush 99.94 s, then Dispatch 7, Kidney Shot 5, Between the
    // Eyes 7 / 6 / 5, all under Triple Threat; the holder has all three
    const u = {
      id: "r",
      spellCastEvents: [
        cast(AR, 99.94),
        cast(DISPATCH, 100.72, 7),
        cast(KIDNEY, 102.42, 5),
        cast(BTE, 104.23, 7),
        cast(BTE, 105.02, 6),
        cast(BTE, 105.82, 5),
      ],
      auraEvents: [aura("1214935", LogEvent.SPELL_AURA_APPLIED, 90)],
    };
    const h = holds("470347", "470668", "1259481");
    const triggers = powerSpendTriggers(u as never, rb, "260", h).map((g) => ({
      atSeconds: (g.atMs - T0) / 1000,
      seconds: g.seconds,
    }));
    expect(eventReducedCooldownSeconds(98.39, 60, triggers)).toBeCloseTo(
      60 - 33 * 1.4,
      6,
    );
    // without the three talents: 60 − 30 × 1.3 = 21 s, back at 119.39 s
    const bare = powerSpendTriggers(u as never, rb, "260", () => false).map(
      (g) => ({ atSeconds: (g.atMs - T0) / 1000, seconds: g.seconds }),
    );
    expect(eventReducedCooldownSeconds(98.39, 60, bare)).toBeCloseTo(21, 6);
  });
});
