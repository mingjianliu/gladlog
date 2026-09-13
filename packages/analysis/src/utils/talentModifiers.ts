import talentModifiersJson from "../data/talentModifiers.json";

/**
 * Mapping of base spell IDs to talent-driven modifications, organized by class.
 *
 * This allows the parser to accurately construct cooldown availability and charge counts
 * by combining raw spell data with the player's talent string.
 */

export interface ICDModifier {
  talentSpellId: string;
  // `reduce_cd` is a flat-seconds subtraction; `reduce_cd_pct` is a percentage
  // multiplier (`value: 30` means -30%, applied as `base *= (1 - 30/100)`) —
  // see the sibling type in scripts/datagen/genTalentModifiers.ts for the
  // full derivation. Kept in sync manually (no shared import: one is the
  // generator's own type, this is the runtime consumer's).
  effect: "extra_charge" | "reduce_cd" | "reduce_cd_pct" | "replace_spell";
  value: number;
  isConditional?: boolean;
  /** DB2 SpellEffect.ID the generator read this from (identity for dedup;
   * not read at runtime). */
  sourceRowId?: string;
}

export const CD_TALENT_MODIFIERS: Record<string, ICDModifier[]> =
  talentModifiersJson as Record<string, ICDModifier[]>;
