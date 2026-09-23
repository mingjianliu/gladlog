import type { ICombatUnit } from "@gladlog/parser-compat";

import { getNpcIdFromGuid } from "../context/timelineHelpers";
import {
  type IWarlockPetFunction,
  WARLOCK_PET_CAST_FUNCTION,
  WARLOCK_PET_FUNCTION,
  WARLOCK_SPEC_IDS,
} from "../data/warlockPets";

/**
 * Which pet a warlock ran this round, and what it does — the single predicate
 * behind the roster's `[pet: …]` tag (GH #86, 2026-09-22). Reads the pet
 * unit's npcId first (permanent pets have no in-round SPELL_SUMMON), then the
 * pet's own casts. `null` for a non-warlock, or when no pet unit of theirs
 * shows up in the log at all.
 */
export function warlockPetFunction(
  owner: Pick<ICombatUnit, "id" | "spec">,
  units: Iterable<Pick<ICombatUnit, "id" | "ownerId" | "spellCastEvents">>,
): IWarlockPetFunction | null {
  if (!WARLOCK_SPEC_IDS.has(String(owner.spec))) return null;
  for (const u of units) {
    if (u.ownerId !== owner.id) continue;
    const npcId = getNpcIdFromGuid(u.id);
    if (npcId && WARLOCK_PET_FUNCTION[npcId])
      return WARLOCK_PET_FUNCTION[npcId]!;
    for (const c of u.spellCastEvents ?? []) {
      const key = WARLOCK_PET_CAST_FUNCTION[String(c.spellId)];
      if (key) return WARLOCK_PET_FUNCTION[key]!;
    }
  }
  return null;
}
