import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import {
  getEnglishSpellName,
  OPPRESSING_ROAR_PVP_CC_DURATION_MULT,
  OPPRESSING_ROAR_SPELL_ID,
} from "../data/spellEffectData";
import { SPELL_CATEGORIES } from "../data/spellCategories";
import { dropAuraRebroadcasts } from "./auraIntervals";
import { ccFullDurationForCaster } from "./ccDuration";
import {
  buildCcCategoryHistory,
  drDurationFactor,
  getDRCategory,
  matchPendingCcKey,
  getDRLevelAtTime,
} from "./drAnalysis";

/**
 * CC-break statistics (user request, 2026-08-02). The determination uses no
 * heuristics — the log carries the ground truth: a CC aura's removal event is
 * SPELL_AURA_BROKEN_SPELL (src = **the breaker**, params[11..12] = the
 * breaking spell) or SPELL_AURA_BROKEN (pure melee; ≈0 in modern logs).
 * Corpus baseline (150 matches / 766 combats): 6.14 breaks per combat, 17.5%
 * of all hard-CC windows; the four quadrants split nearly in half — squander
 * (our own damage breaking CC our side put on an enemy) 48.2% vs enemy
 * self-inflicted 46.6%. A "rescue break" is physically almost impossible
 * (friendly damage cannot land on a teammate), so no bucket for it.
 */

export interface ICcBreakEvent {
  /** Moment of the break (seconds, relative). */
  atSeconds: number;
  ccSpellId: string;
  ccSpellName: string;
  /** The holder (who the CC was on). */
  holderName: string;
  holderIsFriendly: boolean;
  /** The caster (who applied the CC). */
  casterName: string;
  /** The breaker (whose damage broke it). */
  breakerName: string;
  breakerIsFriendly: boolean;
  /** Breaking spell; a pure-melee BROKEN event yields an empty id + "Melee". */
  breakSpellId: string;
  breakSpellName: string;
  /** How long the CC actually held. */
  heldSeconds: number;
  /** How much CC time was left: the official full duration
   * (`ccFullDurationSeconds` — DB2 PvP duration, hand fallback only where DB2
   * is blank; 2026-09-02 user ruling "羊本身永远是6秒") scaled by the
   * holder's DR level at that moment (Full = full, 50% = halved) and by
   * Oppressing Roar (+30 % if the debuff was on the holder at application)
   * minus the time already elapsed; no duration known → null (we do not
   * guess). */
  remainingSeconds: number | null;
  isRoot: boolean;
}

export interface ICcBreakStats {
  /** All hard-CC break events (in time order). */
  events: ICcBreakEvent[];
  /** Squandered breaks (teachable): our side broke CC sitting on an enemy,
   * with remaining time ≥ CC_BREAK_REPORT_MIN_REMAINING_S (corpus: a 2s
   * threshold keeps 80%, filtering out inconsequential tail-end breaks). */
  friendlySquander: ICcBreakEvent[];
  /** Enemy self-inflicted breaks (a positive signal): enemy damage broke CC
   * they had applied to one of our teammates. */
  enemySquander: ICcBreakEvent[];
  /** Root break count — kept in its own bucket, never mixed into hard CC (a
   * broken root is often a tactically correct trade, not a mistake to
   * coach). */
  rootBreakCount: number;
}

/** Minimum remaining seconds for a squandered break to enter the "teachable"
 * list (corpus: ≥2s keeps 1810/2266 = 80%). */
export const CC_BREAK_REPORT_MIN_REMAINING_S = 2;

const isCcType = (spellId: string): boolean =>
  SPELL_CATEGORIES[spellId]?.type === "cc";
const isRootType = (spellId: string): boolean =>
  SPELL_CATEGORIES[spellId]?.type === "roots";

/**
 * Scan both sides' units for CC aura break events. The pairing semantics match
 * the corpus mining script: APPLIED records a pending entry
 * (key = spellId:casterId), REFRESH counts as a re-apply, and since the src of
 * BROKEN/BROKEN_SPELL is the breaker the key usually does not match → pair
 * against the earliest pending entry with the same spellId.
 */
/**
 * How much of a CC was left when it ended early: official full duration
 * (`ccFullDurationForCaster`: DB2 PvP duration, caster-aware talents) × DR
 * factor at the apply × Oppressing Roar (+30 % when the debuff was on the
 * holder at application) − time already held. No duration known → null (no
 * guess). The one arithmetic for `[CC BROKEN]` and `[CC REMOVED]` (triage
 * cc-dr F-CR1).
 */
export function ccRemainingSeconds(p: {
  spellId: string;
  holder: ICombatUnit;
  caster: ICombatUnit | undefined;
  applyMs: number;
  endMs: number;
  opponentIds: Set<string>;
  matchStartMs: number;
  roarAtApply: boolean;
}): number | null {
  const baseDuration = ccFullDurationForCaster(p.spellId, p.caster);
  if (baseDuration === undefined) return null;
  const tableDuration =
    baseDuration * (p.roarAtApply ? OPPRESSING_ROAR_PVP_CC_DURATION_MULT : 1);
  const category = getDRCategory(p.spellId);
  let factor = 1;
  if (category) {
    const history = buildCcCategoryHistory(
      p.holder,
      category,
      p.opponentIds,
      p.matchStartMs,
    );
    const level = getDRLevelAtTime(
      history,
      category,
      (p.applyMs - p.matchStartMs) / 1000,
      p.matchStartMs,
    );
    factor = drDurationFactor(level);
  }
  return Math.max(0, tableDuration * factor - (p.endMs - p.applyMs) / 1000);
}

/** Was the Oppressing Roar debuff on `holder` when the CC application
 * `applied` (one of `holder.auraEvents`) landed — the +30 % CC duration
 * `ccRemainingSeconds` applies? Walks the stream up to that event, so a Roar
 * change later in log order at the same timestamp does not count (the
 * application-time state `analyzeCcBreaks` keeps). */
export function oppressingRoarOnAt(
  holder: ICombatUnit,
  applied: ICombatUnit["auraEvents"][number],
): boolean {
  let on = false;
  for (const a of holder.auraEvents) {
    if (a === applied) break;
    if (a.spellId !== OPPRESSING_ROAR_SPELL_ID) continue;
    const ev = a.logLine.event;
    if (
      ev === LogEvent.SPELL_AURA_APPLIED ||
      ev === LogEvent.SPELL_AURA_REFRESH
    )
      on = true;
    else if (ev === LogEvent.SPELL_AURA_REMOVED) on = false;
  }
  return on;
}

export function analyzeCcBreaks(
  friends: ICombatUnit[],
  enemies: ICombatUnit[],
  combat: { startTime: number; endTime: number },
  // Attribute pet breaks to the owner (same as B45): CC broken by Infernal /
  // pet DoTs accounts for ~8% of the squander quadrant; if these are not
  // passed in, those events fall into the "other quadrant" and never reach the
  // list.
  friendlyPets: ICombatUnit[] = [],
  enemyPets: ICombatUnit[] = [],
): ICcBreakStats {
  const friendlyIds = new Set(friends.map((u) => u.id));
  const enemyIds = new Set(enemies.map((u) => u.id));
  const friendlyPetById = new Map(friendlyPets.map((u) => [u.id, u]));
  const enemyPetById = new Map(enemyPets.map((u) => [u.id, u]));
  const playerById = new Map([...friends, ...enemies].map((u) => [u.id, u]));

  const events: ICcBreakEvent[] = [];
  let rootBreakCount = 0;

  for (const holder of [...friends, ...enemies]) {
    const holderIsFriendly = friendlyIds.has(holder.id);
    // The holder's DR history is taken as "applied by the opposing side"
    // (same semantics as the timeline's [DR] annotation)
    const opponentIds = holderIsFriendly ? enemyIds : friendlyIds;

    const pending = new Map<
      string,
      {
        applyMs: number;
        casterId: string;
        casterName: string;
        roarAtApply: boolean;
      }
    >();
    // Oppressing Roar debuff on the holder lengthens every CC applied while it
    // is up (+30 % in PvP, official) — tracked from the holder's own aura
    // stream so the remaining-duration estimate uses the lengthened base.
    let roarActive = false;

    // cc-dr F-RB1: a same-ms re-broadcast is not a break and a new CC
    for (const aura of dropAuraRebroadcasts(holder.auraEvents)) {
      const spellId = aura.spellId;
      if (!spellId) continue;
      const ev = aura.logLine.event;
      if (spellId === OPPRESSING_ROAR_SPELL_ID) {
        if (
          ev === LogEvent.SPELL_AURA_APPLIED ||
          ev === LogEvent.SPELL_AURA_REFRESH
        )
          roarActive = true;
        else if (ev === LogEvent.SPELL_AURA_REMOVED) roarActive = false;
        continue;
      }
      const cc = isCcType(spellId);
      const root = isRootType(spellId);
      if (!cc && !root) continue;
      const key = `${spellId}:${aura.srcUnitId}`;

      if (
        ev === LogEvent.SPELL_AURA_APPLIED ||
        ev === LogEvent.SPELL_AURA_REFRESH
      ) {
        pending.set(key, {
          applyMs: aura.timestamp,
          casterId: aura.srcUnitId,
          casterName: aura.srcUnitName,
          roarAtApply: roarActive,
        });
      } else if (ev === LogEvent.SPELL_AURA_REMOVED) {
        pending.delete(key);
      } else if (
        ev === LogEvent.SPELL_AURA_BROKEN ||
        ev === LogEvent.SPELL_AURA_BROKEN_SPELL
      ) {
        // A BROKEN event's src is the breaker, not the caster → the key
        // usually does not match; the pairing semantics are single-sourced in
        // matchPendingCcKey (same as drAnalysis/ccTrinket).
        const matchKey = matchPendingCcKey(pending, spellId, key);
        if (!matchKey) continue;
        const entry = pending.get(matchKey);
        pending.delete(matchKey);
        if (!entry) continue;

        if (root) {
          rootBreakCount++;
          continue;
        }

        // Pet breaks attributed to the owner: the side comes from the pet's
        // own side, and the display name becomes the owner plus a pet marker
        const asFriendlyPet = friendlyPetById.get(aura.srcUnitId);
        const asEnemyPet = enemyPetById.get(aura.srcUnitId);
        const breakerIsFriendly =
          friendlyIds.has(aura.srcUnitId) || asFriendlyPet !== undefined;
        const pet = asFriendlyPet ?? asEnemyPet;
        const petOwner = pet ? playerById.get(pet.ownerId) : undefined;
        const breakerName = pet
          ? `${petOwner?.name ?? pet.name}(宠物)`
          : aura.srcUnitName;
        const params = aura.logLine.parameters;
        const breakSpellId =
          aura.logLine.event === LogEvent.SPELL_AURA_BROKEN_SPELL
            ? String(params[11] ?? "")
            : "";
        const breakSpellName =
          aura.logLine.event === LogEvent.SPELL_AURA_BROKEN_SPELL
            ? getEnglishSpellName(breakSpellId, String(params[12] ?? ""))
            : "Melee";

        const heldSeconds = (aura.timestamp - entry.applyMs) / 1000;

        const remainingSeconds = ccRemainingSeconds({
          spellId,
          holder,
          caster: playerById.get(entry.casterId),
          applyMs: entry.applyMs,
          endMs: aura.timestamp,
          opponentIds,
          matchStartMs: combat.startTime,
          roarAtApply: entry.roarAtApply,
        });

        events.push({
          atSeconds: (aura.timestamp - combat.startTime) / 1000,
          ccSpellId: spellId,
          ccSpellName: getEnglishSpellName(spellId, aura.spellName),
          holderName: holder.name,
          holderIsFriendly,
          casterName: entry.casterName,
          breakerName,
          breakerIsFriendly,
          breakSpellId,
          breakSpellName,
          heldSeconds,
          remainingSeconds,
          isRoot: false,
        });
      }
    }
  }

  events.sort((a, b) => a.atSeconds - b.atSeconds);

  return {
    events,
    friendlySquander: events.filter(
      (e) =>
        !e.holderIsFriendly &&
        e.breakerIsFriendly &&
        (e.remainingSeconds === null ||
          e.remainingSeconds >= CC_BREAK_REPORT_MIN_REMAINING_S),
    ),
    enemySquander: events.filter(
      (e) => e.holderIsFriendly && !e.breakerIsFriendly,
    ),
    rootBreakCount,
  };
}
