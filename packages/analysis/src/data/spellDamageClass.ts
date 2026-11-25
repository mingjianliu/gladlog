/**
 * Is this hit a weapon-class attack — the one reader of
 * `spellDamageClassGenerated.ts` (DB2 SpellCategories.DefenseType 2 Melee /
 * 3 Ranged, observed universe; `scripts/datagen/genSpellDamageClass.ts`).
 *
 * The class is what a proc's "taken melee / ranged" flags read
 * (SpellAuraOptions.ProcTypeMask 0x8 taken melee auto attack, 0x20 taken
 * melee-class spell, 0x80 taken ranged auto attack, 0x200 taken ranged-class
 * spell), and it is not the school: Final Verdict, Judgment and Blade of
 * Justice are Holy and class 2, Scourge Strike's second row is Shadow and
 * class 2, Flurry Strikes is Physical and class 1.
 *
 * Regenerate: `DATAGEN_BUILD=<build> DATAGEN_CACHE=~/.cache/gladlog-datagen
 * npx tsx packages/analysis/scripts/datagen/genSpellDamageClass.ts`
 * (docs/commands/update-wow-data.md).
 */
import {
  MELEE_CLASS_SPELL_IDS,
  RANGED_CLASS_SPELL_IDS,
} from "./spellDamageClassGenerated";

/**
 * A row of a melee or ranged attack: a swing row (`SWING_*`, the auto attack,
 * which carries no spell id), or a spell row whose id DB2 classes Melee or
 * Ranged (Auto Shot 75 is a `RANGE_*` row of class 3). An id DB2 says nothing
 * about (DefenseType 0, no row, outside the observed universe) is not one.
 */
export function isWeaponClassAttackRow(
  logEvent: string,
  spellId: string | null | undefined,
): boolean {
  if (logEvent.startsWith("SWING_")) return true;
  if (!spellId) return false;
  return (
    MELEE_CLASS_SPELL_IDS.has(spellId) || RANGED_CLASS_SPELL_IDS.has(spellId)
  );
}
