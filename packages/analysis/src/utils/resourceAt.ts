import { CombatUnitPowerType, ICombatUnit } from "@gladlog/parser-compat";

import { binarySearchClosest } from "./binarySearch";
import { HP_SAMPLE_RADIUS_MS } from "./cooldowns";
import { getSortedAdvancedActions } from "./advancedActions";

/**
 * resourceAt.ts — "what resource did this unit have at instant T".
 *
 * The sibling of `getUnitHpAtTimestamp`, and deliberately the same shape: same
 * `advancedActions` stream, same `binarySearchClosest`, same
 * `HP_SAMPLE_RADIUS_MS` tolerance, same "no sample in range → null, never a
 * fabricated 0". Two facts sampled off one event stream must not drift apart on
 * how far a reading may be taken from.
 *
 * The readings themselves only exist as of 2026-08-23: the parser decoded no
 * power fields at all before that, so `advancedActorPowers` was always `[]` and
 * every mana question had to be answered from `rawStreams`' separate raw.txt
 * pass. Old archived docs still have empty powers, so every caller has to treat
 * `null` as "unknown", not as "empty".
 */

/** Mana is power type 0. Kept as its own constant so callers do not spell the
 * magic number, and so a spec that pays a different resource is a deliberate
 * choice at the call site rather than an accident. */
export const MANA_POWER_TYPE = CombatUnitPowerType.Mana;

export interface IResourceReading {
  current: number;
  max: number;
  /** 0–100. */
  pct: number;
}

/**
 * The unit's reading for `powerType` at `timestampMs`, or null when no advanced
 * sample for THIS unit lands within `maxDtMs` / the sample carried no such
 * power / the max is non-positive.
 */
export function getUnitResourceAtTimestamp(
  unit: Pick<ICombatUnit, "id" | "advancedActions">,
  timestampMs: number,
  powerType: number = MANA_POWER_TYPE,
  maxDtMs = HP_SAMPLE_RADIUS_MS,
): IResourceReading | null {
  const closest = binarySearchClosest(
    getSortedAdvancedActions(unit),
    timestampMs,
    (a) => a.logLine.timestamp,
  );
  if (!closest) return null;
  if (closest.advancedActorId !== unit.id) return null;
  if (Math.abs(closest.logLine.timestamp - timestampMs) > maxDtMs) return null;

  const entry = (closest.advancedActorPowers ?? []).find(
    (p) => (p.type as unknown as number) === powerType,
  );
  if (!entry || entry.max <= 0) return null;
  if (!Number.isFinite(entry.current) || !Number.isFinite(entry.max)) {
    return null;
  }
  return {
    current: entry.current,
    max: entry.max,
    pct: Math.round((entry.current / entry.max) * 100),
  };
}

/** Mana percentage points gained/lost across [fromMs, toMs]; null when either
 * end has no reading — a one-ended window cannot be a delta. */
export function resourceDeltaPct(
  unit: Pick<ICombatUnit, "id" | "advancedActions">,
  fromMs: number,
  toMs: number,
  powerType: number = MANA_POWER_TYPE,
): { fromPct: number; toPct: number; deltaPct: number } | null {
  const a = getUnitResourceAtTimestamp(unit, fromMs, powerType);
  const b = getUnitResourceAtTimestamp(unit, toMs, powerType);
  if (!a || !b) return null;
  return { fromPct: a.pct, toPct: b.pct, deltaPct: b.pct - a.pct };
}
