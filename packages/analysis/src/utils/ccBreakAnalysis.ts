import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { SPELL_CATEGORIES } from "../data/spellCategories";
import {
  getEnglishSpellName,
  OPPRESSING_ROAR_AURA_IDS,
  spellEffectData,
} from "../data/spellEffectData";
import { dropAuraRebroadcasts } from "./auraIntervals";
import { breakerOfBrokenRow } from "./brokenRowBreaker";
import { ccFullDurationForApplication } from "./ccDuration";
import {
  buildCcCategoryHistory,
  ccRecastBetween,
  ccRecastSplitsResend,
  drDurationFactor,
  drLevelAtLanding,
  getDRCategory,
  matchPendingCcKey,
  reAppliedIsSameApplication,
} from "./drAnalysis";
import { roundEndMs } from "./roundEnd";

/**
 * CC-break statistics (user request, 2026-08-02). The determination uses no
 * heuristics — the log carries the ground truth: a CC aura's removal event is
 * SPELL_AURA_BROKEN_SPELL (src = **the breaker** — but for the rows that
 * name the holder or a Blessing of Sacrifice's protected ally, see
 * `breakerOfBrokenRow`; params[11..12] = the breaking spell) or SPELL_AURA_BROKEN (pure melee; ≈0 in modern logs).
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
  /** The unit that broke it (`breakerOfBrokenRow`: the row's source as
   * logged, except where the log names the holder for another unit's hit or
   * a Blessing's protected ally for the paladin's own spell) — a pet's break
   * is the pet; `breakerName` above folds it into the owner. */
  breakerUnitId?: string;
  breakerUnitName?: string;
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
 * How much of a CC was left when it ended early: the application's full
 * length (`ccFullDurationForApplication`: DB2 PvP duration, caster-aware
 * talents, × Oppressing Roar's +30 % when the debuff was on the holder at
 * application and covers the CC's mechanic) × DR factor at the apply − time
 * already held. No duration known → null (no guess). The one arithmetic for
 * `[CC BROKEN]` and `[CC REMOVED]` (triage cc-dr F-CR1).
 */
export function ccRemainingSeconds(p: {
  spellId: string;
  holder: ICombatUnit;
  caster: ICombatUnit | undefined;
  applyMs: number;
  endMs: number;
  /** the application's source (its identity in the DR history) */
  srcUnitId?: string;
  matchStartMs: number;
  roarAtApply: boolean;
  /** the CC's possible casters, for the DR history's recast test */
  unitById?: ReadonlyMap<string, ICombatUnit>;
}): number | null {
  const tableDuration = ccFullDurationForApplication(
    p.spellId,
    p.caster,
    p.roarAtApply,
  );
  if (tableDuration === undefined) return null;
  const category = getDRCategory(p.spellId);
  let factor = 1;
  if (category) {
    // the DR this application landed at (Q1, `drLevelAtLanding`) over the
    // holder's whole DR history — fact6 D29: a Sleep Walk reflected back
    // onto the holder was no history while the history read opponents
    // only, and a 50 % Fear printed `5.3s of CC wasted` for 2.3
    const history = buildCcCategoryHistory(
      p.holder,
      category,
      p.matchStartMs,
      p.unitById,
    );
    const level = drLevelAtLanding(history, {
      applyMs: p.applyMs,
      spellId: p.spellId,
      ...(p.srcUnitId !== undefined ? { srcUnitId: p.srcUnitId } : {}),
    });
    factor = drDurationFactor(level);
  }
  return Math.max(0, tableDuration * factor - (p.endMs - p.applyMs) / 1000);
}

/**
 * fact2 R5 (2026-10-20): Oppressing Roar's state along a holder's aura
 * stream — on from an APPLIED / REFRESH, off at its REMOVED, and off at its
 * official end (DB2: 372048, 10 s) when the log never shows the REMOVED
 * (the round-1 R5 rule, `ccAvoidanceBuffsUpAt`). 179b83ac: the rogue
 * Vanished 9 s into a Roar, its REMOVED was never logged, and a Shout 95 s
 * later still read +30 % (`4.4s of CC wasted` for 2.6).
 */
export function oppressingRoarTracker(): {
  step(a: ICombatUnit["auraEvents"][number]): boolean;
  onAt(ms: number): boolean;
} {
  let until = -Infinity;
  return {
    /** feed one aura event; true when it was a Roar row */
    step(a) {
      if (!a.spellId || !OPPRESSING_ROAR_AURA_IDS.has(a.spellId)) return false;
      const ev = a.logLine.event;
      if (
        ev === LogEvent.SPELL_AURA_APPLIED ||
        ev === LogEvent.SPELL_AURA_REFRESH
      ) {
        const dur = spellEffectData[a.spellId]?.durationSeconds;
        until =
          dur !== undefined && dur > 0
            ? a.logLine.timestamp + dur * 1000
            : Infinity;
      } else if (ev === LogEvent.SPELL_AURA_REMOVED) until = -Infinity;
      return true;
    },
    onAt: (ms) => ms <= until,
  };
}

/** Was the Oppressing Roar debuff on `holder` when the CC application
 * `applied` (one of `holder.auraEvents`) landed — the +30 % CC duration
 * `ccRemainingSeconds` applies? Walks the stream up to that event, so a Roar
 * change later in log order at the same timestamp does not count (the
 * application-time state `analyzeCcBreaks` keeps). */
export function oppressingRoarOnAt(
  holder: Pick<ICombatUnit, "auraEvents">,
  applied: ICombatUnit["auraEvents"][number],
): boolean {
  const roar = oppressingRoarTracker();
  for (const a of holder.auraEvents) {
    if (a === applied) break;
    roar.step(a);
  }
  return roar.onAt(applied.logLine.timestamp);
}

/** `oppressingRoarOnAt` for a caller that holds the application's time, not
 * its aura event (`IOutgoingCCApplication`): the APPLIED / REFRESH of
 * `spellId` on `holder` at `applyMs`. No such line → false (nothing to read
 * the Roar against). */
export function oppressingRoarOnAtMs(
  holder: Pick<ICombatUnit, "auraEvents">,
  spellId: string,
  applyMs: number,
): boolean {
  const applied = (holder.auraEvents ?? []).find(
    (a) =>
      a.spellId === spellId &&
      a.timestamp === applyMs &&
      (a.logLine.event === LogEvent.SPELL_AURA_APPLIED ||
        a.logLine.event === LogEvent.SPELL_AURA_REFRESH),
  );
  return applied !== undefined && oppressingRoarOnAt(holder, applied);
}

export function analyzeCcBreaks(
  friends: ICombatUnit[],
  enemies: ICombatUnit[],
  combat: {
    startTime: number;
    endTime: number;
    startInfo?: { bracket?: string };
  },
  // Attribute pet breaks to the owner (same as B45): CC broken by Infernal /
  // pet DoTs accounts for ~8% of the squander quadrant; if these are not
  // passed in, those events fall into the "other quadrant" and never reach the
  // list.
  friendlyPets: ICombatUnit[] = [],
  enemyPets: ICombatUnit[] = [],
): ICcBreakStats {
  const friendlyIds = new Set(friends.map((u) => u.id));
  const friendlyPetById = new Map(friendlyPets.map((u) => [u.id, u]));
  const enemyPetById = new Map(enemyPets.map((u) => [u.id, u]));
  const playerById = new Map([...friends, ...enemies].map((u) => [u.id, u]));
  const unitById = new Map(
    [...friends, ...enemies, ...friendlyPets, ...enemyPets].map((u) => [
      u.id,
      u,
    ]),
  );

  const events: ICcBreakEvent[] = [];
  let rootBreakCount = 0;
  // the round's end (`roundEndMs`: a Solo Shuffle round's ending death):
  // nothing at or after it is in the round (codex R6C-06 #1: a damage tick
  // 0.3 s past the deciding death "broke" a Psychic Scream on the desktop)
  const roundEnd = roundEndMs(combat, [...friends, ...enemies]);

  for (const holder of [...friends, ...enemies]) {
    const holderIsFriendly = friendlyIds.has(holder.id);

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
    const roar = oppressingRoarTracker();

    // cc-dr F-RB1: a same-ms re-broadcast is not a break and a new CC
    // … and a recast its source logged is a new CC (`ccRecastSplitsResend`)
    for (const aura of dropAuraRebroadcasts(
      holder.auraEvents,
      ccRecastSplitsResend(holder.id, holder.auraEvents, (id) =>
        unitById.get(id),
      ),
    )) {
      const spellId = aura.spellId;
      if (!spellId) continue;
      if (aura.timestamp >= roundEnd) continue;
      const ev = aura.logLine.event;
      if (roar.step(aura)) continue;
      const cc = isCcType(spellId);
      const root = isRootType(spellId);
      if (!cc && !root) continue;
      const key = `${spellId}:${aura.srcUnitId}`;

      const open =
        ev === LogEvent.SPELL_AURA_APPLIED ? pending.get(key) : undefined;
      if (open !== undefined) {
        // work order 2026-10-14d #1: an APPLIED while this source's
        // application is still open (no REMOVED / BROKEN) is that
        // application — its start stays — unless recast or past its length
        const src = unitById.get(aura.srcUnitId);
        const owner = src?.ownerId ? unitById.get(src.ownerId) : undefined;
        if (
          reAppliedIsSameApplication(
            open.applyMs,
            aura.timestamp,
            ccFullDurationForApplication(spellId, src, open.roarAtApply) ??
              null,
            ccRecastBetween(
              [src, owner],
              spellId,
              holder.id,
              open.applyMs,
              aura.timestamp,
            ),
          )
        )
          continue;
      }
      if (
        ev === LogEvent.SPELL_AURA_APPLIED ||
        ev === LogEvent.SPELL_AURA_REFRESH
      ) {
        pending.set(key, {
          applyMs: aura.timestamp,
          casterId: aura.srcUnitId,
          casterName: aura.srcUnitName,
          roarAtApply: roar.onAt(aura.timestamp),
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

        // The breaker: the row's source, except where the log names the
        // holder for another unit's hit or a Blessing's protected ally for
        // the paladin's own spell (`breakerOfBrokenRow`, fact1215 R4 / C4)
        const by =
          aura.logLine.event === LogEvent.SPELL_AURA_BROKEN_SPELL
            ? breakerOfBrokenRow(holder, aura)
            : undefined;
        const breakerId = by?.unitId ?? aura.srcUnitId;
        const breakerRowName = by?.name ?? aura.srcUnitName;
        // Pet breaks attributed to the owner: the side comes from the pet's
        // own side, and the display name becomes the owner plus a pet marker
        const asFriendlyPet = friendlyPetById.get(breakerId);
        const asEnemyPet = enemyPetById.get(breakerId);
        const breakerIsFriendly =
          friendlyIds.has(breakerId) || asFriendlyPet !== undefined;
        const pet = asFriendlyPet ?? asEnemyPet;
        const petOwner = pet ? playerById.get(pet.ownerId) : undefined;
        const breakerName = pet
          ? `${petOwner?.name ?? pet.name}(宠物)`
          : breakerRowName;
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
          srcUnitId: entry.casterId,
          matchStartMs: combat.startTime,
          roarAtApply: entry.roarAtApply,
          unitById,
        });

        events.push({
          atSeconds: (aura.timestamp - combat.startTime) / 1000,
          ccSpellId: spellId,
          ccSpellName: getEnglishSpellName(spellId, aura.spellName),
          holderName: holder.name,
          holderIsFriendly,
          casterName: entry.casterName,
          breakerName,
          breakerUnitId: breakerId,
          breakerUnitName: breakerRowName,
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
