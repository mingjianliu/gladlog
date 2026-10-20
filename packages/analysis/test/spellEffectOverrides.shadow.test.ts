/**
 * SPELL_EFFECT_OVERRIDES is spread over the generated DB2 table, so a row
 * carrying an explicit `cooldownSeconds: undefined` silently DELETES the
 * official cooldown (2026-09-26: Astral Shift and Psychic Scream fell out of
 * the ledger for one capture — cd-waste / burst-into-mitigation moved by
 * dozens — after their hand cooldowns were "removed" as `undefined`).
 */
import { describe, expect, it } from "vitest";

import { effectiveCooldownSeconds } from "../src/data/spellEffectData";
import { SPELL_EFFECTS_GENERATED } from "../src/data/spellEffectGenerated";
import { SPELL_EFFECT_OVERRIDES } from "../src/data/spellEffectOverrides";

describe("hand overrides never shadow an official value with undefined", () => {
  it("no override row has an own cooldownSeconds key set to undefined while DB2 has a value", () => {
    const gen = SPELL_EFFECTS_GENERATED as Record<
      string,
      { cooldownSeconds?: number; durationSeconds?: number }
    >;
    for (const [id, o] of Object.entries(SPELL_EFFECT_OVERRIDES)) {
      // durations are deliberately override-authoritative (spellEffectData.ts:
      // "their silence is itself a hand-modeling choice"); cooldowns are not.
      for (const k of ["cooldownSeconds"] as const) {
        if (
          Object.prototype.hasOwnProperty.call(o, k) &&
          o[k] === undefined &&
          gen[id]?.[k] != null
        )
          throw new Error(
            `${id} ${o.name}: ${k} is an own key set to undefined and shadows DB2 ${gen[id]?.[k]}`,
          );
      }
    }
  });
  it("Astral Shift and Psychic Scream take their cooldown from DB2 (talent reductions apply once, in CD_TALENT_MODIFIERS)", () => {
    expect(effectiveCooldownSeconds("108271")).toBe(120);
    expect(effectiveCooldownSeconds("8122")).toBe(40);
  });
  it("Ardent Defender's cooldown is the official one — the hand 120 s shadowed DB2's 90 s (FT F20)", () => {
    const gen = SPELL_EFFECTS_GENERATED as Record<
      string,
      { cooldownSeconds?: number }
    >;
    expect(gen["31850"]?.cooldownSeconds).toBe(90);
    expect(effectiveCooldownSeconds("31850")).toBe(
      gen["31850"]?.cooldownSeconds,
    );
  });
  // The accusing direction: a hand cooldown SHORTER than the official one
  // calls a button ready that is not (cd-hoarded, cd-waste, `[RES] rdy:`), and
  // no recast scan can see it — a player who waits the real cooldown never
  // presses "too early" (`ledgerImpossibleCastScan` / `cdRecastFloorScan` only
  // catch a cooldown modelled too LONG). Blessing of Spellwarding sat at a
  // hand 180 s against the 300 s of its charge pool until 2026-10-13. A row
  // that must be shorter (a reduction every holder has and no talent row
  // carries) is signed here with its evidence.
  const SIGNED_SHORTER_THAN_DB2: Record<string, string> = {};
  it("no hand cooldown is shorter than the DB2 one unsigned", () => {
    const official = (id: string): number | undefined => {
      const g = (
        SPELL_EFFECTS_GENERATED as Record<
          string,
          {
            cooldownSeconds?: number;
            charges?: { chargeCooldownSeconds?: number };
          }
        >
      )[id];
      const cd = g?.cooldownSeconds;
      const recharge = g?.charges?.chargeCooldownSeconds;
      return cd == null && recharge == null
        ? undefined
        : Math.max(cd ?? 0, recharge ?? 0);
    };
    const shorter: string[] = [];
    let compared = 0;
    for (const [id, o] of Object.entries(SPELL_EFFECT_OVERRIDES)) {
      const hand = effectiveCooldownSeconds(id);
      const db2 = official(id);
      if (hand === undefined || db2 === undefined) continue;
      compared++;
      if (hand < db2 && !(id in SIGNED_SHORTER_THAN_DB2))
        shorter.push(`${id} ${o.name}: hand ${hand} s, DB2 ${db2} s`);
    }
    expect(shorter).toEqual([]);
    expect(compared).toBeGreaterThan(80);
  });
});
