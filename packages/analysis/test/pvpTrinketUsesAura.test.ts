/**
 * fact3 D23 / D39 (corpusFactScan trinketOutOf): a Gladiator's Medallion
 * press is timed at its own 336126 self-aura — logged in the ms the control
 * it broke came off, the cast row up to 150 ms later.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { pvpTrinketUses } from "../src/utils/pvpTrinketUses";

const ev = (event: LogEvent, ms: number) => ({
  spellId: "336126",
  srcUnitId: "p",
  destUnitId: "p",
  timestamp: ms,
  logLine: { event, timestamp: ms },
});

describe("pvpTrinketUses — the Medallion press at its own aura", () => {
  it("the aura 72 ms before the cast row is the press instant", () => {
    const u = {
      id: "p",
      auraEvents: [ev(LogEvent.SPELL_AURA_APPLIED, 1_000)],
      spellCastEvents: [ev(LogEvent.SPELL_CAST_SUCCESS, 1_072)],
    };
    expect(pvpTrinketUses(u as never).map((x) => x.atMs)).toEqual([1_000]);
  });
  it("no aura in the 300 ms before: the cast row", () => {
    const u = {
      id: "p",
      auraEvents: [ev(LogEvent.SPELL_AURA_APPLIED, 500)],
      spellCastEvents: [ev(LogEvent.SPELL_CAST_SUCCESS, 1_000)],
    };
    expect(pvpTrinketUses(u as never).map((x) => x.atMs)).toEqual([1_000]);
  });
});
