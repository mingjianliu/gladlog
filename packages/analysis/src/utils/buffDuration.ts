import { ICombatUnit } from "@gladlog/parser-compat";

import {
  BUFF_DURATION_TALENT_MODIFIERS,
  spellEffectData,
} from "../data/spellEffectData";
import { talentOwnershipOf, talentRankOf } from "./talentOwnership";

/**
 * Hand corrections to `spellEffectData[id].durationSeconds` for buffs whose DB2
 * duration does not describe what the game does, and where NO talent explains
 * the gap (a talent-explained gap belongs in `BUFF_DURATION_TALENT_MODIFIERS`
 * instead — see that table's "NOT registered" list before adding anything
 * here). Registered in curatedIdRegistry.
 *
 * Moved here from context/timelineHelpers.ts on 2026-09-06: the override was
 * being consulted by exactly ONE of the module's duration readers, so a
 * corrected value could not reach the others. Base duration + overrides +
 * talent layer now answer from this one function.
 */
export const SPELL_DURATION_OVERRIDES: Record<string, number> = {
  "421453": 6.5, // Ultimate Penitence
};

/**
 * Duration of a non-CC buff AS CAST BY THIS UNIT — the buff/CD twin of
 * `ccDuration.ts` → `ccFullDurationForCaster`, and the single predicate every
 * "when did this buff end" consumer should call.
 *
 * base (`SPELL_DURATION_OVERRIDES`, else the DB2 PvP-aware
 * `durationSeconds`) → plus every `BUFF_DURATION_TALENT_MODIFIERS` entry the
 * caster is known to hold, PER PURCHASED RANK (`talentRankOf`; a rank we
 * cannot read never lengthens — see its contract). Flat seconds are added
 * before percentages, matching the order the game applies SpellMods.
 *
 * Without a caster it returns the plain base duration, which is what every
 * call site did for all of them before the talent layer existed.
 */
export function buffFullDurationForCaster(
  spellId: string,
  caster: Pick<ICombatUnit, "spec" | "info" | "spellCastEvents"> | undefined,
): number | undefined {
  const noCasterValue =
    SPELL_DURATION_OVERRIDES[spellId] ??
    spellEffectData[spellId]?.durationSeconds;
  const mods = BUFF_DURATION_TALENT_MODIFIERS[spellId];
  if (!caster || mods === undefined || mods.length === 0) return noCasterValue;

  // With a caster we can price the talents exactly, so we start from the
  // UNTALENTED base rather than from `noCasterValue` — the latter already
  // carries the typical caster's talent (Barkskin 12, not 8) and would double
  // it.
  //
  // Three-state, and note the asymmetry with the CC side: there, "unknown"
  // means "do not lengthen", because the base IS the official duration and
  // lengthening is the claim needing evidence. Here the no-caster value is
  // ALREADY the talented one, so falling back to the untalented base on
  // unknown would be an equally unevidenced claim in the other direction —
  // and a worse one, since ~100 % of observed casters hold these talents. So:
  // a definite "no" prices the base; anything we cannot read (no
  // COMBATANT_INFO, an unresolvable loadout, or a "yes" that carries no rank —
  // cast evidence / PvP slot / baseline) falls back to the typical value,
  // exactly what this call site got before the talent layer existed.
  let seconds = mods[0]!.untalentedBaseSeconds;
  let mult = 1;
  for (const m of mods) {
    if (talentOwnershipOf(caster, m.talentSpellId) === "no") continue;
    const rank = talentRankOf(caster, m.talentSpellId);
    if (rank <= 0) return noCasterValue;
    if (m.addSeconds !== undefined) seconds += m.addSeconds * rank;
    if (m.pct !== undefined) mult += (m.pct / 100) * rank;
  }
  return seconds * mult;
}
