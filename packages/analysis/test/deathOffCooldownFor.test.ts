/**
 * WO3 #18 (r1014-176, f4da82c5 2:55): the death line's free stretch reads CC
 * alone; `offCooldownForLastSeconds` says how long before the death the
 * option had been off cooldown, on the cooldown's own return (the ledger's
 * rendered-second slack taken back off).
 */
import { LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { offCooldownForLastSeconds } from "../src/utils/deathOutcomeAnalysis";

const T0 = 1_000_000;
const unit = (castAt: number[]): any => ({
  id: "p",
  name: "P-R-US",
  spec: "257",
  info: { talents: [], pvpTalents: [] },
  spellCastEvents: castAt.map((s) => ({
    spellId: "47788",
    logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 + s * 1000 },
  })),
  auraEvents: [],
});

describe("offCooldownForLastSeconds", () => {
  it("a 30 s cooldown pressed at 0 s, death at 33 s → off cooldown for the last 3.0 s", () => {
    expect(offCooldownForLastSeconds(unit([0]), "47788", 30, 33, T0)).toBe(3);
  });
  it("off cooldown for the whole window → undefined", () => {
    expect(
      offCooldownForLastSeconds(unit([0]), "47788", 30, 60, T0),
    ).toBeUndefined();
    expect(
      offCooldownForLastSeconds(unit([]), "47788", 30, 20, T0),
    ).toBeUndefined();
  });
});
