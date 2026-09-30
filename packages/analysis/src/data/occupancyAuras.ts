/**
 * Hand sets for "was this player busy" when the log shows it only as a
 * self-aura (triage 2026-09-29 missed-cleanse F-C11, user ruling A43 = B,
 * 2026-09-30: a teammate dispeller inside a channelled major or drinking was
 * occupied, like the owner's own hard casts). Read by
 * `utils/dispelAnalysis.ts occupancyWithin` as the caster's own aura
 * interval. Registered in `curatedIdRegistry.ts`.
 */

/**
 * Channels the log shows only as the caster's self-aura. Ultimate Penitence:
 * the logged 421453 has no Is Channelled bit in SpellMisc (Attributes_1 =
 * 0x8000, 12.1.0.69587 / 12.1.5.69952), a cast bar (CastingTimeIndex 16) and
 * a 6.5 s self-aura (DurationIndex 589; observed 6.509 s, ae9d6fbc); the
 * channelled sibling 421434 is never logged (0 rows; not observed). So the
 * channel is visible only as 421453's aura.
 */
export const CHANNEL_PROXY_IDS: ReadonlySet<string> = new Set([
  "421453", // Ultimate Penitence (Discipline Priest)
]);

/**
 * Drinking. Forward scan over the 60 triage picks (self SPELL_PERIODIC_ENERGIZE
 * auras and aura names, 2026-09-30): 1291791 "Drink" / "饮水" is the only
 * drink id (ae9d6fbc, 138e632d).
 */
export const DRINK_AURA_IDS: ReadonlySet<string> = new Set([
  "1291791", // Drink
]);
