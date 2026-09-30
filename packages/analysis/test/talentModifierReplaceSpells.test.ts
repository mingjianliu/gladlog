/**
 * Data pin (triage 2026-09-29 res-readiness F-C20, G7-P9): every
 * `replace_spell` value in the generated talentModifiers.json is a real
 * spell. Row 301624 (value 8) made Bloodlust / Heroism proc-only.
 */
import { describe, expect, it } from "vitest";

import spellNames from "../src/data/spellNames.json";
import talentModifiers from "../src/data/talentModifiers.json";

describe("talentModifiers.json replace_spell values", () => {
  it("every one names a spell with a SpellName row", () => {
    const names = spellNames as Record<string, string>;
    const bad: string[] = [];
    for (const [target, mods] of Object.entries(
      talentModifiers as unknown as Record<string, Array<{ effect: string; value: number; sourceRowId?: string }>>,
    )) {
      if (!Array.isArray(mods)) continue;
      for (const m of mods)
        if (m.effect === "replace_spell" && !(String(m.value) in names))
          bad.push(`${target} ← ${m.value} (row ${m.sourceRowId})`);
    }
    expect(bad).toEqual([]);
  });
});
