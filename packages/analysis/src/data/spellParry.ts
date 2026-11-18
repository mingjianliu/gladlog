/**
 * Can a parry stop this attack — the one reader of `spellParryGenerated.ts`
 * (DB2 DefenseType, No Active Defense, missile speed; the evidence is in
 * `scripts/datagen/genSpellParry.ts`). Reach cannot answer it: Final Verdict
 * reaches 12 yd and is parried, Touch of Death reaches 5 yd and is not.
 *
 * Regenerate: `DATAGEN_BUILD=<build> DATAGEN_CACHE=~/.cache/gladlog-datagen
 * npx tsx packages/analysis/scripts/datagen/genSpellParry.ts`
 * (docs/commands/update-wow-data.md).
 */
import {
  PARRYABLE_SPELL_IDS,
  UNPARRYABLE_SPELL_IDS,
} from "./spellParryGenerated";
import { MELEE_RANGE_YD, spellRangeYards } from "./spellReach";

/**
 * Hand exceptions to DB2's parry reading: spells no parry stops although the
 * generated tables — or, for an id in neither, the reach fallback — could
 * read them as parryable. Checked before the tables, on the press and on the
 * landing row.
 *
 * Divine Hammer, every live id of the name: the hammers orbit the paladin and
 * hit whoever stands in them, facing or not. Its hit row 198137 is DefenseType
 * 2, No Active Defense clear, Speed 0 — parryable by the rule. User ruling
 * 2026-11-17 (wave-4 A10) on the corpus count (scan5 `t77`
 * `divineHammerParry`, 605 archives): 2,330 damage / miss rows of it, 0 PARRY
 * (and 0 DODGE); its 257 miss rows are 234 ABSORB + 23 IMMUNE. The scan stays
 * in the wave-end run: one PARRY row of it is the evidence to take the entry
 * out.
 *
 * Registered in `curatedIdRegistry.ts` (reverse pass: a renumbered id here
 * would silently hand the spell back to DB2's reading).
 */
export const HAND_UNPARRYABLE_SPELL_IDS: ReadonlySet<string> = new Set([
  "1236942", // Divine Hammer, the press and its aura (in neither DB2 table)
  "198137", // Divine Hammer, its hits and 2 s pulses (DB2: parryable)
  "198034", // Divine Hammer, the older aura id (DB2: magic already)
]);

/**
 * Whether a parry can stop a press: an id of `HAND_UNPARRYABLE_SPELL_IDS`
 * says no before DB2 is asked; then either id parryable says yes (Kill
 * Command's press 34026 says nothing, its pet's row 83381 is melee; Frost
 * Strike's press 49143 is melee and the log parries that id, its row 325464
 * reads magic), then either id unparryable says no (Penance's press 47540 says
 * nothing, its row 47666 is magic). An id in neither table (DefenseType 0, no
 * row, outside the observed universe) falls to the press's reach, and an
 * unknown reach reads as melee.
 */
export function parryStopsAttack(
  pressSpellId: string,
  landingSpellId?: string | null,
): boolean {
  const ids = [landingSpellId, pressSpellId].filter((id) => !!id) as string[];
  if (ids.some((id) => HAND_UNPARRYABLE_SPELL_IDS.has(id))) return false;
  if (ids.some((id) => PARRYABLE_SPELL_IDS.has(id))) return true;
  if (ids.some((id) => UNPARRYABLE_SPELL_IDS.has(id))) return false;
  const reach = spellRangeYards(pressSpellId);
  return reach === null || reach <= MELEE_RANGE_YD;
}
