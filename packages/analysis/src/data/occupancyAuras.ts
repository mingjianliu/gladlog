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

/**
 * An Evoker's own flying breath — the unit cannot cast while the self-aura is
 * up (user ruling 2026-10-14, "深呼吸算是不能施法", work order 2026-10-14b
 * Part 2 n43: b12bfef4's Deep Breath flight read as free time, ownerFreeS 3.9
 * against 3.6). Read by `utils/cannotCastIntervals.ts namedCannotCastIntervals`
 * as the unit's own cannot-cast interval, the same as a stun.
 *
 * Ids from the 605-file capture (eval-private fix-FT/scripts/p2_breath_ids.py):
 * self-auras (source = holder) 357210 Deep Breath 146 (median 1.89 s, max
 * 3.40 s), 433874 Deep Breath 244 (median 2.28 s, max 3.79 s), 403631 Breath
 * of Eons 6 (median 2.16 s, Augmentation's flight — same mechanic, added with
 * the ruling's wording). The other ids of those names never sit on their
 * caster (1236943: casts only; 353759: on others).
 *
 * Not absolute in the log: of 357210's 146 flights, 83 presses were refused
 * "You can't do that right now." and 13 other casts went out mid-flight
 * (Dream Breath 7, Verdant Embrace 3, Echo 2, Twin Flame 1). The ruling
 * reads the flight as a lock regardless.
 */
export const OWN_FLIGHT_AURA_IDS: ReadonlySet<string> = new Set([
  "357210", // Deep Breath
  "433874", // Deep Breath
  "403631", // Breath of Eons
]);
