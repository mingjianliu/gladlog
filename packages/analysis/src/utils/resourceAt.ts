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

interface IResourceReading {
  current: number;
  max: number;
  /** 0–100. */
  pct: number;
}

type AdvancedSample = ReturnType<typeof getSortedAdvancedActions>[number];

const powerEntry = (a: AdvancedSample, powerType: number) =>
  (a.advancedActorPowers ?? []).find(
    (p) => (p.type as unknown as number) === powerType,
  );

// sorted samples → per power type, the subset that can answer for it
const bearingCache = new WeakMap<
  readonly AdvancedSample[],
  Map<number, AdvancedSample[]>
>();
function samplesBearing(
  unitId: string,
  sorted: AdvancedSample[],
  powerType: number,
): AdvancedSample[] {
  let byType = bearingCache.get(sorted);
  if (!byType) bearingCache.set(sorted, (byType = new Map()));
  let list = byType.get(powerType);
  if (!list) {
    list = sorted.filter((a) => {
      if (a.advancedActorId !== unitId) return false;
      const e = powerEntry(a, powerType);
      return !!e && e.max > 0;
    });
    byType.set(powerType, list);
  }
  return list;
}

/**
 * The unit's reading for `powerType` at `timestampMs`, or null when no advanced
 * sample for THIS unit that CARRIES that power lands within `maxDtMs`.
 *
 * Nearest among the samples that can answer, not nearest overall (reliability
 * audit D2, 2026-09-25): a druid's advanced block reports rage in Bear Form
 * and energy in Cat Form, so the nearest sample of all can carry no mana
 * while a mana sample sits 0.4 s away — e9ea8a0c 4:31, Innervate, then Bear
 * Form one second in, and the note printed "no resource reading". Same
 * `binarySearchClosest` (and its tie rules) over that subset, same radius.
 */
export function getUnitResourceAtTimestamp(
  unit: Pick<ICombatUnit, "id" | "advancedActions">,
  timestampMs: number,
  powerType: number = MANA_POWER_TYPE,
  maxDtMs = HP_SAMPLE_RADIUS_MS,
): IResourceReading | null {
  const closest = binarySearchClosest(
    samplesBearing(unit.id, getSortedAdvancedActions(unit), powerType),
    timestampMs,
    (a) => a.logLine.timestamp,
  );
  if (!closest) return null;
  if (Math.abs(closest.logLine.timestamp - timestampMs) > maxDtMs) return null;

  const entry = powerEntry(closest, powerType);
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
