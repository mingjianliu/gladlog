/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GH #174: a PvP talent that replaced the purge is the button its readiness
 * follows. Kleptomania 198100 replaces Spellsteal 30449 and has a 20 s
 * cooldown; read through Spellsteal, a mage who pressed it at 1 s was "ready"
 * at 5 s and took a `missed-purge`.
 */
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  isCdGatedPurger,
  purgeReadyAtSeconds,
  purgeSpellOf,
} from "../src/utils/dispelAnalysis";

const START = 1_000_000;
const KLEPTOMANIA = "198100";
const SPELLSTEAL = "30449";

const mage = (pvpTalents: string[], pressS: number[]): any => ({
  id: "m1",
  name: "m1",
  spec: CombatUnitSpec.Mage_Arcane,
  info: { pvpTalents, talents: [] },
  spellCastEvents: pressS.map((s) => ({
    spellId: pvpTalents.includes(KLEPTOMANIA) ? KLEPTOMANIA : SPELLSTEAL,
    logLine: {
      event: LogEvent.SPELL_CAST_SUCCESS,
      timestamp: START + s * 1000,
    },
  })),
});

describe("purge readiness follows the replacing talent (GH #174)", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("names the replacing talent, and the base purge without it", () => {
    expect(purgeSpellOf(mage([KLEPTOMANIA], []))).toBe(KLEPTOMANIA);
    expect(purgeSpellOf(mage([], []))).toBe(SPELLSTEAL);
    expect(purgeSpellOf(mage(["999999"], []))).toBe(SPELLSTEAL);
  });

  it("Kleptomania pressed at 1 s is on cooldown at 5 s and back at 21 s", () => {
    const u = mage([KLEPTOMANIA], [1]);
    expect(purgeReadyAtSeconds(u, new Set(), START + 5000, START)).toBe(21);
  });

  it("a removal row naming the replaced id does not read the talent ready", () => {
    const u = mage([KLEPTOMANIA], [1]);
    expect(
      purgeReadyAtSeconds(u, new Set([SPELLSTEAL]), START + 5000, START),
    ).toBe(21);
  });

  it("the replacing talent makes a cooldown-gated purger; Spellsteal does not", () => {
    expect(isCdGatedPurger(mage([KLEPTOMANIA], []))).toBe(true);
    expect(isCdGatedPurger(mage([], []))).toBe(false);
  });

  it("an unpressed Kleptomania is ready, the spell it replaced is not asked", () => {
    const u = mage([KLEPTOMANIA], []);
    expect(purgeReadyAtSeconds(u, new Set(), START + 5000, START)).toBe(
      -Infinity,
    );
  });
});
