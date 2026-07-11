// packages/shared/src/utils/combatStates.ts
import { AtomicArenaCombat, ICombatUnit, LogEvent } from '@gladlog/parser-compat';

import { getEnglishSpellName } from '../data/spellEffectData';

export interface IFormInterval {
  form: 'Bear' | 'Cat';
  startSeconds: number;
  endSeconds: number;
}

export interface ISpiritOfRedemptionInterval {
  startSeconds: number;
  endSeconds: number;
}

export interface IStasisEvent {
  startSeconds: number;
  releaseSeconds: number;
  spells: string[];
  // Number of spells actually stored, derived from the Stasis aura's stack
  // (dose) removals. Used as a fallback when individual spell names cannot be
  // resolved, so a real release is never rendered as an empty one.
  storedCount: number;
}

export function extractSpiritOfRedemptionIntervals(
  unit: ICombatUnit,
  combat: AtomicArenaCombat,
): ISpiritOfRedemptionInterval[] {
  const intervals: ISpiritOfRedemptionInterval[] = [];
  let ghostStart: number | null = null;

  for (const aura of unit.auraEvents) {
    const isGhost = aura.spellId === '27827' || aura.spellId === '215982' || aura.spellId === '215769';

    if (aura.logLine.event === LogEvent.SPELL_AURA_APPLIED) {
      if (isGhost) {
        ghostStart = aura.logLine.timestamp;
      }
    } else if (aura.logLine.event === LogEvent.SPELL_AURA_REMOVED) {
      if (isGhost && ghostStart !== null) {
        intervals.push({
          startSeconds: (ghostStart - combat.startTime) / 1000,
          endSeconds: (aura.logLine.timestamp - combat.startTime) / 1000,
        });
        ghostStart = null;
      }
    }
  }

  // Handle ghost form held until the end of the match
  if (ghostStart !== null) {
    intervals.push({
      startSeconds: (ghostStart - combat.startTime) / 1000,
      endSeconds: (combat.endTime - combat.startTime) / 1000,
    });
  }

  return intervals;
}

export function extractShapeshiftIntervals(unit: ICombatUnit, combat: AtomicArenaCombat): IFormInterval[] {
  const intervals: IFormInterval[] = [];
  let bearStart: number | null = null;
  let catStart: number | null = null;

  for (const aura of unit.auraEvents) {
    if (!aura.spellName) continue;

    const isBear = aura.spellId === '5487' || aura.spellId === '9634'; // Bear Form, Dire Bear Form
    const isCat = aura.spellId === '768'; // Cat Form

    if (aura.logLine.event === LogEvent.SPELL_AURA_APPLIED) {
      if (isBear) {
        bearStart = aura.logLine.timestamp;
      } else if (isCat) {
        catStart = aura.logLine.timestamp;
      }
    } else if (aura.logLine.event === LogEvent.SPELL_AURA_REMOVED) {
      if (isBear && bearStart !== null) {
        intervals.push({
          form: 'Bear',
          startSeconds: (bearStart - combat.startTime) / 1000,
          endSeconds: (aura.logLine.timestamp - combat.startTime) / 1000,
        });
        bearStart = null;
      } else if (isCat && catStart !== null) {
        intervals.push({
          form: 'Cat',
          startSeconds: (catStart - combat.startTime) / 1000,
          endSeconds: (aura.logLine.timestamp - combat.startTime) / 1000,
        });
        catStart = null;
      }
    }
  }

  // Handle forms held until the end of the match
  if (bearStart !== null) {
    intervals.push({
      form: 'Bear',
      startSeconds: (bearStart - combat.startTime) / 1000,
      endSeconds: (combat.endTime - combat.startTime) / 1000,
    });
  }
  if (catStart !== null) {
    intervals.push({
      form: 'Cat',
      startSeconds: (catStart - combat.startTime) / 1000,
      endSeconds: (combat.endTime - combat.startTime) / 1000,
    });
  }

  return intervals;
}

// Stasis (370537) lets a Preservation Evoker store the next 3 spells they cast,
// then replays them on release. It is a *stacked* aura: applied with charges,
// each stored spell removes a dose (SPELL_AURA_REMOVED_DOSE), and the final
// removal (SPELL_AURA_REMOVED) is the release.
const STASIS_SPELL_ID = '370537';

// Spells Stasis commonly stores for Preservation, used to resolve stored-spell
// NAMES. Off-GCD utility cast during Stasis (e.g. Hover) does NOT consume a
// charge and is not stored, so this stays an allow-list rather than "every
// cast". When a stored spell falls outside this list its name can't be
// resolved — but the dose-derived storedCount still records that the release
// was non-empty (see IStasisEvent.storedCount), so it is never shown as empty.
const STASIS_STORABLE_HEAL_IDS = new Set([
  '355936', // Dream Breath
  '367226', // Spiritbloom
  '366155', // Reversion
  '355913', // Emerald Blossom
  '360995', // Verdant Embrace
  '361469', // Living Flame
  '364343', // Echo
]);

export function extractStasisEvents(unit: ICombatUnit, combat: AtomicArenaCombat): IStasisEvent[] {
  const events: IStasisEvent[] = [];
  let isBuffering = false;
  let startSeconds = 0;
  let bufferedSpells: string[] = [];
  let doseRemovals = 0;
  let lastStasisCastTimestamp = 0;

  // We scan aura events (for boundaries and stored-spell doses) and cast events
  // (for the buffered spell names).
  const mergedEvents = [...unit.auraEvents, ...unit.spellCastEvents]
    .filter(
      (e) =>
        e.logLine.event === LogEvent.SPELL_AURA_APPLIED ||
        e.logLine.event === LogEvent.SPELL_AURA_REMOVED ||
        e.logLine.event === LogEvent.SPELL_AURA_REMOVED_DOSE ||
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS,
    )
    .sort((a, b) => {
      if (a.logLine.timestamp !== b.logLine.timestamp) {
        return a.logLine.timestamp - b.logLine.timestamp;
      }
      // At the same ms: count storage casts and doses before the final removal,
      // so a spell cast at the exact ms Stasis is released is still captured.
      const getPriority = (event: string) => {
        if (event === LogEvent.SPELL_AURA_APPLIED) return 0;
        if (event === LogEvent.SPELL_CAST_SUCCESS) return 1;
        if (event === LogEvent.SPELL_AURA_REMOVED_DOSE) return 2;
        if (event === LogEvent.SPELL_AURA_REMOVED) return 3;
        return 4;
      };
      return getPriority(a.logLine.event) - getPriority(b.logLine.event);
    });

  for (const e of mergedEvents) {
    if (e.spellId === STASIS_SPELL_ID && e.logLine.event === LogEvent.SPELL_CAST_SUCCESS) {
      lastStasisCastTimestamp = e.logLine.timestamp;
    }

    if (e.spellId === STASIS_SPELL_ID && e.logLine.event === LogEvent.SPELL_AURA_APPLIED) {
      isBuffering = true;
      startSeconds = (e.logLine.timestamp - combat.startTime) / 1000;
      bufferedSpells = [];
      doseRemovals = 0;
    } else if (e.spellId === STASIS_SPELL_ID && e.logLine.event === LogEvent.SPELL_AURA_REMOVED && isBuffering) {
      // The final removal is itself one stored-spell consumption when doses preceded it.
      const dosedCount = doseRemovals > 0 ? doseRemovals + 1 : doseRemovals;
      const storedCount = Math.max(bufferedSpells.length, dosedCount);
      // A real release consumes stored stacks, which in the log fire as
      // SPELL_AURA_REMOVED_DOSE before the final removal. Any dose removal therefore
      // proves a genuine release — this captures partial 2-stack releases (1 dose),
      // not just full 3-stack auto-releases, while still excluding expiration/death
      // (no doses). isManualRelease is kept as a defensive fallback for the synthetic
      // case where the release recast shares the removal timestamp.
      const isManualRelease = lastStasisCastTimestamp === e.logLine.timestamp;
      const hasConsumption = doseRemovals > 0;

      if (isManualRelease || hasConsumption) {
        events.push({
          startSeconds,
          releaseSeconds: (e.logLine.timestamp - combat.startTime) / 1000,
          spells: [...bufferedSpells],
          storedCount,
        });
      }
      isBuffering = false;
    } else if (isBuffering && e.spellId === STASIS_SPELL_ID && e.logLine.event === LogEvent.SPELL_AURA_REMOVED_DOSE) {
      doseRemovals += 1;
    } else if (
      isBuffering &&
      e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
      e.spellId &&
      STASIS_STORABLE_HEAL_IDS.has(e.spellId) &&
      bufferedSpells.length < 3
    ) {
      bufferedSpells.push(getEnglishSpellName(e.spellId, e.spellName ?? 'Unknown'));
    }
  }

  return events;
}
