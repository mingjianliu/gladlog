import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { BACKLASH_AURA_CC_TYPE } from "../data/backlashCc";
import { OWN_FLIGHT_AURA_IDS } from "../data/occupancyAuras";
import {
  isCastBlockingAuraType,
  SPELL_CATEGORIES as SPELLS,
} from "../data/spellCategories";
import {
  ccFullDurationSeconds,
  getEnglishSpellName,
} from "../data/spellEffectData";
import { schoolLockedBy, spellSchoolMask } from "../data/spellSchools";
import {
  ccSpellIds,
  disarmSpellIds,
  officialSilenceIds,
} from "../data/spellTags";
import { dropAuraRebroadcasts, supersededAuraBreaks } from "./auraIntervals";
import { buffFullDurationForCaster } from "./buffDuration";
import { castingLockIntervalsOf } from "./castingLocks";
import { charmedAt } from "./charmedPlayer";
import { REACTION_WINDOW_S, usableWhileStunned } from "./cooldowns";
import {
  getDRCategory,
  isStunDrAura,
  matchPendingCcKey,
  reAppliedIsSameApplication,
} from "./drAnalysis";
import { kickLockoutSecondsFor } from "./kickLockout";
import {
  isSilenceableCast,
  isUnsilenceableCast,
  isWeaponRequiredCast,
} from "./spellMechanics";
import { firstDeathMs } from "./unitDeath";

/**
 * "When could this unit not cast?" — ONE predicate for the two consumers that
 * used to answer it separately (BACKLOG #38 (e), unified 2026-09-02):
 *
 *   - `dispelAnalysis.ts` → the "dispeller was locked out" exemption on
 *     missed-cleanse / missed-purge (gate b+c; this function was born there);
 *   - `healingGaps.ts` → the free-cast seconds of a healing gap ("he COULD
 *     have cast"), which until 2026-09-02 subtracted hard CC + silence auras
 *     but NOT kick lockouts — a pure interrupt (Pummel / Kick / Counterspell)
 *     logs no SPELL_AURA_APPLIED, so the 3–6 s the healer could not cast the
 *     locked school counted as "free" and a Holy Paladin (36 % of kicks
 *     followed by 5 s of nothing, corpus #36 (b)) was charged with a healing
 *     gap he was locked out of.
 *
 * Two sources, both enemy-inflicted:
 *   1. cast-blocking auras (hard CC + silence; `isCastBlockingAuraType`)
 *      from APPLIED to the first REMOVED/BROKEN after it in log order
 *      (open-ended when never removed);
 *   2. school lockouts from SPELL_INTERRUPT (`kickLockoutSeconds`, the
 *      corpus-observed table — GH #62). In SPELL_INTERRUPT `spellId` IS the
 *      kick (same source as matchTimeline's [KICK]; gate-predicate divergence
 *      case 13: do NOT read extraSpellId here). The school itself is not
 *      checked — the locked school is almost always the healing one, and a
 *      wrong exemption costs far less than a wrong accusation.
 *
 * "Enemy" means `enemyIds` — pass `enemySourceIds(...)` (the enemy players
 * plus everything they summoned) so a pet's stun or a totem's silence counts;
 * a players-only set drops them (e5b3534b: a Hunter pet's Intimidation on the
 * owner, triage 2026-09-29 H23).
 *
 * Intervals are raw (unclipped, possibly overlapping); `coveredMsWithin`
 * clips them to a window and merges before summing.
 */
export function buildCannotCastIntervals(
  unit: ICombatUnit,
  enemyIds: Set<string>,
  /** the round's units — a kick's lockout reads its kicker's talents
   * (`kickLockoutSecondsFor`); without them the ruled holder value */
  units?: RoundUnits,
): Array<{ from: number; to: number }> {
  return namedCannotCastIntervals(unit, enemyIds, units).map((iv) => ({
    from: iv.from,
    to: iv.to,
  }));
}

/** One `buildCannotCastIntervals` interval with what caused it. */
export interface NamedCannotCastInterval {
  from: number;
  to: number;
  /** the cast-blocking aura, or for a lockout the kick (SPELL_INTERRUPT's
   * own `spellId`) */
  spellId: string;
  lockout: boolean;
  /** for a lockout: the schools of the spell that was interrupted (official
   * SchoolMask) — what the lock shuts out. Undefined when unknown. */
  lockedSchoolMask?: number;
  /** for a lockout: the spells this unit's PET casts (`petCastSpellIdsOf`).
   * The lock sits on the unit's own cast bar and stops none of them, whatever
   * their school. */
  petCastSpellIds?: ReadonlySet<string>;
  /** set by `cannotCastIntervalsForSpells` on an interval that sits on a PET
   * of the unit asked about (the pet that casts the spell asked about), not
   * on the unit: that pet's id. A fact naming what blocked "the owner" must
   * not name such an interval as the owner's. */
  onPetId?: string;
  /** the unit's own state, not something done to it (its flying breath,
   *  `OWN_FLIGHT_AURA_IDS`): locked time, never a CC to name */
  self?: true;
  /** a disarm (preview): stops only a weapon-requiring spell, and only for a
   *  reader that names its spells (`cannotCastIntervalsForSpells`) */
  disarm?: true;
}

/** The round's units, as the pet reading needs them (`petCastersOf`). */
export type RoundUnits = ReadonlyArray<ICombatUnit> | undefined;

/**
 * The spells the log shows this unit's PET casting and never the unit itself
 * (SPELL_CAST_SUCCESS in `petSpellCastEvents`, none in `spellCastEvents`):
 * Spell Lock, Devour Magic, a pet's own kit. A kick lockout on the owner does
 * not reach them — review 40-FT-54, asked of the corpus before it was
 * believed (fix-FT/scripts/t10_petLock.ts, 605 files, 4,093 lockouts on
 * players whose pets cast something): the pet pressed the spell inside the
 * owner's lockout in 1,652 of 11,491 pairs whose school the lock covers
 * (14.4 %) and in 906 of 6,234 pairs it does not (14.5 %) — the lock's school
 * makes no difference to the pet, where for the player's own spells it is
 * 0.09 % against 5.9 % (`intervalBlocksSpell`). Spell Lock alone: 68 / 905
 * inside a lock that covers Shadow; Devour Magic 88 / 641.
 * Observed, not listed: a pet spell never pressed this round stays on the
 * owner's reading (the exemption stays).
 *
 * Nor does a cast-blocking AURA on the owner reach them
 * (`cannotCastIntervalsForSpells`, 2026-10-11): what stops a pet-cast spell
 * is a control or a lockout on the PET. Asked of the corpus the same way
 * (fix-FT/scripts/t10_petHardCc.ts, 605 files: owner aura interval × spell
 * the owner's pets cast, against that spell's rate in same-length windows
 * with no aura on the owner). For controlled pets (Pet- GUID) with no unit
 * of the owner's under a cast-blocking aura of its own, the pet cast the
 * spell inside the owner's aura in 2,903 of 16,039 pairs (18.1 %) against a
 * base of 17.3 % — while the player's OWN spells are 0.53 % inside against
 * 7.0 %. Hard CC on the owner, by commanded spell: Spell Lock 60 / 1,010
 * inside (5.9 %) vs 3.9 % base, Devour Magic 41 / 693 (5.9 %) vs 7.3 %,
 * Master's Call 24 / 830 (2.9 %) vs 2.9 %, Seduction 9 / 179 (5.0 %) vs
 * 3.9 %. With a unit of the owner's ITSELF under a cast-blocking aura in
 * that interval the rate halves: 944 / 10,335 (9.1 %) vs 16.7 %.
 * Those are controlled pets. `petSpellCastEvents` also holds what a
 * guardian or a totem casts (Creature- GUID), and this one definition of
 * "pet-cast" covers them for the lockout and the aura alike — for them the
 * probe is confounded, not clean (9.7 % inside vs 15.9 % base: a summon's
 * spell logged at the owner's own press is 0 % inside for that reason
 * alone).
 */
export function petCastSpellIdsOf(unit: ICombatUnit): ReadonlySet<string> {
  const successIds = (events: ICombatUnit["spellCastEvents"] | undefined) =>
    new Set(
      (events ?? [])
        .filter((c) => c.logLine.event === LogEvent.SPELL_CAST_SUCCESS)
        .map((c) => String(c.spellId)),
    );
  const own = successIds(unit.spellCastEvents);
  return new Set(
    [
      ...successIds(
        (unit.petSpellCastEvents ?? []).filter((c) =>
          isControlledPetGuid(c.srcUnitId),
        ),
      ),
    ].filter((id) => !own.has(id)),
  );
}

/**
 * A CONTROLLED pet (a hunter's pet, a warlock's demon, a mage's elemental):
 * its GUID is a `Pet-` GUID. `petSpellCastEvents` also carries every other
 * summon of the unit — totems, treants, guardians (`Creature-` GUIDs) — and
 * the evidence that the owner's control does not reach the caster is clean
 * for controlled pets only (t10_petHardCc.ts, 605 files: Pet- GUID 18.1 %
 * inside the owner's aura vs 17.3 % base; Creature- GUID 9.7 % vs 15.9 % —
 * confounded, so those spells stay on the owner's reading: the exemption
 * stays).
 */
export function isControlledPetGuid(unitId: string | undefined): boolean {
  return !!unitId && unitId.startsWith("Pet-");
}

type PetCasters = ReadonlyMap<string, readonly ICombatUnit[]>;
const NO_PET_CASTERS: PetCasters = new Map();

/** `petCastersOf` for every pet-cast spell of the unit, in one pass. */
function petCastersBySpell(unit: ICombatUnit, units: RoundUnits): PetCasters {
  const petCasts = unit.petSpellCastEvents;
  if (!units?.length || !petCasts?.length) return NO_PET_CASTERS;
  const petCast = petCastSpellIdsOf(unit);
  if (petCast.size === 0) return NO_PET_CASTERS;
  const owned = new Map(
    units.filter((u) => u.ownerId === unit.id).map((u) => [u.id, u]),
  );
  const out = new Map<string, ICombatUnit[]>();
  for (const c of petCasts) {
    if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
    const spellId = String(c.spellId);
    if (!petCast.has(spellId)) continue;
    const pet = owned.get(c.srcUnitId);
    if (!pet) continue;
    const casters = out.get(spellId) ?? [];
    if (!casters.includes(pet)) casters.push(pet);
    out.set(spellId, casters);
  }
  return out;
}

/**
 * The pet unit(s) the log shows casting `spellId` for `unit` this round: the
 * units whose `ownerId` is the unit (the summon-owner attribution
 * `enemySourceIds` reads) and whose SPELL_CAST_SUCCESS of that id sits in the
 * unit's `petSpellCastEvents` — for a pet-cast spell only
 * (`petCastSpellIdsOf`: a spell the unit also cast itself is the unit's).
 * Empty for any other spell, and when the caster is not among `units`: the
 * spell then stays on the owner's reading.
 */
export function petCastersOf(
  unit: ICombatUnit,
  units: RoundUnits,
  spellId: string,
): readonly ICombatUnit[] {
  return petCastersBySpell(unit, units).get(spellId) ?? [];
}

/**
 * Does this cannot-cast interval stop `spellId`, cast by the unit the
 * interval sits on? A hard-CC aura stops everything; a SILENCE aura (the
 * official DR silence family, not hard CC — `isSilenceOnlyAura`) stops
 * every spell but one DB2 says a silence does not prevent
 * (`isUnsilenceableCast`: a SpellCategories row without the silence bit —
 * Stormstrike, Mortal Strike, Judgment); a spell with no row stays stopped.
 * FT-R1011c follow-up (2026-10-14): of the casts that went out inside a
 * silence aura on 605 files, 2,368 had such a row, 2 the silence bit, 123 no
 * row. A kick lockout stops a spell only when every school of
 * that spell is inside the lock (`schoolLockedBy`, the kick-eaten
 * predicate). Unknown school on either side → it blocks (the exemption
 * stays).
 *
 * ONE interval of ONE unit: it cannot see a pet's intervals. A reader asks
 * `cannotCastIntervalsForSpells` (or `actWindowFor`) with the round's units
 * and never filters the owner's list with this by hand — for a spell the
 * unit's pet casts, the owner's intervals are the wrong list.
 *
 * FT-T10 (user ruling 2026-10-10, option B): until this, a lockout was read
 * as stopping every spell ("a wrong exemption costs far less than a wrong
 * accusation"). 605 files, 6,117 lockouts × the locked player's ledger
 * spells (fix-FT/scripts/t10_lockSchool.ts): 45 % of the pairs have a school
 * outside the lock and 1,199 of those were pressed inside the lockout; of the
 * 24,658 pairs fully inside the lock, 23 were. Read per spell by every
 * reader that asks about a named spell or set of spells (cd-hoarded's owner
 * gate, the sync-window ready gate, purge / cleanse "locked", the kick run
 * budget, cc-avoidable, [CD PRIOR], burst-window feasibility, the death
 * block's option tags — `cannotCastIntervalsForSpells`); a reader with no
 * single spell to ask about (healing gaps, HEALER OFFENSE free seconds,
 * death-setup healer-locked, `ccInWindowS`, [RES], CONSEQ) still takes a
 * lockout as locking everything — predicate-index "Not yet unified".
 */
export function intervalBlocksSpell(
  iv: Pick<
    NamedCannotCastInterval,
    "lockout" | "lockedSchoolMask" | "petCastSpellIds"
  > &
    Partial<Pick<NamedCannotCastInterval, "spellId">>,
  spellId: string | undefined,
): boolean {
  if ((iv as { disarm?: true }).disarm)
    return spellId !== undefined && isWeaponRequiredCast(spellId);
  if (spellId === undefined) return true;
  if (!iv.lockout)
    return !(
      iv.spellId !== undefined &&
      isSilenceOnlyAura(iv.spellId) &&
      isUnsilenceableCast(spellId)
    );
  // the pet's spell: the owner's cast bar is not its cast bar
  if (iv.petCastSpellIds?.has(spellId)) return false;
  // a cast a silence does not prevent is not one a school lockout prevents
  // (DB2's silence bit, `isUnsilenceableCast`; codex R6C-03 #2: Judgment
  // SUCCEEDED inside a Holy lock, 121afd91 r3, and its five refusals there
  // were its own cooldown, not the lock)
  if (isUnsilenceableCast(spellId)) return false;
  const m = spellSchoolMask(spellId);
  if (m === undefined || iv.lockedSchoolMask === undefined) return true;
  return schoolLockedBy(m, iv.lockedSchoolMask);
}

/**
 * Does the game let the unit press `spellId` THROUGH this cannot-cast
 * interval? Only through a stun (`isStunDrAura`, the test
 * `wasLockedOutByStunOnly` applies to a CC instance), and only a spell the
 * product's one usable-while-stunned predicate admits (`usableWhileStunned`:
 * DB2's "Allow While Stunned" bits, the conditional PvP-talent layer read
 * from `pvpTalentIds`, and the immunity-purge route of user ruling U-T1 —
 * Divine Shield, Ice Block, Icebound Fortitude; Blink is withheld by U-T1b
 * and stays blocked). A school-limited purge (Blessing of Protection) counts
 * only where the press would land on the stunned unit itself (`onSelf`) and
 * the stun is wholly a school it covers. Never through a kick lockout, a
 * silence, a fear or any other control — the table has no such dimension
 * wired — and never for an interval that sits on a pet.
 *
 * Opt-in (`actWindowFor`'s `stunPressable`): `intervalBlocksSpell` itself
 * still takes every hard-CC aura as stopping everything (a silence only what
 * DB2 lets it prevent), for every other reader.
 */
export function stunLetsPress(
  iv: Pick<NamedCannotCastInterval, "lockout" | "spellId" | "onPetId">,
  spellId: string,
  ctx: { pvpTalentIds?: ReadonlySet<string>; onSelf?: boolean },
): boolean {
  if (iv.lockout || iv.onPetId !== undefined) return false;
  if (!isStunDrAura(iv.spellId)) return false;
  return usableWhileStunned(
    spellId,
    ctx.pvpTalentIds,
    ctx.onSelf ? [iv.spellId] : undefined,
  );
}

/**
 * FT-T10: "when could this unit cast NONE of these spells" — the one reading
 * for a reader that knows which spell(s) it is asking about. No spell to ask
 * about (undefined / empty) → every interval of the unit, the unasked
 * reading (`namedCannotCastIntervals`), and never a pet's interval.
 *
 * Each spell is asked of the unit that CASTS it:
 *  - the unit itself, for every spell but the ones below: its own intervals,
 *    the time during which it could press none of them
 *    (`blockedForEverySpell`, `actWindowFor().stateIn`'s reading);
 *  - a pet of the unit, for a spell the log shows that pet casting and never
 *    the unit (`petCastersOf`: Spell Lock, Devour Magic, Seduction): the
 *    cast-blocking auras enemies put on the PET and the kick lockouts on the
 *    PET (per school, like a player's) — and none of the owner's. A stunned
 *    Warlock still commands Spell Lock; a stunned Felhunter does not cast it
 *    (`petCastSpellIdsOf` has the corpus numbers). Those intervals carry
 *    `onPetId`.
 *
 * Quantifier — EVERY, as for the spells of one unit: the result is the time
 * at which every caster asked about is stopped, so that no spell of the set
 * can go off. One caster → that caster's list as it is. Several (own spells
 * and a pet's, or a spell two pets of the unit cast this round — it is
 * stopped only while EVERY pet that cast it is) → each caster's intervals
 * clipped to the time all of them are blocked, each keeping its cause, in
 * start order.
 *
 * `units` = the round's units (`combat.units`). Without them, for a spell
 * whose pet is not among them, and for a pet spell never seen from the pet
 * this round (observed, not listed), the spell stays on the owner's reading.
 *
 * NOT known here, and not papered over: whether the pet was alive or out at
 * all (nothing in the product reads a pet's UNIT_DIED or its dismissal; a
 * dead pet has no aura on it and reads as free), the pet's own cooldown, and
 * the pet's range / line of sight to the target (the readers' reach checks
 * sample the owner).
 */
export function cannotCastIntervalsForSpells(
  unit: ICombatUnit,
  enemyIds: Set<string>,
  spellIds: readonly string[] | undefined,
  units: RoundUnits,
  /** the unit's own intervals to leave out BEFORE the set is read — the
   * pieces that come back are clipped to the time every spell is stopped,
   * so a reader cannot pick an interval out of them by its start (kick-
   * eaten's `ccInWindowS`: this kick's own lockout) */
  exclude?: (iv: NamedCannotCastInterval) => boolean,
): NamedCannotCastInterval[] {
  // work order 2026-10-14d Part 2 (preview): a disarm stops the weapon-
  // requiring spells asked about — only when spells are named (an unasked
  // reader would read a disarm as stopping everything)
  const named = namedCannotCastIntervals(unit, enemyIds, units);
  const own = exclude ? named.filter((iv) => !exclude(iv)) : named;
  return intervalsForSpells(
    spellIds?.length ? [...own, ...disarmIntervals(unit, enemyIds)] : own,
    petBlockLists(enemyIds, spellIds, petCastersBySpell(unit, units), units),
    spellIds,
  );
}

/** The disarm auras the other side put on `unit` (DB2 SpellMechanic 3,
 * `disarmSpellIds`), APPLIED → first REMOVED / BROKEN of the same spell and
 * source, a missing REMOVED at the official length. Preview. */
export function disarmIntervals(
  unit: ICombatUnit,
  enemyIds: Set<string>,
): NamedCannotCastInterval[] {
  // work order 2026-10-15 Part 2 (user 「好」): the CC pairings' reading — a
  // re-broadcast is one aura (`dropAuraRebroadcasts`), a BROKEN its own
  // REMOVED follows is not the end (`supersededAuraBreaks`), a removal closes
  // its source's application or else the earliest of the spell
  // (`matchPendingCcKey`: a BROKEN's source is the breaker), a re-APPLIED
  // inside the official length is the same application
  // (`reAppliedIsSameApplication`, no caster here), a lost REMOVED closes at
  // the official length
  const pending = new Map<string, { applyMs: number; spellId: string }>();
  const out: NamedCannotCastInterval[] = [];
  const close = (spellId: string, from: number, to: number) =>
    out.push({ from, to, spellId, lockout: false, disarm: true });
  const notTheEnd = supersededAuraBreaks(unit.auraEvents ?? []);
  // filter BEFORE the re-broadcast pass (PV395 firstPaint: the whole stream
  // per call put dropAuraRebroadcasts at 744 ms self on report-heavy, ratio
  // 3.7 → 5.5). Equivalent: its pairing key holds the spell id, so each key
  // group is kept or dropped whole and in order (`buildCcCategoryHistory`)
  const disarmAuras = (unit.auraEvents ?? []).filter((a) =>
    disarmSpellIds.has(String(a.spellId ?? "")),
  );
  for (const a of dropAuraRebroadcasts(disarmAuras)) {
    const id = String(a.spellId ?? "");
    if (notTheEnd.has(a)) continue;
    const key = `${id}:${a.srcUnitId}`;
    const ev = a.logLine.event;
    const officialS = ccFullDurationSeconds(id) ?? null;
    if (ev === LogEvent.SPELL_AURA_APPLIED) {
      if (!enemyIds.has(a.srcUnitId)) continue;
      const open = pending.get(key);
      if (open !== undefined) {
        if (
          reAppliedIsSameApplication(
            open.applyMs,
            a.timestamp,
            officialS,
            false,
          )
        )
          continue;
        close(
          id,
          open.applyMs,
          Math.min(a.timestamp, open.applyMs + officialS! * 1000),
        );
      }
      pending.set(key, { applyMs: a.timestamp, spellId: id });
    } else if (
      ev === LogEvent.SPELL_AURA_REMOVED ||
      ev === LogEvent.SPELL_AURA_BROKEN ||
      ev === LogEvent.SPELL_AURA_BROKEN_SPELL
    ) {
      const k = matchPendingCcKey(pending, id, key);
      const open = k ? pending.get(k) : undefined;
      if (!k || !open) continue;
      pending.delete(k);
      close(id, open.applyMs, a.timestamp);
    }
  }
  for (const open of pending.values()) {
    const s = ccFullDurationSeconds(open.spellId);
    if (s !== undefined)
      close(open.spellId, open.applyMs, open.applyMs + s * 1000);
  }
  return out;
}

/** `spellIds` split by caster: the unit's own, and for each pet that casts
 * some of them that pet's intervals stopping every one of ITS spells. */
function petBlockLists(
  enemyIds: Set<string>,
  spellIds: readonly string[] | undefined,
  casters: PetCasters,
  units?: RoundUnits,
): { ownSpellIds: readonly string[]; petLists: NamedCannotCastInterval[][] } {
  if (!spellIds?.length || casters.size === 0)
    return { ownSpellIds: spellIds ?? [], petLists: [] };
  const ownSpellIds: string[] = [];
  const spellsByPet = new Map<ICombatUnit, string[]>();
  for (const id of spellIds) {
    const pets = casters.get(id);
    if (!pets?.length) {
      ownSpellIds.push(id);
      continue;
    }
    for (const pet of pets)
      spellsByPet.set(pet, [...(spellsByPet.get(pet) ?? []), id]);
  }
  return {
    ownSpellIds,
    petLists: [...spellsByPet].map(([pet, ids]) =>
      blockedForEverySpell(
        namedCannotCastIntervals(pet, enemyIds, units),
        ids,
      ).map((iv) => ({ ...iv, onPetId: pet.id })),
    ),
  };
}

/** The time every list's union covers. */
function commonRuns(
  lists: ReadonlyArray<readonly NamedCannotCastInterval[]>,
): Array<{ from: number; to: number }> {
  let common = cannotCastRuns(lists[0]!);
  for (const list of lists.slice(1)) {
    const runs = cannotCastRuns(list);
    const both: Array<{ from: number; to: number }> = [];
    for (const a of common)
      for (const b of runs) {
        const from = Math.max(a.from, b.from);
        const to = Math.min(a.to, b.to);
        if (to > from) both.push({ from, to });
      }
    common = both;
  }
  return common;
}

/** Each interval clipped to the runs, keeping its cause, in start order. */
function clipToRuns(
  ivs: readonly NamedCannotCastInterval[],
  runs: ReadonlyArray<{ from: number; to: number }>,
): NamedCannotCastInterval[] {
  const out: NamedCannotCastInterval[] = [];
  for (const iv of ivs)
    for (const run of runs) {
      const from = Math.max(iv.from, run.from);
      const to = Math.min(iv.to, run.to);
      if (to > from) out.push({ ...iv, from, to });
    }
  return out.sort((a, b) => a.from - b.from);
}

/**
 * FT-T10: the intervals of ONE caster during which it could press NONE of
 * `spellIds` — read per TIME, not per interval (codex post-hoc
 * 60-POSTHOC-02 U2): the unit is stopped while every spell is stopped by
 * some interval (`intervalBlocksSpell`), and free while at least one of them
 * is castable. Until this an interval was kept only when it alone stopped
 * every spell, so two overlapping single-school locks — Frost 10–13 by
 * Pummel, Arcane 11–17 by Counterspell — were both dropped and Ice Block ∪
 * Greater Invisibility read free over 10–15 instead of blocked 11–13. Each
 * interval that stops at least one of the spells, clipped to that time; one
 * that stops every spell lies inside it and is kept whole. No spell to ask
 * about → the list as it is. Like `intervalBlocksSpell`, blind to a pet's
 * intervals: readers go through `cannotCastIntervalsForSpells`.
 */
export function blockedForEverySpell(
  named: readonly NamedCannotCastInterval[],
  spellIds: readonly string[] | undefined,
  /** "does this interval stop this spell" — `intervalBlocksSpell`, or
   * `actWindowFor`'s reading that also lets a spell through a stun it can
   * be pressed through (`stunLetsPress`), per spell */
  blocks: (
    iv: NamedCannotCastInterval,
    spellId: string,
  ) => boolean = intervalBlocksSpell,
): NamedCannotCastInterval[] {
  if (!spellIds?.length) return [...named];
  if (spellIds.length === 1)
    return named.filter((iv) => blocks(iv, spellIds[0]!));
  const perSpell = spellIds.map((id) => named.filter((iv) => blocks(iv, id)));
  return clipToRuns(
    named.filter((iv) => perSpell.some((list) => list.includes(iv))),
    commonRuns(perSpell),
  );
}

/** `cannotCastIntervalsForSpells` over the unit's already-built intervals. */
function intervalsForSpells(
  ownNamed: readonly NamedCannotCastInterval[],
  split: ReturnType<typeof petBlockLists>,
  spellIds: readonly string[] | undefined,
  blocks?: (iv: NamedCannotCastInterval, spellId: string) => boolean,
): NamedCannotCastInterval[] {
  if (split.petLists.length === 0)
    return blockedForEverySpell(ownNamed, spellIds, blocks);
  const lists = [
    ...(split.ownSpellIds.length
      ? [blockedForEverySpell(ownNamed, split.ownSpellIds, blocks)]
      : []),
    ...split.petLists,
  ];
  if (lists.length === 1) return lists[0]!;
  // the time every caster is blocked, then each cause clipped to it
  const common = commonRuns(lists);
  const out: NamedCannotCastInterval[] = [];
  for (const list of lists)
    for (const iv of list)
      for (const run of common) {
        const from = Math.max(iv.from, run.from);
        const to = Math.min(iv.to, run.to);
        if (to > from) out.push({ ...iv, from, to });
      }
  return out.sort((a, b) => a.from - b.from);
}

const SCHOOL_BIT_NAMES: ReadonlyArray<[number, string]> = [
  [1, "Physical"],
  [2, "Holy"],
  [4, "Fire"],
  [8, "Nature"],
  [16, "Frost"],
  [32, "Shadow"],
  [64, "Arcane"],
];
/** ` (Arcane)` / ` (Fire/Shadow)` — the schools a lockout shut, for the
 * facts that name it (cd-hoarded `ownerCc`); "" when unknown. Each school
 * by its own name, never a combined one ("Shadowflame"): the reader matches
 * it against a spell's school. */
export function lockedSchoolsText(mask: number | undefined): string {
  if (!mask) return "";
  const names = SCHOOL_BIT_NAMES.filter(([bit]) => (mask & bit) !== 0).map(
    ([, name]) => name,
  );
  return names.length ? ` (${names.join("/")})` : "";
}

/**
 * `buildCannotCastIntervals` with each interval's cause — the same intervals
 * in the same order (it is the implementation), for a fact that has to NAME
 * what blocked the unit (cd-hoarded `facts.ownerCc`, triage 2026-09-29 H1).
 */
export function namedCannotCastIntervals(
  unit: ICombatUnit,
  enemyIds: Set<string>,
  /** the round's units — a kick's lockout reads its kicker's talents
   * (`kickLockoutSecondsFor`); without them the ruled holder value */
  units?: RoundUnits,
): NamedCannotCastInterval[] {
  const intervals: NamedCannotCastInterval[] = castBlockingAuraIntervals(
    unit,
    enemyIds,
  ).map((a) => ({
    from: a.from,
    to: a.to,
    spellId: a.spellId,
    lockout: false,
  }));

  // The unit's own flying breath (`ownFlightIntervals`): no cast while it
  // flies — a lock on everything, like a stun. `self`: the unit's own doing,
  // so the readers that NAME a CC chain leave it out (`deathLockChain`); the
  // locked time counts.
  for (const f of ownFlightIntervals(unit))
    intervals.push({ ...f, lockout: false, self: true });

  let petCast: ReadonlySet<string> | undefined;
  for (const action of unit.actionIn ?? []) {
    if (action.logLine.event !== LogEvent.SPELL_INTERRUPT) continue;
    if (!enemyIds.has(action.srcUnitId)) continue;
    petCast ??= petCastSpellIdsOf(unit);
    const kickSpellId = action.spellId ?? "";
    // kick-eaten F-K8 (A23): the lockout THIS unit sat in — a Storm Conduit
    // holder's interrupted Lightning Bolt locks for ×0.35 before the
    // 2026-08-18 hotfix and ×0.6 since
    const interrupted = (action as { extraSpellId?: string }).extraSpellId;
    intervals.push({
      from: action.timestamp,
      to:
        action.timestamp +
        kickLockoutSecondsFor(
          kickSpellId,
          unit,
          interrupted,
          action.timestamp,
          units?.find((u) => u.id === action.srcUnitId),
        ) *
          1000,
      spellId: kickSpellId,
      lockout: true,
      ...(interrupted && spellSchoolMask(String(interrupted)) !== undefined
        ? { lockedSchoolMask: spellSchoolMask(String(interrupted)) }
        : {}),
      ...(petCast.size > 0 ? { petCastSpellIds: petCast } : {}),
    });
  }

  return intervals;
}

/**
 * The source set `buildCannotCastIntervals` expects: the enemy players plus
 * every unit whose `ownerId` is one of them (pets, totems, guardians — the
 * summon-GUID attribution of GH #99). One definition for every caller; until
 * 2026-09-30 some passed players only and lost pet CC (triage H23), others
 * built this set inline (burst-window feasibility, missed-sync-window).
 */
export function enemySourceIds(
  enemyPlayers: ReadonlyArray<{ id: string }>,
  units: ReadonlyArray<{ id: string; ownerId?: string }>,
): Set<string> {
  const ids = new Set<string>(enemyPlayers.map((u) => u.id));
  const players = new Set(ids);
  for (const u of units) if (u.ownerId && players.has(u.ownerId)) ids.add(u.id);
  return ids;
}

/**
 * The unit's own flying breath (`OWN_FLIGHT_AURA_IDS`, user ruling
 * 2026-10-14): no cast while it flies. Paired per id, in log order (agy
 * 40-FT-85: one shared open start let a flight with no REMOVED run into the
 * next flight, and two overlapping ids dropped a piece). A flight with no
 * REMOVED — a new APPLIED of it first, or none at all — is closed at its
 * official length, never left open. Read by `namedCannotCastIntervals` (the
 * unit's own locked time) and `castBlockingAuraAt` (a kicker in flight
 * cannot kick — work order 2026-10-14d #10).
 */
export function ownFlightIntervals(
  unit: ICombatUnit,
): Array<{ from: number; to: number; spellId: string }> {
  const out: Array<{ from: number; to: number; spellId: string }> = [];
  const flightOpen = new Map<string, number>();
  const fullMs = (spellId: string): number | undefined => {
    const s = buffFullDurationForCaster(spellId, unit);
    return s === undefined ? undefined : s * 1000;
  };
  for (const a of unit.auraEvents ?? []) {
    const id = String(a.spellId ?? "");
    if (!OWN_FLIGHT_AURA_IDS.has(id)) continue;
    if (a.srcUnitId !== unit.id) continue;
    const open = flightOpen.get(id);
    if (a.logLine.event === LogEvent.SPELL_AURA_APPLIED) {
      if (open !== undefined) {
        const full = fullMs(id);
        if (full !== undefined)
          out.push({
            from: open,
            to: Math.min(open + full, a.timestamp),
            spellId: id,
          });
      }
      flightOpen.set(id, a.timestamp);
    } else if (
      a.logLine.event === LogEvent.SPELL_AURA_REMOVED &&
      open !== undefined
    ) {
      out.push({ from: open, to: a.timestamp, spellId: id });
      flightOpen.delete(id);
    }
  }
  for (const [id, open] of flightOpen) {
    const full = fullMs(id);
    if (full !== undefined)
      out.push({ from: open, to: open + full, spellId: id });
  }
  return out;
}

export interface CastBlockingAura {
  spellId: string;
  spellName: string;
  srcUnitId: string;
  srcUnitName: string;
  /** SPELL_AURA_APPLIED, epoch ms */
  from: number;
  /** first REMOVED / BROKEN after the APPLIED in log order; with no REMOVED
   * the official length (`ccFullDurationSeconds`), Infinity when that is
   * unknown */
  to: number;
}

/**
 * The enemy-applied cast-blocking auras on `unit` (hard CC + silence,
 * `isCastBlockingAuraType`), APPLIED paired with the first REMOVED/BROKEN of
 * the same spell after it in log order. The aura half of `buildCannotCastIntervals`,
 * exported so a renderer can name what blocked the unit without a second
 * predicate (2026-09-25, reliability round 2 W1b).
 */
export function castBlockingAuraIntervals(
  unit: ICombatUnit,
  enemyIds: Set<string>,
): CastBlockingAura[] {
  // Pairing is by position in the unit's aura stream (log order), not by
  // timestamp: a Cyclone re-applied in the same millisecond as the previous
  // one's REMOVED (e5b3534b 23.317, REMOVED logged first) used to pair with
  // that earlier REMOVED — `r >= a.ts` — and became a zero-length interval,
  // so the owner read as free for the whole 4.8 s (triage 2026-09-29 H23).
  //
  // And by CASTER (user ruling P-FU-H23, 2026-10-06): a removal closes the
  // application of ITS source — `matchPendingCcKey`, the pairing `ccInstances`
  // and the CC-break analysis use (exact `spell:source` key; a BROKEN line's
  // source is the breaker, so it falls back to the earliest pending
  // application of the spell). Until then every application paired with the
  // first later removal of the SPELL: a second paladin's Hammer of Justice
  // landing while the first was still up ended at the first one's REMOVED,
  // and the unit read as free for the rest of the second stun.
  const pending = new Map<
    string,
    {
      applyMs: number;
      spellId: string;
      name: string;
      srcId: string;
      srcName: string;
    }
  >();
  const out: CastBlockingAura[] = [];

  // Fixture-built units may lack either stream (momentSnapshot.test.ts has
  // healers with no actionIn) — an absent stream is "nothing happened", not a
  // throw that the caller's try/catch would turn into "no gaps at all".
  // a BROKEN line its aura's own REMOVED follows is not the end (FT-T08)
  const notTheEnd = supersededAuraBreaks(unit.auraEvents ?? []);
  for (const aura of unit.auraEvents ?? []) {
    const spellId = aura.spellId;
    if (!spellId) continue;
    if (notTheEnd.has(aura)) continue;
    // cc-dr F-SR1 (ruling A52 = A, 2026-09-30): a CC / silence whose source
    // is the unit itself was sent back to it (Diffuse Magic, Reverse Magic,
    // Spell Reflection) and locks it like any enemy's — 82a2d681's Death
    // Knight sat in his own reflected Strangulate 57.33–60.31 and read free.
    //
    // The caster filter is the APPLIED's alone (ccInstances' and
    // `disarmIntervals`' rule): a BROKEN row names the BREAKER, a friendly
    // one too (a teammate's Blessing of Sacrifice) — dropped here, the CC
    // ran on to its official end (codex post-hoc 60-POSTHOC-02 U2: 16 s
    // instead of 12 s). A break only closes an open application, and only
    // an enemy's (or a reflected one) opens one. A REMOVED keeps the filter:
    // its source is the aura's own caster, and a friendly copy's REMOVED
    // must not close an enemy's application through `matchPendingCcKey`'s
    // same-spell fallback (codex 20-F15-17: an enemy stun 10–15 s read
    // 10–12 s after a friendly copy's removal at 12 s).
    const isApplied = aura.logLine.event === LogEvent.SPELL_AURA_APPLIED;
    const isBreakRow =
      aura.logLine.event === LogEvent.SPELL_AURA_BROKEN ||
      aura.logLine.event === LogEvent.SPELL_AURA_BROKEN_SPELL;
    // fact2 (2026-10-20): a dispel backlash locks its holder whoever the
    // row names as its source — the dispelled DoT's caster, a teammate when
    // the DoT was a teammate's (e49b7c3b 1:28: four Innervate presses
    // refused "while horrified" under a Sin and Punishment sourced to the
    // healer's own Shadow Priest). `ccInstances` takes it on a friendly
    // holder the same way.
    // codex 21-R12-b #1: a control the holder's OWN team put on it while it
    // was charmed (Mind Controlled) is a control on it — `ccInstances`'
    // admission (`charmedAt`); the APPLIED decides, as for an enemy's
    if (
      !isBreakRow &&
      !enemyIds.has(aura.srcUnitId) &&
      aura.srcUnitId !== unit.id &&
      !BACKLASH_AURA_CC_TYPE.has(spellId) &&
      !(isApplied && charmedAt(unit, aura.timestamp)) &&
      // …and its REMOVED closes it (the application is pending by its key)
      !(!isApplied && pending.has(`${spellId}:${aura.srcUnitId}`))
    )
      continue;
    // cc-dr F-BK1: the dispel-backlash auras (Unstable Affliction's silence
    // 196364, Vampiric Touch's horror 87204 — DB2 aura 7 / mechanic 24,
    // tier-C 09-30) have no SPELL_CATEGORIES row; the one registered table is
    // `BACKLASH_AURA_CC_TYPE`, which `ccInstances` already reads.
    const spell = SPELLS[spellId];
    if (
      !BACKLASH_AURA_CC_TYPE.has(spellId) &&
      (!spell || !isCastBlockingAuraType(spell.type))
    )
      continue;

    const key = `${spellId}:${aura.srcUnitId}`;
    if (isApplied) {
      // a second APPLIED from the same caster with no removal between keeps
      // the first one's start (both used to run to the same removal) — while
      // it is inside the first one's official length
      // (`reAppliedIsSameApplication`, work order 2026-10-14d #13): past it,
      // the first one's REMOVED was lost, and it closes at its official end
      // (605: six `[CONSEQ] enemy healer … in Strangulate (silence) for 51s`
      // ran from one silence to a later one's REMOVED)
      const open = pending.get(key);
      const officialS = ccFullDurationSeconds(spellId);
      if (
        open !== undefined &&
        !reAppliedIsSameApplication(
          open.applyMs,
          aura.timestamp,
          officialS,
          false,
        )
      ) {
        pending.delete(key);
        out.push({
          spellId,
          spellName: open.name,
          srcUnitId: open.srcId,
          srcUnitName: open.srcName,
          from: open.applyMs,
          to: Math.min(aura.timestamp, open.applyMs + officialS! * 1000),
        });
      }
      if (!pending.has(key))
        pending.set(key, {
          applyMs: aura.timestamp,
          spellId,
          name: aura.spellName ?? spellId,
          srcId: aura.srcUnitId,
          srcName: aura.srcUnitName ?? "",
        });
    } else if (
      aura.logLine.event === LogEvent.SPELL_AURA_REMOVED ||
      aura.logLine.event === LogEvent.SPELL_AURA_BROKEN ||
      aura.logLine.event === LogEvent.SPELL_AURA_BROKEN_SPELL
    ) {
      const matchKey = matchPendingCcKey(pending, spellId, key);
      const p = matchKey ? pending.get(matchKey) : undefined;
      if (!p || !matchKey) continue;
      pending.delete(matchKey);
      out.push({
        spellId,
        spellName: p.name,
        srcUnitId: p.srcId,
        srcUnitName: p.srcName,
        from: p.applyMs,
        to: aura.timestamp,
      });
    }
  }
  // never removed: its official length when known (the cap `ccInstances`
  // and `buildAuraIntervals` put on a missing REMOVED — work order
  // 2026-10-14d #13), else open-ended
  for (const p of pending.values()) {
    const officialS = ccFullDurationSeconds(p.spellId);
    out.push({
      spellId: p.spellId,
      spellName: p.name,
      srcUnitId: p.srcId,
      srcUnitName: p.srcName,
      from: p.applyMs,
      to: officialS === undefined ? Infinity : p.applyMs + officialS * 1000,
    });
  }
  // in application order (a stable sort: same-millisecond applications keep
  // their log order)
  out.sort((a, b) => a.from - b.from);
  // One aura the game re-broadcast — REMOVED and APPLIED of the same spell
  // from the same source in the same ms — is one interval, not two (work
  // order 2026-10-14b fix 8: e5b3534b's one Cyclone printed two chain links,
  // `Cyclone 116.7`, and an ownerCc start at the re-broadcast). Only pieces
  // that meet exactly: the covered time is the same to the ms, so no
  // decision moves (codex 40-FT-83 — `dropAuraRebroadcasts`' 1 ms gap
  // filled in turned a 1.000 s free window into 0.999 s).
  const merged: CastBlockingAura[] = [];
  for (const iv of out) {
    const prev = [...merged]
      .reverse()
      .find(
        (m) =>
          m.spellId === iv.spellId &&
          m.srcUnitId === iv.srcUnitId &&
          m.to === iv.from,
      );
    if (prev) prev.to = iv.to;
    else merged.push({ ...iv });
  }
  return merged;
}

/** A cast-blocking aura that is hard CC: the official set, or a dispel
 * backlash that is a horror (Sin and Punishment 87204 — no SPELL_CATEGORIES
 * row and no DR family, so `ccSpellIds` does not hold it; its CC type is
 * `BACKLASH_AURA_CC_TYPE`'s). One test for `castBlockingAuraAt` and
 * `hardCcAuraAt` (codex post-hoc 60-POSTHOC-02 U2: a Priest in its own
 * dispel's horror read as a ready kicker). */
export const isHardCcAura = (auraId: string): boolean =>
  ccSpellIds.has(auraId) || BACKLASH_AURA_CC_TYPE.get(auraId) === "horror";

/** A cast-blocking aura that is a silence and not hard CC: the official DR
 * silence family, or a dispel backlash that is a silence (Unstable
 * Affliction's 196364 — 60-POSTHOC-02 U2: a Shaman under it read as a ready
 * Wind Shear kicker). `silenceIntervals` renders `[SILENCE]` from the
 * official half only — the backlash has its own `[CC ON TEAM] … [DISPEL
 * BACKLASH CC: silence]` line. */
export const isSilenceOnlyAura = (auraId: string): boolean =>
  !isHardCcAura(auraId) &&
  (officialSilenceIds.has(auraId) ||
    BACKLASH_AURA_CC_TYPE.get(auraId) === "silence");

/** An aura whose effect is a silence by any official reading: the silence
 * family above, or the DR Silence category — Solar Beam's 81261, which the log
 * never writes, has only that (codex 20-F15-36: the no-aura reader nominated
 * with it but covered with `silenceIntervals`, so a logged 81261 left the
 * refusal "unexplained"). The no-aura `[SILENCE]` reader nominates, rules out
 * and covers with it; `breakFactScan` solarBeamSilence checks with it. */
export const isSilenceEffectAura = (auraId: string): boolean =>
  isSilenceOnlyAura(auraId) || getDRCategory(auraId) === "Silence";

/** How far past a unit's last aura event a casting lock it never closed is
 * left open for the interval builder to cap at the lock's official length. */
const CASTING_LOCK_OPEN_END_MS = 10 * 60_000;
/** The unit's last logged event of any kind, epoch ms. */
function lastLoggedEventMs(unit: ICombatUnit): number {
  let last = -Infinity;
  for (const stream of [
    unit.auraEvents,
    unit.spellCastEvents,
    unit.damageIn,
    unit.damageOut,
    unit.healIn,
    unit.healOut,
    unit.advancedActions,
  ] as ReadonlyArray<ReadonlyArray<{ timestamp: number }> | undefined>)
    for (const e of stream ?? []) if (e.timestamp > last) last = e.timestamp;
  return last;
}
const castingLockMemo = new WeakMap<
  ICombatUnit,
  Map<string, Array<{ from: number; to: number; spellId: string }>>
>();
/** The casting-lock aura on `unit` at `tMs` for the ability `spellId`
 * (`castingLockIntervalsOf`, read over the unit's whole log), memoised per
 * unit and ability. */
function castingLockAuraAt(
  unit: ICombatUnit,
  tMs: number,
  spellId: string | undefined,
): CastBlockingAura | undefined {
  let byId = castingLockMemo.get(unit);
  if (!byId) {
    byId = new Map();
    castingLockMemo.set(unit, byId);
  }
  const key = spellId ?? "";
  let ivs = byId.get(key);
  if (!ivs) {
    // the unit's own logged span stands in for the round: an aura open
    // before its first event starts there; one never closed runs its
    // official length (codex 21-R12-b #4: an Ice Block that was the mage's
    // last aura event, its REMOVED lost, was capped at that event — a
    // zero-length lock, and the blocked mage read a ready kicker). The span
    // is left open past the last aura event so the builder's cap is the
    // official length; a lock with no official length ends at the unit's
    // last logged event of any kind.
    let first = Infinity;
    let last = -Infinity;
    for (const a of unit.auraEvents ?? []) {
      if (a.timestamp < first) first = a.timestamp;
      if (a.timestamp > last) last = a.timestamp;
    }
    if (Number.isFinite(first)) {
      const openEnd = last + CASTING_LOCK_OPEN_END_MS;
      const lastSeen = lastLoggedEventMs(unit);
      ivs = castingLockIntervalsOf(
        unit,
        { startTime: first, endTime: openEnd },
        spellId,
      ).map((iv) =>
        iv.to >= openEnd ? { ...iv, to: Math.max(iv.from, lastSeen) } : iv,
      );
    } else ivs = [];
    byId.set(key, ivs);
  }
  const iv = ivs.find((x) => x.from <= tMs && tMs < x.to);
  return iv
    ? {
        spellId: iv.spellId,
        spellName: getEnglishSpellName(iv.spellId),
        srcUnitId: unit.id,
        srcUnitName: unit.name,
        from: iv.from,
        to: iv.to,
      }
    : undefined;
}

/**
 * "Could this unit press `spellId` at `tMs`, as far as auras go?" — the
 * cast-blocking aura (`castBlockingAuraIntervals`) that stops it at that
 * instant, or undefined when it was free.
 *
 *  - Hard CC stops everything.
 *  - A silence stops only a cast DB2 marks silenceable (`isSilenceableCast`).
 *    Kick, Pummel, Skull Bash, Rebuke, Disrupt, Counter Shot are not: on 605
 *    S2 files those were cast under a silence aura 31 times, the silenceable
 *    kicks (Counterspell, Wind Shear, Mind Freeze, Strangulate, Solar Beam,
 *    Spell Lock) twice in ~3,900 casts. 6062daf2 @32.7: a Feral Druid inside
 *    Garrote - Silence at cast start is still a kicker. Without `spellId`
 *    every cast-blocking aura counts.
 *  - The AURA half only, on purpose. `buildCannotCastIntervals` also carries
 *    school lockouts with no school on them, and an interrupt is rarely of
 *    the locked school: fa5e6c66's Frost-locked Mage (152.7–154.7) cast an
 *    Arcane Counterspell at 154.25. A kicker under a lockout is still a
 *    kicker.
 *
 * One predicate for "is this enemy's kick usable now": kick-eaten's
 * `kickersInRange` / `nearestKickerDistYd` (triage 2026-09-29 F-K5d) and the
 * `enemy interrupts UP` readers (res-readiness F-C5b). Ask it of the unit
 * that casts the kick — the pet for a pet kick (a Warlock commands Spell
 * Lock while stunned). `hostileIds` = the ids that may have applied the aura
 * (the other side's players and their summons, `enemySourceIds`).
 */
export function castBlockingAuraAt(
  unit: ICombatUnit,
  hostileIds: Set<string>,
  tMs: number,
  spellId?: string,
): CastBlockingAura | undefined {
  const silenceStops = spellId === undefined || isSilenceableCast(spellId);
  // hard CC stops every cast, a silence a silenceable one. An aura of the
  // cast-blocking TYPES that is neither — the lockout aura a kick leaves
  // (Shambling Rush 91807: type "interrupts", not in the official silence
  // category, not CC) — is the lockout half this predicate leaves out, and
  // used to be read as hard CC (pre-review of the batch: a Warrior in Pummel
  // range under 91807 dropped out of `kickersInRange`).
  const held = castBlockingAuraIntervals(unit, hostileIds).find(
    (a) =>
      a.from <= tMs &&
      tMs < a.to &&
      (isHardCcAura(a.spellId) ||
        (silenceStops && isSilenceOnlyAura(a.spellId))),
  );
  if (held) return held;
  // …or an aura that forbids its holder's casting (official `locksCasting`:
  // Ice Block, Dispersion, Bladestorm — with Unrelenting Onslaught's Pummel /
  // Storm Bolt exemption; `castingLockIntervalsOf`, kick-priority's reading).
  // User ruling 2026-10-21 (F16 retest idx 11): a mage in Ice Block is no
  // ready kicker, though the block can be cancelled (0b72c44e 2:01: Vizine
  // 4.6 yd away read as the nearest kicker inside his block).
  const lock = castingLockAuraAt(unit, tMs, spellId);
  if (lock) return lock;
  // …or the unit's own flying breath (work order 2026-10-14d #10: an enemy
  // Evoker inside Deep Breath read as a ready kicker)
  const flight = ownFlightIntervals(unit).find(
    (f) => f.from <= tMs && tMs < f.to,
  );
  return flight
    ? {
        spellId: flight.spellId,
        spellName: getEnglishSpellName(flight.spellId),
        srcUnitId: unit.id,
        srcUnitName: unit.name,
        from: flight.from,
        to: flight.to,
      }
    : undefined;
}

/** The root-like half of the same question for MOVEMENT: the hard CC (never
 * a silence — it does not stop walking) holding `unit` at `tMs`. */
export function hardCcAuraAt(
  unit: ICombatUnit,
  hostileIds: Set<string>,
  tMs: number,
): CastBlockingAura | undefined {
  return castBlockingAuraIntervals(unit, hostileIds).find(
    (a) => a.from <= tMs && tMs < a.to && isHardCcAura(a.spellId),
  );
}

/**
 * Silences on `unit`: the cast-blocking auras (the same predicate as
 * `buildCannotCastIntervals`, which already locks the unit for them) that are
 * in the official DR `silence` category and not hard CC (`ccSpellIds`, which
 * the [CC ON TEAM] / [CC ON ENEMY] lines already render). The official
 * category keeps kick-lockout auras out (Shambling Rush 91807 is mechanic
 * "interrupt": 349 of the first run's 11,625 lines). Round 2 found Garrote -
 * Silence, Strangulate and Spider Venom on the log owner in 4 of 24 matches
 * with no timeline line at all, so the prompt read the healer as free
 * (reliability round 2 W1b).
 */
export function silenceIntervals(
  unit: ICombatUnit,
  enemyIds: Set<string>,
): CastBlockingAura[] {
  return castBlockingAuraIntervals(unit, enemyIds)
    .filter(
      (a) =>
        isSilenceOnlyAura(a.spellId) && !BACKLASH_AURA_CC_TYPE.has(a.spellId),
    )
    .sort((x, y) => x.from - y.from);
}

/**
 * The contiguous runs of the intervals' union, sorted (touching intervals
 * merge). Triage G5: the death-setup `chain` is the CCs of every run that
 * touches the 12 s before the death (crisis-external F-AS1).
 */
export function cannotCastRuns(
  intervals: ReadonlyArray<{ from: number; to: number }>,
): Array<{ from: number; to: number }> {
  const sorted = [...intervals]
    .filter((iv) => iv.to > iv.from)
    .sort((a, b) => a.from - b.from);
  const runs: Array<{ from: number; to: number }> = [];
  for (const iv of sorted) {
    const last = runs[runs.length - 1];
    if (last && iv.from <= last.to) last.to = Math.max(last.to, iv.to);
    else runs.push({ from: iv.from, to: iv.to });
  }
  return runs;
}

/**
 * Triage G5 (crisis-external F-AS1 / death-kill F-S1, reused by cc-dr F-KS1):
 * the lock chain before a death. `runs` = every contiguous cannot-cast run
 * touching [deathMs − lookbackMs, deathMs], not clipped at the window start;
 * `links` = the cast-blocking auras inside those runs that began before the
 * death, in time order (a kick lockout or the unit's own flight counts
 * toward the runs and `lockedMs` but is not a CC to name); `lockedMs` = cannot-cast ms of the window.
 */
export function deathLockChain<
  T extends { from: number; to: number; lockout: boolean; self?: true },
>(
  named: ReadonlyArray<T>,
  deathMs: number,
  lookbackMs: number,
): { runs: Array<{ from: number; to: number }>; links: T[]; lockedMs: number } {
  const winFromMs = deathMs - lookbackMs;
  const runs = cannotCastRuns(named).filter(
    (r) => r.to > winFromMs && r.from < deathMs,
  );
  const links = named
    .filter(
      (iv) =>
        !iv.lockout &&
        // the unit's own flight is locked time, not a CC an enemy put on it
        // (agy 40-FT-85: "[HEALER CC] … ← Deep Breath")
        !iv.self &&
        iv.from < deathMs &&
        runs.some((r) => iv.from < r.to && iv.to > r.from),
    )
    .sort((a, b) => a.from - b.from);
  return { runs, links, lockedMs: coveredMsWithin(named, winFromMs, deathMs) };
}

/**
 * `deathLockChain`'s links as one line of text: links of one cannot-cast run
 * joined by " → " (a repeat of the previous name dropped), and the free time
 * between two runs printed where it falls — `Hex … 4.5s free … Polymorph`.
 * WO6 #4 (n25, 82a2d681): two runs 4.5 s apart read as one unbroken chain.
 */
export function deathLockChainText<T extends { from: number }>(
  chain: {
    runs: ReadonlyArray<{ from: number; to: number }>;
    links: readonly T[];
  },
  nameOf: (link: T) => string,
): string {
  const runOf = (iv: T) =>
    chain.runs.findIndex((r) => iv.from >= r.from && iv.from < r.to);
  let text = "";
  let prev: { name: string; run: number } | undefined;
  for (const iv of chain.links) {
    const name = nameOf(iv);
    const run = runOf(iv);
    if (!prev) text = name;
    // agy 40-FT-99: a link outside every run (not produced by
    // deathLockChain, which keeps only links inside a run) claims no
    // continuity either way
    else if (run < 0 || prev.run < 0) text += ` … ${name}`;
    else if (prev.run !== run) {
      // agy 40-FT-98 #2: a run between the two with no CC in it (a kick's
      // school lockout, the unit's own flight) is locked time, not free
      let freeMs = 0;
      let lockedMs = 0;
      for (let k = prev.run + 1; k <= run; k++) {
        freeMs += chain.runs[k]!.from - chain.runs[k - 1]!.to;
        if (k < run) lockedMs += chain.runs[k]!.to - chain.runs[k]!.from;
      }
      const s1 = (ms: number) => (Math.round(ms / 100) / 10).toFixed(1);
      text +=
        lockedMs > 0
          ? ` … ${s1(freeMs)}s free + ${s1(lockedMs)}s kick lockout / own flight … ${name}`
          : ` … ${s1(freeMs)}s free … ${name}`;
    } else if (prev.name !== name) text += ` → ${name}`;
    prev = { name, run };
  }
  return text;
}

/**
 * Free milliseconds just before `atMs`: `atMs` − the end of the last
 * cannot-cast run that starts before it, 0 when that run covers `atMs`, or
 * undefined when no run starts before it (never a `Math.max` over nothing).
 * Triage G5: death-setup `freeBeforeDeathS` (crisis-external F-D2) and the
 * `[DEFENSIVE AVAILABLE]` "free to press it for the last Ns before the death"
 * (cc-dr F-KS1) — one helper. The interval lists differ since FT-T10:
 * death-setup asks about any cast (every lockout counts), the
 * `[DEFENSIVE AVAILABLE]` line about the spell it names (a lockout on another
 * school does not) — hence the line's "to press it".
 */
export function freeMsBefore(
  intervals: ReadonlyArray<{ from: number; to: number }>,
  atMs: number,
): number | undefined {
  const before = cannotCastRuns(intervals).filter((r) => r.from < atMs);
  const last = before[before.length - 1];
  if (!last) return undefined;
  return last.to >= atMs ? 0 : atMs - last.to;
}

/**
 * Milliseconds of [fromMs, toMs] covered by the union of the intervals
 * (clipped to the window, overlaps merged so a stun inside a silence is not
 * counted twice).
 */
export function coveredMsWithin(
  intervals: ReadonlyArray<{ from: number; to: number }>,
  fromMs: number,
  toMs: number,
): number {
  const clipped: Array<{ from: number; to: number }> = [];
  for (const iv of intervals) {
    const from = Math.max(iv.from, fromMs);
    const to = Math.min(iv.to, toMs);
    if (to > from) clipped.push({ from, to });
  }
  if (clipped.length === 0) return 0;
  clipped.sort((a, b) => a.from - b.from);
  let covered = 0;
  let cur = clipped[0]!;
  for (let i = 1; i < clipped.length; i++) {
    const w = clipped[i]!;
    if (w.from <= cur.to) cur = { from: cur.from, to: Math.max(cur.to, w.to) };
    else {
      covered += cur.to - cur.from;
      cur = w;
    }
  }
  covered += cur.to - cur.from;
  return covered;
}

/**
 * Milliseconds of [fromMs, toMs] outside every interval — the window's length
 * minus `coveredMsWithin`; 0 for an empty or reversed window. The one free-time
 * count behind `couldReactWithin` (a gate) and `actWindowFor().stateIn`'s
 * `freeAfterS` (the fact a gated row prints), so the number a row states is
 * the number its gate compared.
 */
export function freeMsWithin(
  blocked: ReadonlyArray<{ from: number; to: number }>,
  fromMs: number,
  toMs: number,
): number {
  if (toMs <= fromMs) return 0;
  return toMs - fromMs - coveredMsWithin(blocked, fromMs, toMs);
}

/**
 * The one "could this unit react at all in [fromMs, toMs]" test: at least
 * REACTION_WINDOW_S of the window not covered by a cannot-cast interval
 * (`freeMsWithin`). Shared by missed-sync-window's readiness
 * (`evaluateSyncWindow`, B3i) and cd-hoarded's owner gate (reliability round
 * 2 W1a, 2026-09-25) — before this each consumer either computed it inline or
 * did not check at all.
 */
export function couldReactWithin(
  blocked: ReadonlyArray<{ from: number; to: number }>,
  fromMs: number,
  toMs: number,
): boolean {
  return freeMsWithin(blocked, fromMs, toMs) >= REACTION_WINDOW_S * 1000;
}

/**
 * The stricter form for a WINDOW the player is expected to use (an enemy
 * healer's lock): free for at least half of it and never less than
 * REACTION_WINDOW_S. User ruling 2026-09-26 (reliability leftovers, sync-window
 * design question A): an owner stunned for 3 of a 5 s lock with 2.2 s free
 * does not count as able to enter it — `couldReactWithin`'s 1 s is the
 * reaction standard for a crisis response, not for spending a lock.
 */
export function couldActForMostOf(
  blocked: ReadonlyArray<{ from: number; to: number }>,
  fromMs: number,
  toMs: number,
): boolean {
  const span = toMs - fromMs;
  if (span <= 0) return false;
  const freeMs = span - coveredMsWithin(blocked, fromMs, toMs);
  return freeMs >= Math.max(REACTION_WINDOW_S * 1000, span / 2);
}

/**
 * `couldReactWithin` bound to one unit on the round's clock, with death: the
 * window is cut at the unit's first death and at `roundEndMs` (the match end,
 * or a Solo Shuffle round's ending death — time after it is not playable,
 * triage 2026-09-29 H4), and a unit dead before the window could not
 * respond. Arguments are seconds since `matchStartMs`. When the
 * intervals cannot be built the answer is "could respond" — a missing input
 * must never manufacture an exemption silently, but neither may it throw the
 * caller's candidate away (the caller's try/catch would drop the whole type).
 */
export function couldRespondFor(
  unit: ICombatUnit,
  enemyIds: Set<string>,
  matchStartMs: number,
  roundEndMs: number = Infinity,
): (fromS: number, toS: number) => boolean {
  return actWindowFor(unit, enemyIds, matchStartMs, roundEndMs).couldRespond;
}

/** What blocked a unit around an anchor second, and how long it was free. */
export interface ActWindowState {
  /** the cannot-cast intervals overlapping [fromS, toS] cut at death and the
   * round end (the gate's window), seconds since round start, unclipped
   * (`toS` Infinity = never removed), in start order */
  blocks: Array<{
    spellId: string;
    lockout: boolean;
    /** a lockout's locked schools (`NamedCannotCastInterval`) */
    lockedSchoolMask?: number;
    fromS: number;
    toS: number;
  }>;
  /** seconds of (anchorS, toS] — cut at death and the round end, like
   * `couldRespond` — outside every cannot-cast interval; asked for a set of
   * spells, outside every interval that stops ALL of them (the time at
   * least one of them could be pressed, as far as one interval decides it;
   * a spell the unit's pet casts is asked of the pet —
   * `cannotCastIntervalsForSpells`). `blocks` stays the UNIT's own
   * intervals: what sat on a pet is counted here and never named there.
   * The same count as `couldRespond(anchorS, toS, spell)` compares with
   * REACTION_WINDOW_S (`freeMsIn`): asked for one spell over the same span
   * (and the same `onSelf`), the two cannot disagree.
   * With `stunPressable`, a stun is not counted against a spell the game
   * lets a stunned player press (`stunLetsPress`); `blocks` still names it. */
  freeAfterS: number;
  /** the window's end after that cut, seconds since round start (F-H5
   * `windowS` = endS − t) */
  endS: number;
}

/**
 * `couldRespondFor`'s predicate and its explanation from ONE set of inputs
 * (same intervals, same death and round-end cut): `couldRespond` is the owner
 * gate, `stateIn` the fact that says what the gate saw — cd-hoarded's
 * `ownerCc` / `ownerFreeS` (triage 2026-09-29 H1: the gate passes an owner
 * CC'd for most of the window by ruling, and the line then read "held").
 * `stateIn` is null when the intervals cannot be built.
 *
 * Both count free time with one closure (`freeMsIn`: the span cut at death
 * and the round end, minus what the intervals for the spells asked about
 * cover): `couldRespond(fromS, toS, spell)` is `freeAfterS` of
 * `stateIn(…, toS, fromS, [spell])` compared with REACTION_WINDOW_S. A gate
 * that passes on the span its row then prints (cd-hoarded since I05,
 * 2026-10-11: from the crisis second on) can therefore never print less than
 * the threshold it passed.
 *
 * Asked with a spell / spells, both read `cannotCastIntervalsForSpells` —
 * `units` (the round's units) is what lets a spell the unit's pet casts be
 * asked of the pet; without it every spell is the unit's own. The death cut
 * is the unit's, not the pet's.
 *
 * `stunPressable` (I05 option c, user ruling 2026-10-11; cd-hoarded's
 * reader): the unit's PvP talents. When given, the free time — the gate's
 * and the fact's, it is one count — asks of each stun on the unit whether
 * the game lets a stunned player press the spell (`stunLetsPress`): an
 * interval is counted only when it stops EVERY spell asked about, a stun
 * included. Icebound Fortitude under a Shockwave is pressable, so
 * `readyCds=Icebound Fortitude, ownerCc=Shockwave +0.8…+2.8s` reads
 * `ownerFreeS=5.0`, not 3.0 (11346ea9 r1 @51), and an owner stunned for the
 * whole span with Icebound Fortitude in hand could press it — `couldRespond`
 * says so. `onSelf` says the press would land on the unit itself (the
 * owner's own crisis): only then can a school-limited purge count. Asked
 * with no spell, and without `stunPressable`, every aura stops everything,
 * as for every other reader.
 */
export function actWindowFor(
  unit: ICombatUnit,
  enemyIds: Set<string>,
  matchStartMs: number,
  roundEndMs: number = Infinity,
  units?: RoundUnits,
  stunPressable?: { pvpTalentIds: ReadonlySet<string> },
): {
  couldRespond: (
    fromS: number,
    toS: number,
    spellId?: string,
    onSelf?: boolean,
  ) => boolean;
  stateIn: (
    fromS: number,
    toS: number,
    anchorS: number,
    spellIds?: readonly string[],
    onSelf?: boolean,
  ) => ActWindowState | null;
} {
  let named: NamedCannotCastInterval[];
  try {
    named = namedCannotCastIntervals(unit, enemyIds, units);
  } catch {
    return { couldRespond: () => true, stateIn: () => null };
  }
  const deathMs = firstDeathMs(unit);
  const endMs = (toS: number) =>
    Math.min(matchStartMs + toS * 1000, deathMs, roundEndMs);
  // `cannotCastIntervalsForSpells` over the intervals built above, the pet
  // casters resolved once (a missing pet stream must not throw the caller's
  // candidate away: the spells then stay on the unit's own reading)
  let casters: PetCasters | undefined;
  let disarms: NamedCannotCastInterval[] | undefined;
  // the unit's own intervals minus the stuns one of its OWN spells asked
  // about can be pressed through (`stunLetsPress`) — "stops every spell"
  // per spell (codex 20-F15-17): a stun Ice Block can be pressed through
  // still stops Greater Invisibility — the set is free only while ONE of
  // its spells is
  const blocksThrough =
    (through: { onSelf: boolean } | undefined) =>
    (iv: NamedCannotCastInterval, spellId: string): boolean =>
      intervalBlocksSpell(iv, spellId) &&
      !(
        through &&
        stunPressable &&
        stunLetsPress(iv, spellId, {
          pvpTalentIds: stunPressable.pvpTalentIds,
          onSelf: through.onSelf,
        })
      );
  const forSpells = (
    spellIds: readonly string[] | undefined,
    through?: { onSelf: boolean },
  ): NamedCannotCastInterval[] => {
    if (!spellIds?.length) return named;
    try {
      casters ??= petCastersBySpell(unit, units);
      const split = petBlockLists(enemyIds, spellIds, casters, units);
      // work order 2026-10-15 Part 2 (user 「好」): a disarm stops a named
      // weapon-requiring spell here too (cd-hoarded's owner gate read a
      // disarmed Die by the Sword holder as free)
      disarms ??= disarmIntervals(unit, enemyIds);
      return intervalsForSpells(
        [...named, ...disarms],
        split,
        spellIds,
        blocksThrough(through),
      );
    } catch {
      return blockedForEverySpell(named, spellIds, blocksThrough(through));
    }
  };
  // the one free-time count: gate and fact
  const freeMsIn = (
    fromS: number,
    toS: number,
    spellIds: readonly string[] | undefined,
    through?: { onSelf: boolean },
  ): number =>
    freeMsWithin(
      forSpells(spellIds, through),
      matchStartMs + fromS * 1000,
      endMs(toS),
    );
  return {
    couldRespond: (fromS, toS, spellId, onSelf) =>
      freeMsIn(fromS, toS, spellId === undefined ? undefined : [spellId], {
        onSelf: onSelf === true,
      }) >=
      REACTION_WINDOW_S * 1000,
    stateIn: (fromS, toS, anchorS, spellIds, onSelf) => {
      const fromMs = matchStartMs + fromS * 1000;
      // the gate's own window: cut at death and the round end, so a CC that
      // landed after the round was over is never named (agy review of F-H1)
      const toMs = endMs(toS);
      const blocks = named
        .filter((iv) => iv.to > fromMs && iv.from < toMs)
        .sort((a, b) => a.from - b.from)
        .map((iv) => ({
          spellId: iv.spellId,
          lockout: iv.lockout,
          ...(iv.lockedSchoolMask !== undefined
            ? { lockedSchoolMask: iv.lockedSchoolMask }
            : {}),
          fromS: (iv.from - matchStartMs) / 1000,
          toS: (iv.to - matchStartMs) / 1000,
        }));
      return {
        blocks,
        freeAfterS:
          freeMsIn(anchorS, toS, spellIds, { onSelf: onSelf === true }) / 1000,
        endS: (toMs - matchStartMs) / 1000,
      };
    },
  };
}
