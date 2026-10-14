/**
 * Self-removals: a player's own button that clears harmful debuffs of a
 * dispel type from themselves — not a dispel (no other target, no
 * `CLEANSE_SPELLS_BY_TYPE` row), so `canRemoveFrom` / `ownerCanDispel` never
 * read it. Missed-cleanse states it as a separate fact (WO3 #11, r1008-41:
 * a Rogue rooted by Frost Nova was told it "has no such ability" with Cloak
 * of Shadows ready).
 *
 * Corpus split, 605 S2 files (eval-private runs/s61-reeval-2026-10-08/fix-FT
 * scripts/wo3_selfRemoval.py, 2026-10-14): of the SUCCESSes cast while the
 * caster had an enemy debuff of that type up, the share where EVERY such
 * debuff was removed within 50 ms before (the log writes the removal first)
 * to 100 ms after the SUCCESS. A type is listed only at >= 90 %; the rest
 * are left out on purpose:
 *   Cloak of Shadows 31224  Magic 337/374 (90 %), Curse 62/62;
 *                           Disease 40/60, Poison 17/63 — not listed
 *   Divine Shield 642       Magic 306/317, Curse 47/48, Bleed 95/95;
 *                           Disease 32/37, Poison 14/70 — not listed
 *   Ice Block 45438         Magic 262/274, Curse 46/46, Disease 49/53,
 *                           Bleed 181/182; Poison 13/71 — not listed
 * Mechanic-keyed removers (Will of the Forsaken, Escape Artist, the PvP
 * trinket) clear by control mechanic, not by dispel type — not here.
 * Registered in `curatedIdRegistry.ts`.
 */
export const SELF_REMOVAL_BY_TYPE: Readonly<Record<string, readonly string[]>> =
  {
    Magic: ["31224", "642", "45438"],
    Curse: ["31224", "642", "45438"],
    Disease: ["45438"],
    Bleed: ["642", "45438"],
  };

/** Every id in `SELF_REMOVAL_BY_TYPE`. */
export const SELF_REMOVAL_SPELL_IDS: ReadonlySet<string> = new Set(
  Object.values(SELF_REMOVAL_BY_TYPE).flat(),
);
