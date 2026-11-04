/**
 * fact10 class 2 (cooldown presses and their rows).
 *  - D28: a charge press's impact row (The Hunt 1246167 → 1246169, DB2
 *    Effect 96) is no press of its own, and a reader counting what hit
 *    counts the pair once, at the impact.
 */
import { describe, expect, it } from "vitest";

import {
  isNoPressRow,
  isPressImpactRow,
  pressImpactRow,
} from "../src/utils/castPress";
import { makeSpellCastEvent } from "./ported/testHelpers";

const T0 = 1_000_000;
type Row = Parameters<typeof isNoPressRow>[0];
const row = (id: string, ms: number, dest = "t1"): Row =>
  makeSpellCastEvent(
    id,
    T0 + ms,
    dest,
    "Target",
    "dh",
    "Hunter",
    0,
    "The Hunt",
  ) as unknown as Row;

describe("fact10 D28 — The Hunt's impact row", () => {
  it("915f90ae 2:48: 1246167 at the press, 1246169 272 ms later at the same target — one press", () => {
    const press = row("1246167", 168_260);
    const impact = row("1246169", 168_532);
    const rows = [press, impact];
    expect(pressImpactRow(press, rows)).toBe(impact);
    expect(isPressImpactRow(impact, rows)).toBe(true);
    expect(isNoPressRow(impact, rows)).toBe(true);
    expect(isNoPressRow(press, rows)).toBe(false);
  });

  it("an impact id at another target, or past the 2.5 s window, is no impact of that press", () => {
    const press = row("1246167", 10_000);
    expect(
      isPressImpactRow(row("1246169", 10_300, "t2"), [
        press,
        row("1246169", 10_300, "t2"),
      ]),
    ).toBe(false);
    const late = row("1246169", 13_000);
    expect(isPressImpactRow(late, [press, late])).toBe(false);
  });
});
