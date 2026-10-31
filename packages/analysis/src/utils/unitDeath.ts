/**
 * unitDeath.ts — "is this unit dead at t", one predicate (CLAUDE.md
 * shared-predicate rule; docs/predicate-index.md "Whether a unit is dead at
 * an instant").
 *
 * A leaf module on purpose: its readers sit on both sides of the import graph
 * (`cannotCastIntervals` / `ccTrinketAnalysis` below, `positionAnalysis` /
 * `killWindowFacts` / the candidate mappers above), and the helper used to
 * live in `positionAnalysis.ts`, which the lower half cannot import.
 *
 * Triage 2026-09-29, group G4: a dead player holds no cooldown, presses no
 * button and kicks nobody — sync-burst F-S1 / F-KW2, res-readiness F-C4 /
 * F-C5, kick-eaten F-K7e and cd-hoarded F-H4 / F-H5 all ask this question and
 * each used to answer it (or not ask it) on its own.
 *
 * The companion on the RENDER GRID is `isDeadAtRenderSecond` (cooldowns.ts):
 * the `[STATE]` tick's "dead from floor(death) on". This file is the instant.
 */
import type { ICombatUnit } from "@gladlog/parser-compat";

type WithDeaths = Pick<ICombatUnit, "deathRecords">;

/** The unit's first death, epoch ms; Infinity when it never died. */
export function firstDeathMs(unit: Partial<WithDeaths>): number {
  let first = Infinity;
  for (const d of unit.deathRecords ?? [])
    if (d.timestamp < first) first = d.timestamp;
  return first;
}

/** True when the unit has died at or before the given timestamp. A corpse's
 *  last-known position is returned by getUnitPositionAtTime indefinitely, so
 *  dead enemies must be excluded from distance checks. */
export function isDeadAt(unit: Partial<WithDeaths>, tMs: number): boolean {
  return firstDeathMs(unit) <= tMs;
}

/**
 * A buff removed this shortly before its holder's UNIT_DIED was stripped by
 * the death cascade — neither dispelled nor cancelled. Editorial (measured,
 * not a game constant; triage 2026-09-29 death-kill F-B1): repro gaps 7–45 ms
 * (bd790c92, 121c7e15, 6062daf2); the nearest non-cascade removal is 390 ms
 * (0e0663e6 Pillar of Frost).
 */
export const DEATH_CASCADE_MS = 100;

/** Editorial, not measured: a natural expiry is logged on its official end,
 * so a gap this small either way is timer jitter, not a cut — and small
 * enough that a cut it drops cannot move a rounded "(Ns left)" by more than
 * the jitter itself (codex 20-G167-11 #2: 0.5 s dropped a 0.3 s cut that
 * moved the number). */
export const AURA_NATURAL_END_JITTER_S = 0.1;

/** Did this aura run out on its own: its removal sits on its natural end,
 * within `AURA_NATURAL_END_JITTER_S` either side? Two-sided on purpose: a run
 * well past the modelled end says the model is short for this press (a
 * Combustion extended to 12.95 s of 10 s), not that the aura ran out. Unknown
 * natural end → no claim. */
export function auraRanItsLength(
  removedMs: number,
  naturalEndMs: number | undefined,
): boolean {
  return (
    naturalEndMs !== undefined &&
    Math.abs(naturalEndMs - removedMs) <= AURA_NATURAL_END_JITTER_S * 1000
  );
}

/**
 * Was this removal the holder's death cascade: a `deathMs` within
 * `DEATH_CASCADE_MS` after it, and not the aura's own natural end (fact7 D15,
 * 69276401 2:56: Rallying Cry ran its full 15.6 s, 82 ms before the killing
 * tick, and left a surviving ally in the same millisecond). One reading for
 * every line that blames a death for an end.
 */
export function removedByDeath(
  deathsMs: readonly number[],
  removedMs: number,
  naturalEndMs?: number,
): boolean {
  if (auraRanItsLength(removedMs, naturalEndMs)) return false;
  return deathsMs.some((d) => {
    const gap = d - removedMs;
    return gap >= 0 && gap <= DEATH_CASCADE_MS;
  });
}
