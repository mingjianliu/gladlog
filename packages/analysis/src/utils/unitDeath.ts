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

import { aliveAfterRow, KILLING_BLOW_DEATH_SLACK_MS } from "./killingBlow";

type WithDeaths = Pick<ICombatUnit, "deathRecords">;
type WithDeathsAndHits = Partial<
  Pick<ICombatUnit, "deathRecords" | "damageIn" | "advancedActions">
>;

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
 * How far UNIT_DIED may trail the lethal hit and still be that hit's death.
 * Editorial (measured, not a game constant; fact12 D32): the game strips a
 * dying unit's auras in the millisecond of the hit that killed it (with its
 * PARTY_KILL) and can write UNIT_DIED later — f13566f0 r0 2:17, 125 ms; the
 * fact12 repro set's other 10 player deaths with a lethal hit trail it by
 * at most 100 ms. Bounded so a hit with overkill the unit survived (no
 * UNIT_DIED behind it) never reads as a death.
 */
export const LETHAL_HIT_DEATH_LAG_MS = 1000;

/** A death's teardown: its auras come off from the lethal hit (`fromMs`) to
 * the UNIT_DIED (`deathMs`); `fromMs === deathMs` with no lethal hit. */
export interface IDeathTeardown {
  fromMs: number;
  deathMs: number;
}

/**
 * Each death's teardown window (fact12 D32): from the earliest damage row on
 * the unit with overkill > 0 that the UNIT_DIED trails by at most
 * `LETHAL_HIT_DEATH_LAG_MS` — and that the unit did not survive: no reading
 * of it above 0 HP logged after the row (`aliveAfterRow`, the killing blow's
 * own test: a Refraction self-tick logs overkill and leaves the mage at
 * 1 HP) — to the UNIT_DIED. The window `removedInDeathTeardown` is asked
 * about: a removal in the lethal hit's millisecond, or anywhere between it
 * and a UNIT_DIED logged more than `DEATH_CASCADE_MS` later, is the teardown.
 */
export function deathTeardownWindowsMs(
  unit: WithDeathsAndHits,
): IDeathTeardown[] {
  const out: IDeathTeardown[] = [];
  for (const d of unit.deathRecords ?? []) {
    const death = d.timestamp as number;
    let lethal = death;
    for (const h of unit.damageIn ?? []) {
      const t = h.logLine.timestamp as number;
      if (
        (h.overkill ?? 0) > 0 &&
        t < lethal &&
        death - t <= LETHAL_HIT_DEATH_LAG_MS &&
        !aliveAfterRow(unit, t, death + KILLING_BLOW_DEATH_SLACK_MS)
      )
        lethal = t;
    }
    out.push({ fromMs: lethal, deathMs: death });
  }
  return out;
}

/**
 * Was this removal a death's teardown: inside a window from
 * `DEATH_CASCADE_MS` before its lethal hit to its UNIT_DIED
 * (`deathTeardownWindowsMs`), and not the aura's own natural end. With no
 * lethal hit that is `removedByDeath`'s reading.
 */
export function removedInDeathTeardown(
  windows: readonly IDeathTeardown[],
  removedMs: number,
  naturalEndMs?: number,
): boolean {
  if (auraRanItsLength(removedMs, naturalEndMs)) return false;
  return windows.some(
    (w) => removedMs >= w.fromMs - DEATH_CASCADE_MS && removedMs <= w.deathMs,
  );
}

/**
 * Was this removal the holder's death cascade: a `deathMs` within
 * `DEATH_CASCADE_MS` after it, and not the aura's own natural end (the
 * pipeline's readers ask `removedInDeathTeardown`, which adds the lethal
 * hit's window) (fact7 D15,
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
