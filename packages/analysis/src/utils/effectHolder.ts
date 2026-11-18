import { CombatUnitType, type ICombatUnit } from "@gladlog/parser-compat";

/**
 * Is a copy of an effect on `unit` the effect on a holder? A player's is; a
 * pet's, a guardian's or a totem's copy is not. One reading, three readers:
 * - `observedEffectEndSeconds` (FT F13: The Hunt's DoT left its player
 *   target at 83.9 s and sat on a Jade Serpent Statue until 85.1 s, and a
 *   kick at 84.7 s read `ourBurst=The Hunt`);
 * - `pressEffectCutShort`'s one-holder count (user ruling R67, 2026-11-18:
 *   a pet or guardian copy does not count as a holder);
 * - `casterAuraOutlives`, the death / round-end cut (pipeline T158: batch
 *   check T158-1 kept `Predator's Wake(1s left)` in `[RES]` after a death in
 *   two rounds where The Hunt was still up on hunter pets, imps and a statue
 *   only).
 */
export function isEffectHolderUnit(unit: Pick<ICombatUnit, "type">): boolean {
  return unit.type === CombatUnitType.Player;
}
