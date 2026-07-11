import talentModifiersJson from '../data/talentModifiers.json';

/**
 * Mapping of base spell IDs to talent-driven modifications, organized by class.
 *
 * This allows the parser to accurately construct cooldown availability and charge counts
 * by combining raw spell data with the player's talent string.
 */

export interface ICDModifier {
  talentSpellId: string;
  effect: 'extra_charge' | 'reduce_cd' | 'replace_spell';
  value: number;
  isConditional?: boolean;
}

export const CD_TALENT_MODIFIERS: Record<string, ICDModifier[]> = talentModifiersJson as Record<string, ICDModifier[]>;
