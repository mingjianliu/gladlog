/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T186 (round-14 D13, 6df8aae6 0:13): a log-write stall between a cooldown's
 * aura row and its press row is one press, not a `(no press)` copy plus a
 * press.
 */
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";

import {
  auraOffensiveOccurrences,
  GENERIC_PRESS_AFTER_MS,
  NO_PRESS_SUFFIX,
  PRESS_ROW_ADJACENT_LINES,
} from "../src/utils/offensiveAuraOccurrences";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const START = 1_000_000;
const ARMY = "42650";
const at = (e: any, lineIndex: number) => {
  e.logLine = { ...e.logLine, lineIndex };
  return e;
};
/** the audited instants: aura row 13.465 s, press row 1.568 s later */
const noPressCopies = (auraLine: number, pressLine: number, endLine = 9065) => {
  const dk = makeUnit("dk", {
    name: "Unholy",
    spec: CombatUnitSpec.DeathKnight_Unholy,
    auraEvents: [
      at(
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          ARMY,
          START + 13_465,
          "dk",
          "dk",
          "BUFF",
        ),
        auraLine,
      ),
      at(
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          ARMY,
          endLine === 9065 ? START + 43_468 : START + 14_000,
          "dk",
          "dk",
          "BUFF",
        ),
        endLine,
      ),
    ],
    spellCastEvents: [
      at(
        makeSpellCastEvent(ARMY, START + 15_033, "dk", "Self", "dk"),
        pressLine,
      ),
    ],
  });
  return auraOffensiveOccurrences(dk, {
    startTime: START,
    endTime: START + 60_000,
  }).occurrences.filter((o) => o.spellName.endsWith(NO_PRESS_SUFFIX));
};

describe("a press row stamped late by a log-write stall (T186)", () => {
  it("the audited stamps are further apart than the press reach", () => {
    expect(15_033 - 13_465).toBeGreaterThan(GENERIC_PRESS_AFTER_MS);
  });
  it("the press row two lines after the aura row: one press, no (no press) copy", () => {
    expect(noPressCopies(849, 849 + PRESS_ROW_ADJACENT_LINES)).toHaveLength(0);
  });
  it("the aura's own end written between the two rows: another press's", () => {
    // codex 85-tk-CD-T186-1: APPLIED, REMOVED, SUCCESS on consecutive lines
    expect(noPressCopies(849, 851, 850)).toHaveLength(1);
  });
  it("rows of the file between the two: the aura went up with no press", () => {
    expect(noPressCopies(849, 849 + 130)).toHaveLength(1);
  });
});
