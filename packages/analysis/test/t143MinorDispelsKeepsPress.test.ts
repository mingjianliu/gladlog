/**
 * T143 (user ruling A2, 2026-11-17; GH #221 g1): a press whose removals a
 * deliberate `[MINOR DISPELS]` part lists lost its `[PRESS]` line and with
 * it `(Ns cd, back m:ss)`. A press with a cooldown of 30 s or more keeps the
 * line; a short-cooldown dispel stays folded.
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { emitOffListPressEntries } from "../src/context/timelineSections/offListPress";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  type IOffListPress,
  lineStatesPress,
  MINOR_DISPELS_KEEPS_PRESS_CD_S,
} from "../src/utils/offListPress";
import { makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const MASS_DISPEL = "32375";
const owner = makeUnit("o1", {
  name: "Owner",
  class: CombatUnitClass.Priest,
  spec: CombatUnitSpec.Priest_Holy,
  reaction: CombatUnitReaction.Friendly,
});
const FOLD = (part: string) =>
  `1:15  [MINOR DISPELS]   1(HPriest): ${part} (low-priority, folded)`;

function pressLines(cooldownSeconds: number, fold: string): string[] {
  const lines: string[] = [];
  emitOffListPressEntries({
    owner,
    friends: [owner],
    pid: () => "1(HPriest)",
    enemyPid: () => "?",
    addEntry: (_t: number, l: string) => {
      lines.push(l);
      return true;
    },
    entries: [{ timeSeconds: 75, lines: [fold] }],
    presses: [
      {
        unit: owner,
        spellId: MASS_DISPEL,
        timeSeconds: 75.4,
        cooldownSeconds,
        charges: 1,
        readyAgainAtSeconds: 75.4 + cooldownSeconds,
      } as IOffListPress,
    ],
  } as unknown as Parameters<typeof emitOffListPressEntries>[0]);
  return lines;
}

describe("a press beside a deliberate [MINOR DISPELS] part (T143, ruling A2)", () => {
  const deliberate = FOLD("Mass Dispel ×1 (1:15 Polymorph)");

  it("the threshold is the ruling's 30 s", () => {
    expect(MINOR_DISPELS_KEEPS_PRESS_CD_S).toBe(30);
  });

  it("a 120 s press keeps its [PRESS] line with the cooldown and return", () => {
    const l = pressLines(120, deliberate);
    expect(l).toHaveLength(1);
    expect(l[0]).toContain("[PRESS]");
    expect(l[0]).toContain("Mass Dispel (120s cd, back 3:15)");
  });

  it("exactly 30 s keeps it; under 30 s stays folded", () => {
    expect(pressLines(30, deliberate)).toHaveLength(1);
    expect(pressLines(29.9, deliberate)).toEqual([]);
    expect(pressLines(8, deliberate)).toEqual([]);
  });

  it("a passive part never stated the press (T119): the line is there at any cooldown", () => {
    expect(pressLines(8, FOLD("Mass Dispel (passive)"))).toHaveLength(1);
  });

  it("lineStatesPress: without a cooldown the deliberate part states the press (the scans' question)", () => {
    const text = deliberate.replace(/^\s*\d+:\d\d\s+/, "");
    expect(lineStatesPress(text, "Mass Dispel", "1", "1")).toBe(true);
    expect(lineStatesPress(text, "Mass Dispel", "1", "1", 29)).toBe(true);
    expect(lineStatesPress(text, "Mass Dispel", "1", "1", 30)).toBe(false);
    // another tag's line states it whatever the cooldown
    expect(
      lineStatesPress(
        "[YOU] [CD]   Mass Dispel (self: 80% HP)",
        "Mass Dispel",
        "1",
        "1",
        120,
      ),
    ).toBe(true);
  });
});
