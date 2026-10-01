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

/** What one pet unit does: its npcId first, then its own signature casts. */
function petFunctionOf(
  u: Pick<ICombatUnit, "id" | "spellCastEvents">,
): IWarlockPetFunction | null {
  const npcId = getNpcIdFromGuid(u.id);
  if (npcId && WARLOCK_PET_FUNCTION[npcId]) return WARLOCK_PET_FUNCTION[npcId]!;
  for (const c of u.spellCastEvents ?? []) {
    const key = WARLOCK_PET_CAST_FUNCTION[String(c.spellId)];
    if (key) return WARLOCK_PET_FUNCTION[key]!;
  }
  return null;
}

type PetUnit = Pick<ICombatUnit, "id" | "ownerId" | "spellCastEvents"> &
  Partial<
    Pick<
      ICombatUnit,
      "damageOut" | "damageIn" | "auraEvents" | "healIn" | "healOut"
    >
  >;

/**
 * EVERY permanent pet a warlock ran this round, in the order they first
 * appear in the log (triage 2026-09-29, pets-summons F-PS1): a mid-round swap
 * (Sayaad → Felhunter) put only the first pet unit on the roster, so the
 * model never learned a Spell Lock was on the table. `fromSeconds` is the
 * pet's first logged event of any kind (null when it only ever appears as a
 * destination of nothing we keep — such a pet is listed last and gets no
 * time). No end time: the log cannot observe a despawn (GH #86).
 *
 * Permanent pets only (`Pet-` GUIDs): Demonology's temporary `Creature-`
 * summons share npc ids with real pets and would put a false "Imp" /
 * "Felhunter" on the roster. One entry per pet kind.
 */
export function warlockPetFunctions(
  owner: Pick<ICombatUnit, "id" | "spec">,
  units: Iterable<PetUnit>,
  matchStartMs: number,
): Array<{ fn: IWarlockPetFunction; fromSeconds: number | null }> {
  if (!WARLOCK_SPEC_IDS.has(String(owner.spec))) return [];
  const pets: Array<{ fn: IWarlockPetFunction; firstMs: number }> = [];
  for (const u of units) {
    if (u.ownerId !== owner.id || !String(u.id).startsWith("Pet-")) continue;
    const fn = petFunctionOf(u);
    if (!fn) continue;
    let firstMs = Infinity;
    for (const stream of [
      u.spellCastEvents,
      u.damageOut,
      u.damageIn,
      u.auraEvents,
      u.healIn,
      u.healOut,
    ])
      for (const e of stream ?? []) {
        const t = e.logLine?.timestamp ?? e.timestamp;
        if (typeof t === "number" && t < firstMs) firstMs = t;
      }
    pets.push({ fn, firstMs });
  }
  // (two silent pets: Infinity − Infinity is NaN, which is not an order)
  pets.sort((a, b) => (a.firstMs === b.firstMs ? 0 : a.firstMs - b.firstMs));
  const out: Array<{ fn: IWarlockPetFunction; fromSeconds: number | null }> =
    [];
  for (const p of pets) {
    if (out.some((o) => o.fn.pet === p.fn.pet)) continue;
    out.push({
      fn: p.fn,
      fromSeconds: Number.isFinite(p.firstMs)
        ? (p.firstMs - matchStartMs) / 1000
        : null,
    });
  }
  return out;
}
