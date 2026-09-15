import { ICombatUnit } from "@gladlog/parser-compat";

import {
  CC_DURATION_TALENT_MODIFIERS,
  ccFullDurationSeconds,
} from "../data/spellEffectData";
import { talentModifierOwnershipOf } from "./talentOwnership";

/**
 * Full (undiminished) PvP duration of a CC / root aura AS CAST BY THIS UNIT:
 * `ccFullDurationSeconds` (official DB2, overrides layered) times every
 * `CC_DURATION_TALENT_MODIFIERS` entry the caster is known to hold
 * (`talentModifierOwnershipOf` === "yes"; flat seconds before percentages; "unknown" never lengthens — a claim about a
 * longer CC must rest on evidence the player has the talent). Without a caster
 * it is the plain base duration.
 *
 * GH #44 tail (2026-09-02): the first entry is Resonant Voice → Intimidating
 * Shout 6 → 7.2 s. Consumer: ccBreakAnalysis (the "Xs of CC wasted" estimate
 * — a Warrior with the talent whose Intimidating Shout got broken at 6.5 s
 * used to be told the break wasted nothing).
 */
export function ccFullDurationForCaster(
  spellId: string,
  caster: Pick<ICombatUnit, "spec" | "info" | "spellCastEvents"> | undefined,
): number | undefined {
  const base = ccFullDurationSeconds(spellId);
  if (base === undefined || !caster) return base;
  let add = 0;
  let mult = 1;
  // talentModifierOwnershipOf, not talentOwnershipOf: a hero talent such as
  // Boneshaker is outside the Fury tree, and the plain predicate's baseline
  // step would call every Fury warrior a holder (GH #96 M3b run 1)
  for (const m of CC_DURATION_TALENT_MODIFIERS[spellId] ?? []) {
    const own = talentModifierOwnershipOf(caster, m.talentSpellId);
    if (m.includedInBase) {
      // the typical base already carries it: only a definite "no" shortens
      if (own === "no") add -= m.addSeconds ?? 0;
      continue;
    }
    if (own === "yes") {
      add += m.addSeconds ?? 0;
      mult *= 1 + (m.pct ?? 0) / 100;
    }
  }
  return (base + add) * mult;
}
