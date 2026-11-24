/**
 * Real control auras a user ruling left OUT of the controls — known items
 * the forward scans (scan5/t125 `lossOfControlAuraNoCcLine`, scan5/t177
 * `controlAuraNoCcLine`) list out of their totals, so a later scan does not
 * raise them as new:
 *  - Earthquake 77505 and Fel Cleave 213688 (R48, 2026-11-15);
 *  - Intimidation 1258508 (user ruling R76, 2026-11-19, T177): a hunter pet's
 *    stun, DB2 build 12.1.5.70391 SpellCategories `Mechanic 12,
 *    DiminishType 0` (no DR family; the 3 s stun 24394 has DiminishType 4),
 *    one effect `EffectAura 12`, 0.5 s; 605: 1 fact, removed after 0.45 s.
 *
 * Read by the scans only: the product's control set (`ccSpellIds`) simply
 * does not hold these ids. Registered in `curatedIdRegistry.ts` (pipeline
 * T225; codex 80-PIPE-175-B161).
 */
export const CONTROL_RULED_OUT_AURA_IDS: ReadonlySet<string> = new Set([
  "77505",
  "213688",
  "1258508",
]);
