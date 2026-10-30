import type { ICombatUnit } from "@gladlog/parser-compat";

import { getNpcIdFromGuid } from "../context/timelineHelpers";
import {
  type IWarlockPetFunction,
  WARLOCK_PET_CAST_FUNCTION,
  WARLOCK_PET_FUNCTION,
  WARLOCK_SPEC_IDS,
} from "../data/warlockPets";
import { firstDeathMs } from "./unitDeath";

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
      | "damageOut"
      | "damageIn"
      | "auraEvents"
      | "healIn"
      | "healOut"
      | "deathRecords"
    >
  >;

/**
 * EVERY permanent pet a warlock ran this round, in the order they first
 * appear in the log (triage 2026-09-29, pets-summons F-PS1): a mid-round swap
 * (Sayaad → Felhunter) put only the first pet unit on the roster, so the
 * model never learned a Spell Lock was on the table. `fromSeconds` is the
 * pet's first logged event of any kind (null when it only ever appears as a
 * destination of nothing we keep — such a pet is listed last and gets no
 * time). The log cannot observe a despawn (GH #86); a pet's death it does
 * (`diedSeconds`, D7 2026-10-24).
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
  const out: Array<{ fn: IWarlockPetFunction; fromSeconds: number | null }> =
    [];
  for (const p of warlockPetChronology(owner, units, matchStartMs)) {
    if (out.some((o) => o.fn.pet === p.fn.pet)) continue;
    out.push(p);
  }
  return out;
}

/**
 * Every permanent pet unit of this warlock in order of its first logged
 * event — one entry per pet UNIT, not per kind (codex 21-R12-b #3: a
 * Felhunter → Sayaad → Felhunter round lost the returning Felhunter in the
 * per-kind roster, and a Sayaad → Felhunter → Sayaad one read the Felhunter
 * out to the end). The availability timeline reads this; the roster
 * (`warlockPetFunctions`) keeps the first of each kind.
 */
export function warlockPetChronology(
  owner: Pick<ICombatUnit, "id" | "spec">,
  units: Iterable<PetUnit>,
  matchStartMs: number,
): Array<{
  fn: IWarlockPetFunction;
  fromSeconds: number | null;
  /** its UNIT_DIED, seconds since `matchStartMs` (D7: the pet's abilities
   * go with it); null when the log shows none */
  diedSeconds: number | null;
}> {
  if (!WARLOCK_SPEC_IDS.has(String(owner.spec))) return [];
  const pets: Array<{
    fn: IWarlockPetFunction;
    firstMs: number;
    diedMs: number;
  }> = [];
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
    pets.push({ fn, firstMs, diedMs: firstDeathMs(u) });
  }
  // (two silent pets: Infinity − Infinity is NaN, which is not an order)
  pets.sort((a, b) => (a.firstMs === b.firstMs ? 0 : a.firstMs - b.firstMs));
  return pets.map((p) => ({
    fn: p.fn,
    fromSeconds: Number.isFinite(p.firstMs)
      ? (p.firstMs - matchStartMs) / 1000
      : null,
    diedSeconds: Number.isFinite(p.diedMs)
      ? (p.diedMs - matchStartMs) / 1000
      : null,
  }));
}

/**
 * Did this warlock's logged pet(s) include one that purges — the Felhunter's
 * Devour Magic? Read with the roster's own predicate (`warlockPetFunctions`):
 * from the round's units when the caller has them, else from the pet units
 * the warlock's own `petSpellCastEvents` name (a pet that cast something).
 * `undefined` when no pet of theirs is logged at all (nothing says which pet
 * it was). fact1215 C10 (1120cb61): a Sayaad warlock with no Felhunter row in
 * the file was listed as a team purger.
 */
export function warlockRanPurgePet(
  owner: Pick<ICombatUnit, "id" | "spec"> &
    Partial<Pick<ICombatUnit, "petSpellCastEvents">>,
  units?: Iterable<PetUnit>,
): boolean | undefined {
  if (!WARLOCK_SPEC_IDS.has(String(owner.spec))) return undefined;
  let pool: Iterable<PetUnit> | undefined = units;
  if (pool === undefined) {
    const bySrc = new Map<string, PetUnit>();
    for (const c of owner.petSpellCastEvents ?? []) {
      if (!c.srcUnitId) continue;
      const u = bySrc.get(c.srcUnitId) ?? {
        id: c.srcUnitId,
        ownerId: owner.id,
        spellCastEvents: [],
      };
      u.spellCastEvents.push(c);
      bySrc.set(c.srcUnitId, u);
    }
    pool = bySrc.values();
  }
  const pets = warlockPetFunctions(owner, pool, 0);
  if (pets.length === 0) return undefined;
  return pets.some((p) => p.fn.pet === WARLOCK_PET_FUNCTION["417"]!.pet);
}

/**
 * When this warlock's purge pet (the Felhunter) was the one out, seconds
 * since `matchStartMs`: from its first logged event — the round's start when
 * it is the first pet — to the next pet's first event. A warlock runs one
 * permanent pet at a time, so a later pet's first appearance is the swap.
 * F16 retest (2026-10-21, idx 50): d2ebcb94 swapped the Felhunter for a
 * Sayaad at 0:17 of a 2:02 round and read "CAN offensive purge" for every
 * buff after it. `undefined` when `warlockRanPurgePet` has no answer (no pet
 * logged, a non-warlock); `[]` when the pets logged include no Felhunter.
 */
export function warlockPurgePetSpans(
  owner: Pick<ICombatUnit, "id" | "spec">,
  units: Iterable<PetUnit>,
  matchStartMs: number,
): Array<{ fromSeconds: number; toSeconds: number }> | undefined {
  const pets = warlockPetChronology(owner, units, matchStartMs);
  if (pets.length === 0) return undefined;
  const felhunter = WARLOCK_PET_FUNCTION["417"]!.pet;
  const out: Array<{ fromSeconds: number; toSeconds: number }> = [];
  pets.forEach((p, i) => {
    if (p.fn.pet !== felhunter) return;
    const from = i === 0 ? -Infinity : (p.fromSeconds ?? Infinity);
    const next = pets.slice(i + 1).find((q) => q.fromSeconds !== null);
    // D7 (user 2026-10-24): the Felhunter's purge ends with it — its
    // UNIT_DIED, when that comes before the next pet
    out.push({
      fromSeconds: from,
      toSeconds: Math.min(
        next?.fromSeconds ?? Infinity,
        p.diedSeconds ?? Infinity,
      ),
    });
  });
  return out;
}
