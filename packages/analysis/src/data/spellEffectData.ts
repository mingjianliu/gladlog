import { SPELL_EFFECT_OVERRIDES } from './spellEffectOverrides';

/*
 Interface and export for data mined from the WOW spells db itself
*/

export interface IMinedSpell {
  spellId: string;
  name: string;
  cooldownSeconds?: number;
  charges?: {
    charges?: number;
    chargeCooldownSeconds?: number;
  };
  durationSeconds?: number;
  /** Dispel type from SpellCategories.db2. null or undefined means the aura cannot be dispelled. */
  dispelType?: 'Magic' | 'Curse' | 'Disease' | 'Poison' | 'Bleed' | null;
}

export const spellEffectData = SPELL_EFFECT_OVERRIDES as Record<string, IMinedSpell>;

import rawSpellNames from './spellNames.json';

const spellNamesMap = rawSpellNames as unknown as Record<string, string>;

export function getEnglishSpellName(spellId: string, fallback?: string | null): string {
  return spellNamesMap[spellId] ?? spellEffectData[spellId]?.name ?? fallback ?? spellId;
}
