import { describe, expect, it } from "vitest";

import {
  setBonusDurationSeconds,
  setPiecesWorn,
} from "../src/data/classSetBonuses";

const gear = (...ids: string[]) => ({
  info: { equipment: ids.map((id) => ({ id })) },
});
/** the same gear on a unit of `spec` (a set bonus is its spec's: GH #175) */
const on = (spec: string, ...ids: string[]) => ({ ...gear(...ids), spec });
const FOUR = ["271526", "271527", "271528", "271529", "1"];

describe("class set bonuses (fact8 D15)", () => {
  it("counts the set's items in the gear COMBATANT_INFO lists", () => {
    expect(setPiecesWorn(gear(...FOUR), "2057")).toBe(4);
    expect(setPiecesWorn(gear("1", "2"), "2057")).toBe(0);
    expect(setPiecesWorn(undefined, "2057")).toBe(0);
  });

  it("Incarnation runs 5 s longer on four pieces, nothing below", () => {
    expect(setBonusDurationSeconds("102543", on("103", ...FOUR))).toBe(5);
    expect(
      setBonusDurationSeconds("102543", on("103", ...FOUR.slice(0, 3))),
    ).toBe(0);
    expect(setBonusDurationSeconds("102543", undefined)).toBe(0);
    expect(setBonusDurationSeconds("1", on("103", ...FOUR))).toBe(0);
    // the druid set on a Guardian, or on a unit whose spec is unknown
    expect(setBonusDurationSeconds("102543", on("104", ...FOUR))).toBe(0);
    expect(setBonusDurationSeconds("102543", gear(...FOUR))).toBe(0);
  });

  it("Essence Break's debuff runs 1 s longer on the Havoc 4pc (GH #197)", () => {
    const havoc = ["271535", "271536", "271537", "271538"];
    expect(setPiecesWorn(gear(...havoc), "2056")).toBe(4);
    expect(setBonusDurationSeconds("320338", on("577", ...havoc))).toBe(1);
    expect(
      setBonusDurationSeconds("320338", on("577", ...havoc.slice(0, 3))),
    ).toBe(0);
    expect(setBonusDurationSeconds("320338", on("581", ...havoc))).toBe(0);
  });
});
