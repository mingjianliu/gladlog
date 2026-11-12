/**
 * DR (diminishing returns) category table.
 * Made official 2026-07-25: the five main categories (stun / incapacitate /
 * disorient / silence / root) are now generated from DB2
 * SpellCategories.DiminishType (drCategoriesGenerated, genDrCategories), keyed
 * by **aura id** to match the combat log's SPELL_AURA_APPLIED. During the
 * migration the official data caught 2 misclassifications in the hand-written
 * table (Mind Control 605 incap→disorient, Scatter Shot 213691
 * disorient→incap) plus 5 dead entries keyed by cast ids that never matched a
 * log line (which is why Shockwave 46968's stun DR had never worked — its real
 * aura 132168, x512 across 30 matches, is in the official set).
 * disarm joined them 2026-11-11 (DiminishType 128, pipeline T68: the hand
 * list lacked Faerie Swarm 209749 and Sticky Tar Bomb 407032, which
 * SPELL_CATEGORIES already called disarms). knockback has no official
 * DiminishType field (a gap), so it stays hand-written.
 * DB2's known quirks (Cyclone's independent DR, Incapacitating Roar actually
 * being disorient) are corrected afterwards by drAnalysis' override layer —
 * do not patch them here.
 */
import { DR_CATEGORIES_GENERATED } from "./drCategoriesGenerated";

const cat = (ids: string[]): { spellId: string }[] =>
  ids.map((spellId) => ({ spellId }));

export const spellClassMap = {
  diminishingReturns: {
    ...Object.fromEntries(
      Object.entries(DR_CATEGORIES_GENERATED).map(([c, ids]) => [c, cat(ids)]),
    ),
    // disarm comes from DB2 too since pipeline T68 (DiminishType 128 —
    // Faerie Swarm 209749 and Sticky Tar Bomb 407032 carry it; the hand
    // list here had only Disarm / Dismantle / Grapple Weapon)
    knockback: cat(["51490", "132469", "108199"]),
  },
};
