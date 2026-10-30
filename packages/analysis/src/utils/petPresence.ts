/**
 * D7 (user 2026-10-24, 「全按建议」): when a player's permanent pet is gone —
 * and with it every ability the pet casts (Spell Lock, Axe Toss, Devour
 * Magic …). What the raw log offers (FT leftovers, five new-season files,
 * 142 `Pet-` GUIDs; predicate-index "when a pet is gone"):
 *  - a permanent pet's death IS logged: `UNIT_DIED` on the pet's GUID
 *    (`deathRecords`);
 *  - a pet that comes back is a NEW GUID — the owner's summon names it —
 *    so "back" is another pet unit of the owner first seen after the death,
 *    never the old GUID acting again (its running periodic effects keep
 *    logging rows after its `UNIT_DIED`);
 *  - Dismiss Pet (2641) is a cast row of the owner with no row on the pet;
 *    a pet despawned any other way writes nothing.
 * So: a pet's end is its death or its owner's Dismiss Pet; the owner has a
 * pet again once another of its pet units is first seen. An end the log
 * does not show reads as no end — the pet is there, as every reader assumed
 * before (the direction that accuses nobody).
 */
import type { ICombatUnit } from "@gladlog/parser-compat";

import { firstDeathMs } from "./unitDeath";

/** Dismiss Pet: the owner's own cast; the log writes nothing on the pet. */
export const DISMISS_PET_SPELL_ID = "2641";

type PetLike = Pick<ICombatUnit, "id" | "ownerId"> &
  Partial<
    Pick<
      ICombatUnit,
      | "deathRecords"
      | "spellCastEvents"
      | "auraEvents"
      | "damageOut"
      | "damageIn"
      | "advancedActions"
    >
  >;

/** The first instant the log shows `pet` at all, epoch ms. */
function firstSeenMs(pet: PetLike): number {
  let first = Infinity;
  for (const stream of [
    pet.spellCastEvents,
    pet.auraEvents,
    pet.damageOut,
    pet.damageIn,
    pet.advancedActions,
  ] as ReadonlyArray<ReadonlyArray<{ timestamp: number }> | undefined>)
    for (const e of stream ?? []) if (e.timestamp < first) first = e.timestamp;
  return first;
}

/**
 * Is `owner`'s permanent pet gone at `atMs` — the log shows an end (a pet's
 * death, or the owner's Dismiss Pet) by then, and no pet of theirs is out:
 * seen by `atMs`, not dead by it, and seen after the last Dismiss Pet. Two
 * pets at once (Animal Companion) keep the owner's pet abilities while one
 * lives. false when the owner has no `Pet-` unit in the round, or the log
 * shows no end (unknown is "there").
 */
export function ownerPetGoneAt(
  owner: Pick<ICombatUnit, "id"> & Partial<Pick<ICombatUnit, "spellCastEvents">>,
  units: Iterable<PetLike>,
  atMs: number,
): boolean {
  const pets = [...units]
    .filter((u) => u.ownerId === owner.id && String(u.id).startsWith("Pet-"))
    .map((u) => ({ u, seen: firstSeenMs(u), died: firstDeathMs(u) }))
    .filter((p) => Number.isFinite(p.seen));
  if (pets.length === 0) return false;
  let dismissedMs = -Infinity;
  for (const c of owner.spellCastEvents ?? [])
    if (
      c.spellId === DISMISS_PET_SPELL_ID &&
      c.timestamp <= atMs &&
      c.timestamp > dismissedMs
    )
      dismissedMs = c.timestamp;
  const ended =
    Number.isFinite(dismissedMs) || pets.some((p) => p.died <= atMs);
  if (!ended) return false;
  return !pets.some(
    (p) => p.seen <= atMs && p.died > atMs && p.seen > dismissedMs,
  );
}
