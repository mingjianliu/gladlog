/**
 * Enemy defensives — the ONE predicate for "which enemy abilities count as a
 * real defensive", shared by the KILL ATTEMPTS attribution
 * (`killAttempts.ts`: `popped X` / `saved by external (X)`) and the timeline's
 * `[ENEMY DEF]` lines (`context/matchTimeline.ts`), so the summary block and
 * the timeline can never disagree about what a wall is (CLAUDE.md
 * Shared-Predicate Rule; GH #97, 2026-09-15). The sets lived as module-private
 * consts in killAttempts.ts before this file.
 */
import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { wallDoorPct } from "../data/mitigationComponents";
import {
  MITIGATION_TABLE,
  NO_MITIGATION_IDS,
  SELF_WALL_AURA_TO_CAST_ID,
} from "../data/mitigationData";
import { getEnglishSpellName } from "../data/spellEffectData";
import spellIdListsData, {
  ENEMY_AREA_SAVE_IDS,
  ENEMY_HEAL_SAVE_IDS,
  ENEMY_IMMUNITY_EXTERNAL_CASTS,
  ENEMY_IMMUNITY_HEAL_PROCS,
  ENEMY_IMMUNITY_SAVE_AURAS,
  ENEMY_REDIRECT_SAVE_IDS,
  ENEMY_SELF_SAVE_ONLY_IDS,
} from "../data/spellIdLists";
import { buildAuraIntervals, type IAuraInterval } from "./auraIntervals";
import { buffFullDurationForCaster } from "./buffDuration";
import { AURA_ONLY_ACTIVATION_IDS } from "./cooldowns";

export const EXTERNAL_DEF_IDS = new Set<string>(
  (spellIdListsData as unknown as { externalDefensiveSpellIds?: string[] })
    .externalDefensiveSpellIds ?? [],
);

/** Immunities in the official table are recorded as pct 100 (spec decision in
 * mitigationData.ts). Baiting one out is a WIN per the user ruling ("冰箱圣盾
 * 不管,交了也算我们赚") — so it is its own attribution, never a reproach. */
export const IMMUNITY_IDS = new Set<string>(
  Object.entries(MITIGATION_TABLE)
    .filter(([, e]) => e.pct === 100)
    .map(([id]) => id),
);

/** Every damage school (`IMitigationEntry.schoolMask`). */
const EVERY_SCHOOL_MASK = 0x7f;

/** The pct-100 rows that stop EVERY school — Ice Block, Divine Shield, Aspect
 * of the Turtle: under one the unit takes no damage at all.
 *
 * User ruling F-K9b-B (2026-10-02): `IMMUNITY_IDS` is split in two and a
 * reader that asks "can this unit be hurt right now" reads only this half —
 * kick-eaten's low-HP skip and the stayed-in skip of position-mistake import
 * the same two sets, so there is one answer. Derived from the signed table,
 * so a new pct-100 row falls on one side by its mask
 * (`test/immunityTables.test.ts` pins both halves, and their keys against
 * `deathOutcomeAnalysis.IMMUNITY_SPELLS`).
 * Interim: enemy-def F-E24 (ruling A30: a school-limited immunity counts as
 * full when >= 50 % of the incoming damage is of the school it stops) is the
 * finer rule; whether these two readers move to it is decided when it lands. */
export const FULL_IMMUNITY_IDS: ReadonlySet<string> = new Set(
  Object.entries(MITIGATION_TABLE)
    .filter(
      ([, e]) =>
        e.pct === 100 &&
        (e.schoolMask & EVERY_SCHOOL_MASK) === EVERY_SCHOOL_MASK,
    )
    .map(([id]) => id),
);

/** The pct-100 rows that stop one kind of damage only — Blessing of
 * Protection (physical), Blessing of Spellwarding and Cloak of Shadows
 * (magic). A unit under one can still be hurt, and killed, by the other
 * kind. `IMMUNITY_IDS` = this ∪ `FULL_IMMUNITY_IDS`. */
export const SCHOOL_LIMITED_IMMUNITY_IDS: ReadonlySet<string> = new Set(
  [...IMMUNITY_IDS].filter((id) => !FULL_IMMUNITY_IDS.has(id)),
);

/** Feign Death's cast id. Its success is never logged; the ledger reads the
 * press from the aura(s) `AURA_ONLY_ACTIVATION_IDS` lists for it (Survival
 * Tactics 202748), and so does this file — one table for "a Feign Death
 * happened". Hunters without that PvP talent leave only `UNIT_DIED …
 * unconscious=1`, which parser-compat does not carry to the analysis units. */
const FEIGN_DEATH_CAST_ID = "5384";

/** Enemy-def F-E5 / F-E6 (user ruling A25, 2026-09-30): auras the `[ENEMY
 * DEF]` line prints as `immune` and KILL ATTEMPTS reads as "forced a full
 * immunity" although they are no pct-100 `MITIGATION_TABLE` row — the unit
 * cannot be hit (Burrow, Time Stop, Mass Invisibility, Vanish, Feign Death) or
 * a lethal hit was refused (Cheat Death, Cauterize). Logged aura id → the
 * ability name to print. `IMMUNITY_IDS` stays the pct-100 slice: other
 * predicates read it as exactly that. */
export const IMMUNITY_SAVE_AURA_NAMES: ReadonlyMap<string, string> = new Map([
  ...Object.entries(ENEMY_IMMUNITY_SAVE_AURAS),
  ...(AURA_ONLY_ACTIVATION_IDS[FEIGN_DEATH_CAST_ID] ?? []).map(
    (auraId): [string, string] => [auraId, "Feign Death"],
  ),
]);

/** Is this aura an immunity for the enemy-save predicate — a pct-100 table
 * row or an immunity-kind save. The one test the `[ENEMY DEF]` aura loop and
 * the KILL ATTEMPTS `immunity-baited` attribution share. */
export function isImmunitySaveAura(spellId: string): boolean {
  return IMMUNITY_IDS.has(spellId) || IMMUNITY_SAVE_AURA_NAMES.has(spellId);
}

/** The unit's immunity-kind saves that leave no aura — a heal proc on itself
 * (Nature's Guardian), in log order, seconds from match start. */
export function immunityProcHeals(
  unit: ICombatUnit,
  matchStartMs: number,
): Array<{ atSeconds: number; spellId: string; spellName: string }> {
  const out: Array<{ atSeconds: number; spellId: string; spellName: string }> =
    [];
  for (const h of unit.healIn ?? []) {
    const name = h.spellId ? ENEMY_IMMUNITY_HEAL_PROCS[h.spellId] : undefined;
    if (!name || h.srcUnitId !== unit.id) continue;
    out.push({
      atSeconds: (h.logLine.timestamp - matchStartMs) / 1000,
      spellId: h.spellId!,
      spellName: name,
    });
  }
  return out;
}

/** When `unit` carried a FULL immunity (`FULL_IMMUNITY_IDS`), seconds since
 * the match start, from the shared aura pairing. For readers that must not
 * treat an immune unit's HP as pressure (kick-eaten's `ourLow*` /
 * `theirLow*`). A school-limited immunity is not in it (ruling F-K9b-B): a
 * Rogue at 12 % inside Cloak of Shadows still dies to physical damage
 * (cb6f3e66 @79.5). */
export function fullImmunityIntervals(
  unit: ICombatUnit,
  combat: Parameters<typeof buildAuraIntervals>[1],
): Array<{ spellId: string; fromS: number; toS: number }> {
  return buildAuraIntervals(unit, combat)
    .filter((iv) => FULL_IMMUNITY_IDS.has(iv.spellId))
    .map((iv) => ({ spellId: iv.spellId, fromS: iv.fromS, toS: iv.toS }));
}

/** A unit's OWN full immunity: a `FULL_IMMUNITY_IDS` aura the unit put on
 * itself — the POSITIONING skip rule's test (the owner inside their own Ice
 * Block had nothing to kite from; user ruling 2026-09-30, A′13 = C).
 *
 * It reads the shared FULL half (user ruling F-K9b-B, 2026-10-02 — the same
 * names kick-eaten's low-HP skip imports), so two things are out:
 *  - a SCHOOL-LIMITED immunity (`SCHOOL_LIMITED_IMMUNITY_IDS`): a Cloak of
 *    Shadows under a physical burst blocks nothing — on the 605-file slice
 *    three Rogues inside their own Cloak fell to 34 %, 23 % and 32 %. The
 *    finer rule (enemy-def F-E24, ruling A30) is decided when it lands;
 *  - the immunity-kind saves `isImmunitySaveAura` adds for `[ENEMY DEF]`
 *    kind="immune" (Vanish, Feign Death, Cheat Death, Cauterize, … —
 *    enemy-def F-E5 / F-E6): a unit under Cauterize can still move. */
export function isOwnImmunityInterval(
  unit: Pick<ICombatUnit, "name">,
  iv: { spellId: string; srcUnitName: string },
): boolean {
  return iv.srcUnitName === unit.name && FULL_IMMUNITY_IDS.has(iv.spellId);
}

/** Floor for "a real defensive": the same 20 % door as the kill-opportunity
 * gated tier (WALL_IN_HAND_MIT_IDS). Applied twice — to the table value when
 * building MITIGATION_AURA_IDS, and again per aura through `resolveMitigation`
 * so a talent-shared copy on an ally (Obsidian Scales 15 %) does not count as
 * the target having popped a 30 % wall. */
export const MITIGATION_AURA_MIN_PCT = 20;

/** 20–99% self-mitigation aura ids (the non-immune official table slice) —
 * "the target popped a real defensive during the attempt". */
export const MITIGATION_AURA_IDS = new Set<string>(
  Object.entries(MITIGATION_TABLE)
    .filter(([, e]) => e.pct >= MITIGATION_AURA_MIN_PCT && e.pct < 100)
    .map(([id]) => id),
);

/** The `MITIGATION_TABLE` key behind an aura found on a unit: the aura id
 * itself, or — for a wall whose row is keyed by its cast (Blur 198589 logs
 * aura 212800, Greater Invisibility 110959 logs 110960) — that cast id.
 * Enemy-def F-E1a: the `[ENEMY DEF]` aura loop and the KILL ATTEMPTS `popped
 * X` test both resolve an aura through this before asking any wall set. */
export function wallTableIdOfAura(auraSpellId: string): string {
  return SELF_WALL_AURA_TO_CAST_ID[auraSpellId] ?? auraSpellId;
}

/** An external save: a cast that helps the ALLY it is cast on. The friendly
 * roster (`EXTERNAL_DEF_IDS`) plus the enemy-only sets — instant heals (Lay on
 * Hands; enemy-def F-E4), grips / redirects (Leap of Faith, Intervene, Roar
 * of Sacrifice, Master's Call; F-E9, rulings A20 + U3) and the casts that put
 * an immunity on an ally (Guardian of the Forgotten Queen, Time Stop). One
 * test for the `[ENEMY DEF]` external branch, the KILL ATTEMPTS
 * `saved by external (X)` attribution and `selfSaveCasts`' "on an ally it is
 * an external, not a self-save" rule. */
export function isExternalSaveId(spellId: string): boolean {
  return (
    EXTERNAL_DEF_IDS.has(spellId) ||
    ENEMY_HEAL_SAVE_IDS.has(spellId) ||
    ENEMY_REDIRECT_SAVE_IDS.has(spellId) ||
    spellId in ENEMY_IMMUNITY_EXTERNAL_CASTS
  );
}

/** Reliability audit B4a (2026-09-25): an enemy's own save that carries no
 * percentage mitigation — Guardian Spirit on itself, Desperate Prayer, Touch
 * of Karma, Renewing Blaze, Life Cocoon on itself, Rallying Cry, Zephyr — the
 * product's "major" lists (external ∪ big defensive) ∩ `NO_MITIGATION_IDS`.
 * Neither the mitigation-aura test nor the external branch saw these, so a
 * kill attempt the target survived with one was attributed "not enough
 * damage" (a9bc48b5 @2:14: the priest's self Guardian Spirit at 2:16 and
 * Desperate Prayer at 2:20). Both lists are already registered in
 * curatedIdRegistry.
 *
 * Triage 2026-09-29 (enemy-def F-E7 / F-E4 / F-E9; rulings A11, A20): plus the
 * enemy-only sets of `data/spellIdLists.ts` — absorb / heal / avoidance saves
 * outside the major lists (Dark Pact, Evasion, Healthstone, Ice Barrier …),
 * and the ally-castable heals and redirects when cast on oneself (Lay on
 * Hands, Roar of Sacrifice, Master's Call). a0a48716: Death Pact at 1:39 and
 * Lichborne at 1:41 had no line; ae9d6fbc: "Dark Pact" 0 times in the prompt. */
export const SELF_SAVE_IDS: ReadonlySet<string> = new Set<string>([
  ...[
    ...EXTERNAL_DEF_IDS,
    ...(
      (spellIdListsData as unknown as { bigDefensiveSpellIds?: string[] })
        .bigDefensiveSpellIds ?? []
    ).map(String),
  ].filter((id) => NO_MITIGATION_IDS.has(id)),
  ...ENEMY_SELF_SAVE_ONLY_IDS,
  ...ENEMY_HEAL_SAVE_IDS,
  ...ENEMY_REDIRECT_SAVE_IDS,
]);

/** The enemy's own presses of a `SELF_SAVE_IDS` save on itself, in cast
 * order (seconds from match start). An external-capable one (Guardian
 * Spirit, Life Cocoon, Lay on Hands, Roar of Sacrifice) counts only when its
 * cast target is the caster — cast on an ally it is an external, which the
 * external branch already reports. */
export function selfSaveCasts(
  enemy: ICombatUnit,
  matchStartMs: number,
): Array<{ atSeconds: number; spellId: string; spellName: string }> {
  const out: Array<{ atSeconds: number; spellId: string; spellName: string }> =
    [];
  for (const cast of enemy.spellCastEvents ?? []) {
    if (cast.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
    if (!cast.spellId || !SELF_SAVE_IDS.has(cast.spellId)) continue;
    if (isExternalSaveId(cast.spellId) && cast.destUnitId !== enemy.id)
      continue;
    out.push({
      atSeconds: (cast.logLine.timestamp - matchStartMs) / 1000,
      spellId: cast.spellId,
      spellName: getEnglishSpellName(cast.spellId, cast.spellName),
    });
  }
  return out;
}

/** How close to an aura's start its cast is logged, either side. The same
 * pairing radius the external branch uses to tie a cast to its aura. */
const CAST_AURA_PAIR_S = 1.5;

/**
 * Enemy-def F-E12: a second `SPELL_AURA_APPLIED` of an aura that is still up,
 * with no `REMOVED` between, is the game re-announcing ONE press — not the
 * first one ending and a new one starting. `buildAuraIntervals` splits there
 * (its anti-artifact rule for a missed REMOVED followed by a real recast), so
 * the `[ENEMY DEF]` line read one Divine Shield as `(immune, 0.9s)` +
 * `(immune, 7.1s)` (f4eb8c87 2:47), one Guardian Spirit as `(1.6s)` +
 * `(10.4s — removed early)` (69546267 2:05), one Feign Death as three.
 *
 * Joined here, at the `[ENEMY DEF]` layer, because `buildAuraIntervals` has
 * many consumers with their own reading of a re-apply. Two back-to-back
 * intervals of one spell from one source are the same press unless the source
 * logged a SECOND cast of that spell around them: a split with at most one
 * cast behind it (the one that opened the first interval, or none for an
 * aura that is never cast) is one press.
 */
export function joinReappliedIntervals(
  intervals: readonly IAuraInterval[],
  /** round seconds of the source's SPELL_CAST_SUCCESS of `spellId` */
  castSecondsOf: (srcUnitName: string, spellId: string) => readonly number[],
): IAuraInterval[] {
  const out: IAuraInterval[] = [];
  const lastOf = new Map<string, IAuraInterval>();
  for (const iv of intervals) {
    const key = `${iv.spellId}:${iv.srcUnitName}`;
    const prev = lastOf.get(key);
    if (
      prev &&
      prev.inferredEnd &&
      Math.abs(prev.toS - iv.fromS) < 1e-6 &&
      castSecondsOf(iv.srcUnitName, iv.spellId).filter(
        (t) =>
          t >= prev.fromS - CAST_AURA_PAIR_S &&
          t <= iv.fromS + CAST_AURA_PAIR_S,
      ).length <= 1
    ) {
      prev.toS = iv.toS;
      prev.inferredEnd = iv.inferredEnd;
      continue;
    }
    const copy = { ...iv };
    out.push(copy);
    lastOf.set(key, copy);
  }
  return out;
}

/** An observed aura ended this much before its full duration → "removed
 * early" (dispelled, broken by damage/immunity rules, or cancelled). One
 * second of slack absorbs the log's aura-event jitter. */
export const REMOVED_EARLY_SLACK_S = 1;

export interface IEnemyDefensiveEvent {
  atSeconds: number;
  spellId: string;
  spellName: string;
  /** the enemy who pressed it */
  casterName: string;
  /** "self" = a wall on the caster (pct < 100); "immune" = pct 100; "external" = cast on another enemy; "self-save" = the caster's own no-%-mitigation save (`SELF_SAVE_IDS`); "area" = an area save anchored on its cast (`ENEMY_AREA_SAVE_IDS`): who pressed it and when, nothing else */
  kind: "self" | "immune" | "external" | "self-save" | "area";
  /** official mitigation pct (self / immune); undefined for externals and for an immunity-kind save, which has no table row */
  pct?: number;
  /** who received an external */
  recipientName?: string;
  recipientId?: string;
  /** observed aura duration in seconds (from the aura interval); undefined when no interval could be paired */
  observedSeconds?: number;
  /** The paired aura interval of an external, so the `[ENEMY DEF]` line can
   * compute what the attackers did during it (GH #91,
   * `externalDamageForApplication`). Undefined when no interval was paired. */
  auraFromS?: number;
  auraToS?: number;
  auraInferredStart?: boolean;
  auraInferredEnd?: boolean;
  auraSrcName?: string;
  /** observed duration fell short of the caster's full duration by more than the slack */
  removedEarly: boolean;
}

/**
 * Every defensive an enemy unit pressed this round, in cast order — the
 * events the `[ENEMY DEF]` line renders. Self-mitigation and immunities come
 * from the enemy's OWN aura intervals (source = the enemy itself, so a
 * talent-shared copy applied by an ally is not "the target popped a wall");
 * externals from SPELL_CAST_SUCCESS onto another enemy, paired with the
 * recipient's aura interval when one starts within 1.5 s of the cast — plus
 * externals seen only as the recipient's aura (cast event missing from the log).
 */
export function enemyDefensiveEvents(
  enemy: ICombatUnit,
  enemies: ICombatUnit[],
  combat: { startTime: number; endTime: number },
): IEnemyDefensiveEvent[] {
  const out: IEnemyDefensiveEvent[] = [];
  const intervalsByUnit = new Map<string, IAuraInterval[]>();
  // The aura's source is looked up among the enemies: a talent-lengthened
  // duration caps an unclosed aura, and the re-apply join reads the source's
  // casts (F-E12).
  const castersById = new Map(enemies.map((e) => [e.id, e]));
  const castSecondsOf = (srcUnitName: string, spellId: string): number[] =>
    (enemies.find((e) => e.name === srcUnitName)?.spellCastEvents ?? [])
      .filter(
        (c) =>
          c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
          c.spellId === spellId,
      )
      .map((c) => (c.logLine.timestamp - combat.startTime) / 1000);
  const intervalsOf = (u: ICombatUnit) => {
    let iv = intervalsByUnit.get(u.id);
    if (!iv) {
      iv = joinReappliedIntervals(
        buildAuraIntervals(u, combat, castersById),
        castSecondsOf,
      );
      intervalsByUnit.set(u.id, iv);
    }
    return iv;
  };
  const removedEarly = (spellId: string, observed: number): boolean => {
    const full = buffFullDurationForCaster(spellId, enemy);
    return full !== undefined && observed < full - REMOVED_EARLY_SLACK_S;
  };

  for (const iv of intervalsOf(enemy)) {
    if (iv.srcUnitName !== enemy.name) continue;
    const immune = isImmunitySaveAura(iv.spellId);
    const tableId = wallTableIdOfAura(iv.spellId);
    if (!immune && !MITIGATION_AURA_IDS.has(tableId)) continue;
    const observed = iv.toS - iv.fromS;
    const saveName = IMMUNITY_SAVE_AURA_NAMES.get(iv.spellId);
    out.push({
      atSeconds: iv.fromS,
      spellId: iv.spellId,
      spellName: saveName ?? getEnglishSpellName(iv.spellId, iv.spellName),
      casterName: enemy.name,
      kind: immune ? "immune" : "self",
      // Priced through the one pricing path (predicate index: "the mitigation
      // % an aura is worth on the unit that carries it"), with the caster's
      // talents — the number burst-into-mitigation's door reads for the same
      // aura. The raw table value printed Barkskin 20 % while the candidate
      // priced it 30 % (GH #114). An immunity-kind save has no table row, so
      // no pct — the line prints `immune` for it.
      pct: wallDoorPct(tableId, { carrierIsCaster: true, caster: enemy }),
      observedSeconds: observed,
      removedEarly: !iv.inferredEnd && removedEarly(iv.spellId, observed),
    });
  }

  // F-E5: an immunity-kind save with no aura (Nature's Guardian's heal).
  for (const h of immunityProcHeals(enemy, combat.startTime)) {
    out.push({
      atSeconds: h.atSeconds,
      spellId: h.spellId,
      spellName: h.spellName,
      casterName: enemy.name,
      kind: "immune",
      removedEarly: false,
    });
  }

  for (const cast of enemy.spellCastEvents ?? []) {
    if (cast.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
    if (!cast.spellId || !isExternalSaveId(cast.spellId)) continue;
    const atSeconds = (cast.logLine.timestamp - combat.startTime) / 1000;
    // F-E1b / F-A1b (ruling A15): an area save is anchored on the cast — its
    // aura names no source (Anti-Magic Zone), is never applied (Darkness) or
    // lands on the whole team (Rallying Cry).
    if (ENEMY_AREA_SAVE_IDS.has(cast.spellId)) {
      out.push({
        atSeconds,
        spellId: cast.spellId,
        spellName: getEnglishSpellName(cast.spellId, cast.spellName),
        casterName: enemy.name,
        kind: "area",
        removedEarly: false,
      });
      continue;
    }
    // F-E6: an immunity the caster's summon applies (Guardian of the
    // Forgotten Queen: cast 228049, aura 228050 from the guardian). Cast on
    // an ally it is an external timed by that aura; cast on oneself the aura
    // loop above cannot see it (its source is the guardian), so it is emitted
    // here as the caster's own immunity.
    const immunityAuraId = ENEMY_IMMUNITY_EXTERNAL_CASTS[cast.spellId];
    if (immunityAuraId !== undefined && cast.destUnitId === enemy.id) {
      const own = intervalsOf(enemy).find(
        (iv) =>
          iv.spellId === immunityAuraId &&
          iv.srcUnitName !== enemy.name &&
          Math.abs(iv.fromS - atSeconds) <= 1.5,
      );
      if (own) {
        const observed = own.toS - own.fromS;
        out.push({
          atSeconds,
          spellId: cast.spellId,
          spellName: getEnglishSpellName(cast.spellId, cast.spellName),
          casterName: enemy.name,
          kind: "immune",
          observedSeconds: observed,
          removedEarly:
            !own.inferredEnd && removedEarly(immunityAuraId, observed),
        });
      }
      continue;
    }
    const recipient = enemies.find(
      (e) => e.id === cast.destUnitId && e.id !== enemy.id,
    );
    if (!recipient) continue;
    // A grip / redirect is the move itself: its aura (Leap of Faith's is
    // ~1 s) is no buff with a duration to report or to call "removed early",
    // and nothing was "done during it" (rulings A20 + U3; CROSS-THEME §3).
    const pairedAuraId = immunityAuraId ?? cast.spellId;
    const paired = ENEMY_REDIRECT_SAVE_IDS.has(cast.spellId)
      ? undefined
      : intervalsOf(recipient).find(
          (iv) =>
            iv.spellId === pairedAuraId &&
            Math.abs(iv.fromS - atSeconds) <= 1.5,
        );
    const observed = paired ? paired.toS - paired.fromS : undefined;
    out.push({
      atSeconds,
      spellId: cast.spellId,
      spellName: getEnglishSpellName(cast.spellId, cast.spellName),
      casterName: enemy.name,
      kind: "external",
      recipientId: recipient.id,
      recipientName: recipient.name,
      observedSeconds: observed,
      // The during-it measurement is defined for mitigation externals; an
      // immunity put on an ally reports its duration only.
      ...(paired && immunityAuraId === undefined
        ? {
            auraFromS: paired.fromS,
            auraToS: paired.toS,
            auraInferredStart: paired.inferredStart,
            auraInferredEnd: paired.inferredEnd,
            auraSrcName: paired.srcUnitName,
          }
        : {}),
      removedEarly:
        paired !== undefined &&
        !paired.inferredEnd &&
        observed !== undefined &&
        removedEarly(pairedAuraId, observed),
    });
  }

  // B4a (2026-09-25): the caster's own no-%-mitigation saves.
  for (const c of selfSaveCasts(enemy, combat.startTime)) {
    out.push({
      atSeconds: c.atSeconds,
      spellId: c.spellId,
      spellName: c.spellName,
      casterName: enemy.name,
      kind: "self-save",
      removedEarly: false,
    });
  }

  // Aura-only externals (GH #103 class F, match 44f529e3): the log can carry the
  // recipient's SPELL_AURA_APPLIED without the caster's SPELL_CAST_SUCCESS
  // (Ironbark on an ally at 0:09, cast event absent — the caster was outside
  // the recorder's logging range). KILL ATTEMPTS reads the aura and said
  // "popped Ironbark" while no [ENEMY DEF] line existed for it. The aura is
  // the evidence both sides can see, so an external interval this enemy
  // applied to an ally with no cast already paired to it becomes an event too.
  // Intervals whose start was inferred (up before the log saw it) are skipped
  // — KILL ATTEMPTS only counts SPELL_AURA_APPLIED, and so does this.
  for (const mate of enemies) {
    if (mate.id === enemy.id) continue;
    for (const iv of intervalsOf(mate)) {
      if (iv.srcUnitName !== enemy.name) continue;
      if (!EXTERNAL_DEF_IDS.has(iv.spellId) || iv.inferredStart) continue;
      const paired = out.some(
        (d) =>
          d.kind === "external" &&
          d.recipientId === mate.id &&
          d.spellId === iv.spellId &&
          Math.abs((d.auraFromS ?? d.atSeconds) - iv.fromS) <= 1.5,
      );
      if (paired) continue;
      const observed = iv.toS - iv.fromS;
      out.push({
        atSeconds: iv.fromS,
        spellId: iv.spellId,
        spellName: getEnglishSpellName(iv.spellId, iv.spellName),
        casterName: enemy.name,
        kind: "external",
        recipientId: mate.id,
        recipientName: mate.name,
        observedSeconds: observed,
        auraFromS: iv.fromS,
        auraToS: iv.toS,
        auraInferredStart: iv.inferredStart,
        auraInferredEnd: iv.inferredEnd,
        auraSrcName: iv.srcUnitName,
        removedEarly: !iv.inferredEnd && removedEarly(iv.spellId, observed),
      });
    }
  }

  return out.sort((a, b) => a.atSeconds - b.atSeconds);
}
