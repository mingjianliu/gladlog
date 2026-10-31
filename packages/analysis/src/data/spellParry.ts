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
 * Whether a parry can stop a press: either id parryable says yes (Kill
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
  if (ids.some((id) => PARRYABLE_SPELL_IDS.has(id))) return true;
  if (ids.some((id) => UNPARRYABLE_SPELL_IDS.has(id))) return false;
  const reach = spellRangeYards(pressSpellId);
  return reach === null || reach <= MELEE_RANGE_YD;
}
