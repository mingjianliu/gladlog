/**
 * genSpellReach's radius collection (reliability round 3, 1bad): Mind
 * Control's possession row carries a 100 yd radius that is not reach. The
 * rule is scoped to that effect ROW — other rows of the same spell keep their
 * radius, trigger links survive, and other auras are untouched (codex astra).
 */
import { describe, expect, it } from "vitest";

import { effectRadiiAndParents } from "../scripts/datagen/genSpellReach";

const RADIUS = new Map([
  ["7", 100],
  ["8", 8],
  ["13", 10],
]);
const COLS = ["EffectRadiusIndex_0", "EffectRadiusIndex_1"];
const row = (
  spellId: string,
  effect: string,
  aura: string,
  r0: string,
  r1: string,
  trigger = "0",
) => ({
  SpellID: spellId,
  Effect: effect,
  EffectAura: aura,
  EffectRadiusIndex_0: r0,
  EffectRadiusIndex_1: r1,
  EffectTriggerSpell: trigger,
});

describe("effectRadiiAndParents", () => {
  it("a MOD_POSSESS row contributes no radius from either slot", () => {
    const { radiusBySpell } = effectRadiiAndParents(
      [row("605", "6", "2", "7", "7"), row("605", "6", "79", "0", "0")],
      COLS,
      RADIUS,
      "EffectTriggerSpell",
    );
    expect(radiusBySpell.get("605")).toBeUndefined();
  });

  it("another row of the same spell keeps its area radius", () => {
    const { radiusBySpell } = effectRadiiAndParents(
      [row("900001", "6", "2", "7", "0"), row("900001", "2", "0", "0", "8")],
      COLS,
      RADIUS,
      "EffectTriggerSpell",
    );
    expect(radiusBySpell.get("900001")).toBe(8);
  });

  it("the excluded row still records what it triggers", () => {
    const { parentsOf } = effectRadiiAndParents(
      [row("900002", "6", "2", "7", "7", "900003")],
      COLS,
      RADIUS,
      "EffectTriggerSpell",
    );
    expect(parentsOf.get("900003")).toEqual(["900002"]);
  });

  it("other auras and non-aura effects keep their radius (BIND_SIGHT included)", () => {
    const { radiusBySpell } = effectRadiiAndParents(
      [
        row("2096", "6", "1", "7", "7"), // Mind Vision, BIND_SIGHT: not listed
        row("51052", "6", "0", "8", "0"), // placed area
        row("465", "35", "0", "13", "0"), // area aura effect
      ],
      COLS,
      RADIUS,
      "EffectTriggerSpell",
    );
    expect(radiusBySpell.get("2096")).toBe(100);
    expect(radiusBySpell.get("51052")).toBe(8);
    expect(radiusBySpell.get("465")).toBe(10);
  });
});
