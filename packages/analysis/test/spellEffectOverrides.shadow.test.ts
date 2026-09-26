/**
 * SPELL_EFFECT_OVERRIDES is spread over the generated DB2 table, so a row
 * carrying an explicit `cooldownSeconds: undefined` silently DELETES the
 * official cooldown (2026-09-26: Astral Shift and Psychic Scream fell out of
 * the ledger for one capture — cd-waste / burst-into-mitigation moved by
 * dozens — after their hand cooldowns were "removed" as `undefined`).
 */
import { describe, expect, it } from "vitest";

import { SPELL_EFFECTS_GENERATED } from "../src/data/spellEffectGenerated";
import { SPELL_EFFECT_OVERRIDES } from "../src/data/spellEffectOverrides";
import { effectiveCooldownSeconds } from "../src/data/spellEffectData";

describe("hand overrides never shadow an official value with undefined", () => {
  it("no override row has an own cooldownSeconds key set to undefined while DB2 has a value", () => {
    const gen = SPELL_EFFECTS_GENERATED as Record<string, { cooldownSeconds?: number; durationSeconds?: number }>;
    for (const [id, o] of Object.entries(SPELL_EFFECT_OVERRIDES)) {
      // durations are deliberately override-authoritative (spellEffectData.ts:
      // "their silence is itself a hand-modeling choice"); cooldowns are not.
      for (const k of ["cooldownSeconds"] as const) {
        if (Object.prototype.hasOwnProperty.call(o, k) && o[k] === undefined && gen[id]?.[k] != null)
          throw new Error(`${id} ${o.name}: ${k} is an own key set to undefined and shadows DB2 ${gen[id]?.[k]}`);
      }
    }
  });
  it("Astral Shift and Psychic Scream take their cooldown from DB2 (talent reductions apply once, in CD_TALENT_MODIFIERS)", () => {
    expect(effectiveCooldownSeconds("108271")).toBe(120);
    expect(effectiveCooldownSeconds("8122")).toBe(40);
  });
});
