import type { ICDModifier } from "../../src/utils/talentModifiers";

/**
 * Manual talent-to-spell modifications that cannot be automatically extracted from DB2.
 * These are often "SPELL_AURA_DUMMY" effects that require server-side script logic.
 *
 * Map: baseSpellId -> list of ICDModifier
 */
export const CUSTOM_TALENT_MODIFIERS: Record<string, ICDModifier[]> = {
  // --- Priest ---
  // Guardian Spirit (base)
  "47788": [
    {
      talentSpellId: "200209", // Guardian Angel (Talent)
      effect: "reduce_cd",
      value: 60,
      isConditional: true, // Only if it doesn't proc (target doesn't die)
    },
  ],
};
