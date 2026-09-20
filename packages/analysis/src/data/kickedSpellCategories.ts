/**
 * Classification of interrupted spells into functional categories (GH #79, BACKLOG #36(f) / B4).
 *
 * In PvP combat logs, SPELL_INTERRUPT records `extraSpellId` (what was stopped).
 * Historically, 63.7% of kicked spells were "unlisted" because SPELL_CATEGORIES
 * only tracked CC/roots/immunities/burst buffs, leaving ordinary hardcast heals
 * (Flash Heal, Healing Wave) and damage nukes (Chaos Bolt, Glacial Spike) untyped.
 *
 * This classifier layers:
 * 1. Curated overrides for multi-effect spells, aura variants, and pets
 * 2. Official DB2 abilityProfile (healsSelf/healsOthers/absorbs vs dealsDamage/hitsEnemy)
 * 3. SPELL_CATEGORIES + ccSpellIds for crowd control
 *
 * Single-source predicate: all kick-analysis, coach probes, and timeline annotations
 * query this function to know what a kick prevented.
 */
import { abilityProfile } from "./abilityProfile";
import { HARDCAST_HEAL_SPELL_IDS } from "./kickPriorityHealSpells";
import { SPELL_CATEGORIES } from "./spellCategories";
import { ccSpellIds } from "./spellTags";

export type KickedSpellCategory =
  | "heal"
  | "control"
  | "damage"
  | "other"
  | "unknown";

/** Hand-curated overrides for spells where DB2 metadata is empty (dummy effect)
 *  or triggers an auxiliary aura rather than direct healing/damage/control. */
export const KICKED_HEAL_OVERRIDE_IDS = new Set<string>([
  ...HARDCAST_HEAL_SPELL_IDS,
  "115175", // Soothing Mist (Monk channeling heal)
  "421453", // Ultimate Penitence (Disc Priest channel)
  "431443", // Chrono Flames (Evoker Living Flame variant)
]);

export const KICKED_CONTROL_OVERRIDE_IDS = new Set<string>([
  "113724", // Ring of Frost (Mage ground effect active id)
  "198898", // Song of Chi-Ji (Mistweaver sleep CC)
  "410126", // Searing Glare (Holy Paladin miss/blind CC)
  "352278", // Ice Wall (Frost Mage obstruction/LoS)
]);

export const KICKED_DAMAGE_OVERRIDE_IDS = new Set<string>([
  "191634", // Stormkeeper (Elemental Shaman burst cast)
  "228260", // Voidform (Shadow Priest burst cast)
  "265187", // Summon Demonic Tyrant (Warlock burst cast)
]);

export const KICKED_OTHER_OVERRIDE_IDS = new Set<string>([
  "32375", // Mass Dispel (Priest AoE magic dispel)
]);

export function classifyKickedSpell(spellId: string): KickedSpellCategory {
  if (KICKED_HEAL_OVERRIDE_IDS.has(spellId)) return "heal";
  if (KICKED_CONTROL_OVERRIDE_IDS.has(spellId)) return "control";
  if (KICKED_DAMAGE_OVERRIDE_IDS.has(spellId)) return "damage";
  if (KICKED_OTHER_OVERRIDE_IDS.has(spellId)) return "other";

  const cat = SPELL_CATEGORIES[spellId]?.type;
  if (cat === "cc" || cat === "roots" || ccSpellIds.has(spellId)) {
    return "control";
  }

  const prof = abilityProfile(spellId);
  if (prof.healsSelf || prof.healsOthers || prof.absorbs) {
    return "heal";
  }
  if (
    prof.dealsDamage ||
    prof.hitsEnemy ||
    cat === "buffs_offensive" ||
    cat === "debuffs_offensive"
  ) {
    return "damage";
  }

  return "unknown";
}
