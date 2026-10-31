/**
 * fact5 D16 class (F18; user ruling 2026-10-25 「通用规则」): an enemy
 * offensive cooldown's own aura with no press of it is a `(no press)`
 * occurrence, weight 0 — and codex 20-F18-02 #2 / #3: only for a cooldown the
 * enemy-CD window test admits, and ended at a later press of it.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { friendlyOffensiveCdActiveAt } from "../src/utils/cooldowns";
import { auraOffensiveOccurrences } from "../src/utils/offensiveAuraOccurrences";
import { makeAuraEvent, makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;
const bounds = { startTime: T0, endTime: at(120) };
const unitWith = (auraId: string, casts: number[] = []) =>
  makeUnit("e1", {
    auraEvents: [
      makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, auraId, at(10), "e1", "e1", "BUFF"),
      makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, auraId, at(26), "e1", "e1", "BUFF"),
    ],
    spellCastEvents: casts.map((t) => makeSpellCastEvent(auraId, at(t), "e1", "E", "e1", "E")),
  }) as never;

describe("auraOffensiveOccurrences — a cast-less offensive aura (D16)", () => {
  it("Recklessness with no press: one (no press) occurrence, weight 0, the aura's span", () => {
    const [o, ...rest] = auraOffensiveOccurrences(unitWith("1719"), bounds).occurrences;
    expect(rest).toEqual([]);
    expect(o!.spellName).toBe("Recklessness (no press)");
    expect(o!.dangerWeight).toBe(0);
    expect([o!.startMs, o!.endMs]).toEqual([at(10), at(26)]);
  });
  it("a press at the aura's start is that press — no occurrence", () => {
    expect(auraOffensiveOccurrences(unitWith("1719", [10]), bounds).occurrences).toEqual([]);
  });
  it("a later press inside it ends the proc there (#3)", () => {
    const [o] = auraOffensiveOccurrences(unitWith("1719", [18]), bounds).occurrences;
    expect(o!.endMs).toBe(at(18));
  });
  it("a press of a DB2 override variant is the press of its own buff (fact7 D68)", () => {
    // Predator's Wake 1259431 on The Hunt's button; the caster died before
    // the The Hunt row that would have paired it
    expect(auraOffensiveOccurrences(unitWith("1259431", [10]), bounds).occurrences).toEqual([]);
  });
  it("an id with no enemy-CD cooldown is none (#2: Archangel 81700)", () => {
    expect(auraOffensiveOccurrences(unitWith("81700"), bounds).occurrences).toEqual([]);
  });
});

describe("friendlyOffensiveCdActiveAt — [friendly offensive CD active] (fact7 D11 / D72 / D79)", () => {
  const round = { startTime: T0, endTime: at(120) };
  const friendly = (over: object) => makeUnit("f1", over) as never;
  const ask = (unit: never, s: number) =>
    friendlyOffensiveCdActiveAt([unit], [], new Set(["f1"]), at(s), round);

  it("a healing buff with no cooldown is no offensive cooldown (Archangel 81700)", () => {
    const unit = friendly({
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "81700", at(10), "f1", "f1", "BUFF"),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, "81700", at(28), "f1", "f1", "BUFF"),
      ],
    });
    expect(ask(unit, 15)).toBe(false);
  });
  it("an offensive summon counts for its own length (Force of Nature 205636, 10 s)", () => {
    const unit = friendly({
      spellCastEvents: [makeSpellCastEvent("205636", at(10), "f1", "F", "f1", "F")],
    });
    expect([ask(unit, 9), ask(unit, 10), ask(unit, 19.9), ask(unit, 20.5)]).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });
  it("a cooldown's own aura still counts (Recklessness 1719)", () => {
    const unit = friendly({
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "1719", at(10), "f1", "f1", "BUFF"),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, "1719", at(22), "f1", "f1", "BUFF"),
      ],
    });
    expect([ask(unit, 15), ask(unit, 23)]).toEqual([true, false]);
  });
});
