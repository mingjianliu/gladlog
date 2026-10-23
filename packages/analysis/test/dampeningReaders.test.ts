/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * codex 20-F17-03 #2 (306d0a57): a line about one unit reads that unit's own
 * Dampening doses only from its first dose on — before it, its side's. A
 * first own dose of 43 % at 23.3 s used to derive a 42 % opening at 0:03,
 * where the side's first dose (42 % at 13.7 s) and the header said 41.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  dampeningReadersAt,
  getDampeningPercentage,
} from "../src/utils/dampening";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

const START = 1_000_000;
const ms = (s: number) => START + s * 1000;
const dose = (s: number, stacks: number, who: string) => {
  const e = makeAuraEvent(
    LogEvent.SPELL_AURA_APPLIED_DOSE,
    "110310",
    ms(s),
    who,
    who,
  );
  (e.logLine as any).parameters[12] = stacks;
  return e;
};

describe("dampeningReadersAt", () => {
  const mate = makeUnit("Mate", {
    auraEvents: [dose(13.737, 42, "Mate"), dose(23.7, 43, "Mate")],
  });
  const mage = makeUnit("Mage", { auraEvents: [dose(23.3, 43, "Mage")] });
  const side = [mate as any, mage as any];

  it("before the unit's first dose: the side's doses (the header's opening)", () => {
    const readers = dampeningReadersAt(mage as any, side, ms(3));
    expect(readers).toBe(side);
    expect(getDampeningPercentage("2v2", readers, ms(3), side)).toBe(
      getDampeningPercentage("2v2", side, ms(3), side),
    );
    // the unit's own doses alone would derive one more
    expect(getDampeningPercentage("2v2", [mage as any], ms(3), side)).toBe(
      (getDampeningPercentage("2v2", side, ms(3), side) ?? 0) + 1,
    );
  });
  it("from its first dose on: its own", () => {
    expect(dampeningReadersAt(mage as any, side, ms(23.3))).toEqual([mage]);
    expect(dampeningReadersAt(undefined, side, ms(30))).toBe(side);
  });
});
