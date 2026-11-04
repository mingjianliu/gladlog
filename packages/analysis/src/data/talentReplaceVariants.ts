/**
 * fact9 D27 (a7e95468 r0 0:42): a talent that replaces a cooldown's button
 * with another id drawing on the same cooldown — DB2 talent modifier
 * `replace_spell` (`talentModifiers.json`), not an aura-332 override, so
 * `OVERRIDE_VARIANTS_GENERATED` does not have it. Variant → the replaced id.
 *
 * Concentrated Coolness 198148 (Frost PvP talent) makes Frozen Orb 198149:
 * same name, 60 s on both (`spellEffectGenerated`). Round-9 audit's raw
 * logs, the two Frost Mages who press either: 11 of 11 rounds whose
 * COMBATANT_INFO carries 198148 press 198149 only, every round without it
 * presses 84714 only. A 198149 press was no Frozen Orb anywhere — no
 * [ENEMY CD] line, no kit row.
 *
 * Only this pair (user ruling 2026-11-03 scope): the other replace_spell
 * rows with the same name and cooldown are open in GitHub, each to check on
 * its own. Read by `SPELL_CANONICAL_IDS` (cooldowns.ts: a press of the
 * cooldown) and `offensiveEffectCdId` (spellDanger.ts: its effect).
 * Registered in `curatedIdRegistry.ts`.
 */
export const TALENT_REPLACE_VARIANT_IDS: Readonly<Record<string, string>> = {
  "198149": "84714", // Frozen Orb ← Concentrated Coolness
  // fact10 D2–D4 (user ruling 2026-11-04): an aura-332 override the
  // generator cannot pair — Maneuverability 442255 (Scalecommander) puts
  // 442204 on the Breath of Eons 403631 button, but each id has its own
  // 120 s SpellCooldowns row and no shared Category, the generator's
  // same-cooldown test. One button, one cooldown: the fact10 library and
  // the cover set have 3 Augmentations pressing 442204, none pressing both.
  "442204": "403631", // Breath of Eons ← Maneuverability
};
