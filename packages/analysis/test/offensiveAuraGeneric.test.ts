/**
 * fact5 D16 class (F18; user ruling 2026-10-25 「通用规则」): an enemy
 * offensive cooldown's own aura with no press of it is a `(no press)`
 * occurrence, weight 0 — and codex 20-F18-02 #2 / #3: only for a cooldown the
 * enemy-CD window test admits, and ended at a later press of it.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
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
  it("an id with no enemy-CD cooldown is none (#2: Archangel 81700)", () => {
    expect(auraOffensiveOccurrences(unitWith("81700"), bounds).occurrences).toEqual([]);
  });
});
