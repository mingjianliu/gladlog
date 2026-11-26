/**
 * Pipeline T126 (fact13 D34): Adaptation is a passive PvP trinket — nothing
 * to press — so a KILL ATTEMPTS line on its holder prints `no pressable PvP
 * trinket`, not `trinket up`.
 */
import type { ICombatUnit } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import trinketItemIds from "../src/data/trinketItemIds.json";
import { MEDALLION_SPELL_ID } from "../src/utils/pvpTrinketUses";
import {
  detectTrinketType,
  hasPressablePvpTrinket,
  medallionPressedInRound,
} from "../src/utils/trinketType";

const unitWith = (
  trinkets: string[] | null,
  casts: Array<[string, number]> = [],
): ICombatUnit => {
  const equipment = trinkets
    ? Array.from({ length: 14 }, (_, i) => ({
        id: i === 12 ? trinkets[0]! : i === 13 ? trinkets[1]! : "1",
      }))
    : undefined;
  return {
    info: equipment ? { equipment } : undefined,
    spellCastEvents: casts.map(([spellId, atMs]) => ({
      spellId,
      logLine: { timestamp: atMs },
    })),
  } as unknown as ICombatUnit;
};

/** a round of 0–120 s (arena: the round ends at endTime) */
const ROUND = { startTime: 0, endTime: 120_000 };

const BADGE = trinketItemIds.badgeItemIds[0]!;
const ADAPTATION = trinketItemIds.adaptationItemIds[0]!;
const RELENTLESS = trinketItemIds.relentlessItemIds[0]!;
const MEDALLION = trinketItemIds.gladiatorItemIds[0]!;

describe("hasPressablePvpTrinket", () => {
  it("Adaptation (badge + Adaptation, the audited slots) has nothing to press", () => {
    const u = unitWith(["270602", "270604"]);
    expect(detectTrinketType(u)).toBe("Adaptation");
    expect(hasPressablePvpTrinket(u, ROUND)).toBe(false);
    expect(hasPressablePvpTrinket(unitWith([BADGE, ADAPTATION]), ROUND)).toBe(
      false,
    );
  });
  it("Relentless and two other trinkets have nothing to press (fact7 r5)", () => {
    expect(hasPressablePvpTrinket(unitWith([BADGE, RELENTLESS]), ROUND)).toBe(
      false,
    );
    expect(hasPressablePvpTrinket(unitWith([BADGE, "1"]), ROUND)).toBe(false);
  });
  it("a Medallion, or unknown equipment, can be pressed", () => {
    expect(hasPressablePvpTrinket(unitWith([BADGE, MEDALLION]), ROUND)).toBe(
      true,
    );
    expect(hasPressablePvpTrinket(unitWith(null), ROUND)).toBe(true);
  });
  it("a Medallion press inside the round overrides a stale item list", () => {
    const pressed = (atMs: number) =>
      unitWith([BADGE, ADAPTATION], [[MEDALLION_SPELL_ID, atMs]]);
    expect(hasPressablePvpTrinket(pressed(60_000), ROUND)).toBe(true);
    // codex 85-tk-M-T126-1: a press after the round's end (a Solo Shuffle
    // unit's casts run on past the deciding death) says nothing of it
    expect(hasPressablePvpTrinket(pressed(125_000), ROUND)).toBe(false);
    expect(hasPressablePvpTrinket(pressed(-1), ROUND)).toBe(false);
  });
  it("codex 85-tk-M-T126-1b #2: a Medallion cast outside the round makes no Medallion of two other trinkets", () => {
    const twoOthers = (atMs: number) =>
      unitWith([BADGE, "1"], [[MEDALLION_SPELL_ID, atMs]]);
    expect(hasPressablePvpTrinket(twoOthers(-1), ROUND)).toBe(false);
    expect(hasPressablePvpTrinket(twoOthers(125_000), ROUND)).toBe(false);
    expect(hasPressablePvpTrinket(twoOthers(60_000), ROUND)).toBe(true);
  });
  it("codex 85-tk-M-T126-1b #1: the gate's bound is the producer's (a 3v3 round runs to the log's end)", () => {
    const u = unitWith([BADGE, ADAPTATION], [[MEDALLION_SPELL_ID, 105_000]]);
    const threes = {
      startTime: 0,
      endTime: 120_000,
      startInfo: { bracket: "3v3" },
    };
    expect(medallionPressedInRound(u, threes)).toBe(true);
    expect(hasPressablePvpTrinket(u, threes)).toBe(
      medallionPressedInRound(u, threes),
    );
  });
});

// pipeline T278 (codex 85-tk-L5-T278-1 #4): with no trinket slot to read,
// Adaptation's own trigger aura is the log's proof of it, as a Medallion
// press is of the Medallion
describe("detectTrinketType — Adaptation from its trigger aura (T278)", () => {
  const trigger = (u: ICombatUnit, dest?: string): ICombatUnit =>
    ({
      ...u,
      id: "P",
      auraEvents: [
        {
          spellId: "283167",
          destUnitId: dest ?? "P",
          logLine: { event: "SPELL_AURA_APPLIED", timestamp: 1000 },
        },
      ],
    }) as unknown as ICombatUnit;
  it("no equipment, the trigger on the unit: Adaptation", () => {
    expect(detectTrinketType(trigger(unitWith(null)))).toBe("Adaptation");
  });
  it("no equipment, no trigger, or a trigger on someone else: still Unknown", () => {
    expect(detectTrinketType(unitWith(null))).toBe("Unknown");
    expect(detectTrinketType(trigger(unitWith(null), "Q"))).toBe("Unknown");
  });
  it("readable slots decide first", () => {
    expect(detectTrinketType(trigger(unitWith([BADGE, "1"])))).toBe("None");
  });
});
