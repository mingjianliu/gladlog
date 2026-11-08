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
 * pet again once another of its pet units is first seen, or from its own
 * summon / revive cast after the end (`PET_SUMMON_SPELL_IDS`, GH #128). An end the log
 * does not show reads as no end — the pet is there, as every reader assumed
 * before (the direction that accuses nobody).
 */
import type { ICombatUnit } from "@gladlog/parser-compat";

import { firstDeathMs } from "./unitDeath";

/** Dismiss Pet: the owner's own cast; the log writes nothing on the pet. */
export const DISMISS_PET_SPELL_ID = "2641";

/**
 * The owner's casts that put a permanent pet out: DB2 SpellEffect Effect 56
 * (SUMMON_PET) and 109 (RESURRECT_PET), every such id observed in the corpus
 * (build 12.1.5.70688, GH #128 2026-11-05). A pet that comes back is out from
 * this cast on — its first row of its own can come long after (c5b55e06 r2:
 * Revive Pet at 1:16, the new pet's first own row 15 s later).
 */
export const PET_SUMMON_SPELL_IDS: ReadonlySet<string> = new Set([
  "883", // Call Pet 1
  "83242", // Call Pet 2
  "83243", // Call Pet 3
  "83244", // Call Pet 4
  "83245", // Call Pet 5
  "982", // Revive Pet (Effect 109)
  "688", // Summon Imp
  "691", // Summon Felhunter
  "697", // Summon Voidwalker
  "366222", // Summon Sayaad
  "30146", // Summon Felguard
  "52150", // Raise Dead (the permanent ghoul)
  "31687", // Summon Water Elemental
]);

/**
 * A player's press that the PET carries out — gone with the pet (D7, GH #128
 * item 1). DB2 marks none of them (dummy / scripted effects), so the evidence
 * is the corpus: 605 new-season files + 480 downloaded 12.1.5 logs, 3,562
 * presses of these three, 0 while the presser's own pet was gone (dead — a
 * Play Dead `UNIT_DIED` carries the unconscious flag and is no death — and not
 * yet summoned, revived or seen again). Marksmanship's Intimidation 474421 is
 * not one: the spec has no permanent pet to read.
 */
export const PET_COMMAND_SPELL_IDS: ReadonlySet<string> = new Set([
  "272682", // Master's Call (the pet casts 54216)
  "53480", // Roar of Sacrifice
  "19577", // Intimidation
]);

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

type PresenceRow = { timestamp: number; logLine?: { lineIndex?: number } };

/** Log order of two rows: timestamp, then `lineIndex` inside one
 * millisecond; same millisecond with an unknown line on either side = 0 (no
 * order). */
function logOrder(a: PresenceRow, b: PresenceRow): number {
  if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
  const la = a.logLine?.lineIndex;
  const lb = b.logLine?.lineIndex;
  return la === undefined || lb === undefined ? 0 : la - lb;
}

/**
 * The pet's latest row at or before `atMs` that shows it out — a cast, an
 * aura row other than a removal (a removal is what a dismissal writes), its
 * own damage done or taken, a position sample — in log order. The one
 * presence reading of `petReplacedBySummonAt` and of which of an owner's
 * pets is out (`interruptCasterAt`, codex 85-tk-C-T26-3 / -3b). Undefined =
 * none yet.
 */
export function petLastPresenceRow(
  pet: PetLike,
  atMs: number,
): PresenceRow | undefined {
  let last: PresenceRow | undefined;
  const take = (r: PresenceRow) => {
    if (r.timestamp > atMs) return;
    if (!last || logOrder(r, last) > 0) last = r;
  };
  for (const r of pet.spellCastEvents ?? []) take(r);
  for (const r of pet.auraEvents ?? [])
    if (r.logLine?.event !== "SPELL_AURA_REMOVED") take(r);
  for (const r of pet.damageOut ?? []) take(r);
  for (const r of pet.damageIn ?? []) take(r);
  for (const r of pet.advancedActions ?? []) take(r);
  return last;
}

/**
 * Was `pet` sent away by its owner's later summon by `atMs` — the owner's
 * latest pet summon at or before `atMs` (`PET_SUMMON_SPELL_IDS`, a
 * SPELL_CAST_SUCCESS) with no row showing the pet out AFTER it, in log
 * order, up to `atMs` (`petLastPresenceRow`)? One permanent pet is out at a
 * time: Summon Imp sends the Felhunter away (codex review of batch B10, T26:
 * a Felhunter last seen 0.3 s before an Imp was summoned still threw the
 * Spell Lock of a heal 0.2 s after it). A row of the summon's own
 * millisecond is after it only when its line is (`lineIndex`; unknown order
 * is not after) (codex 85-tk-C-T26-3). A pet the same summon brings back
 * under the same unit reads as sent away until it shows — no kick is
 * credited to it.
 */
export function petReplacedBySummonAt(
  owner: Partial<Pick<ICombatUnit, "spellCastEvents">>,
  pet: PetLike,
  atMs: number,
): boolean {
  let summon: PresenceRow | undefined;
  for (const c of owner.spellCastEvents ?? [])
    if (
      PET_SUMMON_SPELL_IDS.has(c.spellId) &&
      c.logLine.event === "SPELL_CAST_SUCCESS" &&
      c.timestamp <= atMs &&
      (!summon || logOrder(c, summon) >= 0)
    )
      summon = c;
  if (!summon) return false;
  const last = petLastPresenceRow(pet, atMs);
  return !last || logOrder(last, summon) <= 0;
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
  owner: Pick<ICombatUnit, "id"> &
    Partial<Pick<ICombatUnit, "spellCastEvents">>,
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
  // the latest end by `atMs`; a summon / revive cast after it puts a pet out
  const lastEndMs = Math.max(
    dismissedMs,
    ...pets.filter((p) => p.died <= atMs).map((p) => p.died),
  );
  if (
    (owner.spellCastEvents ?? []).some(
      (c) =>
        PET_SUMMON_SPELL_IDS.has(c.spellId) &&
        c.timestamp > lastEndMs &&
        c.timestamp <= atMs,
    )
  )
    return false;
  return !pets.some(
    (p) => p.seen <= atMs && p.died > atMs && p.seen > dismissedMs,
  );
}
