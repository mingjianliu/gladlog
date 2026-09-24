import { CombatUnitClass, LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  TREMOR_BREAK_MAX_LAG_MS,
  TREMOR_TOTEM_CAST_SPELL_ID,
  tremorTotemBreak,
} from "../src/utils/ccTrinketAnalysis";

type Mate = Parameters<typeof tremorTotemBreak>[2][number];
const START = 1_000_000;
const shaman = (castAtS: number[], cls = CombatUnitClass.Shaman): Mate =>
  ({
    name: "Totemguy-Realm",
    class: cls,
    spellCastEvents: castAtS.map((s) => ({
      spellId: TREMOR_TOTEM_CAST_SPELL_ID,
      logLine: {
        event: LogEvent.SPELL_CAST_SUCCESS,
        timestamp: START + s * 1000,
      },
    })),
  }) as unknown as Mate;
// Psychic Scream applied at 10 s, ended at 13 s
const fear = { spellId: "8122", atSeconds: 10, durationSeconds: 3 };

describe("tremorTotemBreak (GH #100: the one tremor fact the log supports)", () => {
  it("credits a totem dropped mid-fear when the fear ends the same instant", () => {
    expect(tremorTotemBreak(fear, START, [shaman([13])])).toEqual({
      shamanName: "Totemguy-Realm",
      castMs: START + 13_000,
    });
    expect(
      tremorTotemBreak(fear, START, [
        shaman([13 - TREMOR_BREAK_MAX_LAG_MS / 1000]),
      ]),
    ).not.toBeNull();
  });

  it("handles exact 500ms lag boundary and rejects beyond it", () => {
    const at500ms = tremorTotemBreak(fear, START, [shaman([12.5])]);
    expect(at500ms).toEqual({
      shamanName: "Totemguy-Realm",
      castMs: START + 12_500,
    });
    const at501ms = tremorTotemBreak(fear, START, [shaman([12.499])]);
    expect(at501ms).toBeNull();
  });

  it("does NOT credit a totem that was already up when the fear landed", () => {
    // fear also breaks on damage — a short fear under a standing totem is not attributable
    expect(tremorTotemBreak(fear, START, [shaman([8])])).toBeNull();
    expect(tremorTotemBreak(fear, START, [shaman([10])])).toBeNull();
  });

  it("does not credit a totem dropped well before the fear ended, or after it", () => {
    expect(tremorTotemBreak(fear, START, [shaman([11])])).toBeNull();
    expect(tremorTotemBreak(fear, START, [shaman([13.2])])).toBeNull();
  });

  it("handles out-of-order timestamps and finds matching cast", () => {
    expect(tremorTotemBreak(fear, START, [shaman([13.2, 13.0])])).toEqual({
      shamanName: "Totemguy-Realm",
      castMs: START + 13_000,
    });
  });

  it("finds valid cast on a later teammate if earlier teammate has no match", () => {
    const nonMatchingShaman = shaman([5]);
    nonMatchingShaman.name = "FirstShaman";
    const matchingShaman = shaman([13]);
    matchingShaman.name = "SecondShaman";
    expect(
      tremorTotemBreak(fear, START, [nonMatchingShaman, matchingShaman]),
    ).toEqual({
      shamanName: "SecondShaman",
      castMs: START + 13_000,
    });
  });

  it("only for tremor-breakable CC, only from a shaman", () => {
    expect(
      tremorTotemBreak({ ...fear, spellId: "853" }, START, [shaman([13])]),
    ).toBeNull();
    expect(
      tremorTotemBreak(fear, START, [shaman([13], CombatUnitClass.Priest)]),
    ).toBeNull();
  });
});
