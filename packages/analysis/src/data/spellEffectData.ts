import { SPELL_EFFECT_OVERRIDES } from "./spellEffectOverrides";
import { SPELL_EFFECTS_GENERATED } from "./spellEffectGenerated";

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
  dispelType?: "Magic" | "Curse" | "Disease" | "Poison" | "Bleed" | null;
}

// 双层:生成基础层(DB2 原值)+ 策展覆盖层优先(PvP 修正等人工校准值恒赢)
export const spellEffectData = {
  ...SPELL_EFFECTS_GENERATED,
  ...SPELL_EFFECT_OVERRIDES,
} as Record<string, IMinedSpell>;

import rawSpellNames from "./spellNames.json";

const spellNamesMap = rawSpellNames as unknown as Record<string, string>;

export function getEnglishSpellName(
  spellId: string,
  fallback?: string | null,
): string {
  return (
    spellNamesMap[spellId] ??
    spellEffectData[spellId]?.name ??
    fallback ??
    spellId
  );
}
