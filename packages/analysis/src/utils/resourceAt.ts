import { CombatUnitPowerType, ICombatUnit } from "@gladlog/parser-compat";

import { manaCostForCast } from "../data/spellManaCost";
import { buildAuraIntervals } from "./auraIntervals";
import { binarySearchClosest } from "./binarySearch";
import { HP_SAMPLE_RADIUS_MS } from "./cooldowns";
import { getSortedAdvancedActions } from "./advancedActions";
import type { ManaSample, RawStreams } from "./rawStreams";

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

/** Where a unit's mana can also be read when its advanced samples carry none:
 * the round's raw.txt pass (`parseRawStreams`, seconds from `matchStartMs`). */
export interface ManaFallback {
  rawStreams?: RawStreams;
  matchStartMs: number;
}

const rawManaCache = new WeakMap<RawStreams, Map<string, ManaSample[]>>();
function rawManaSamplesOf(rs: RawStreams, unitId: string): ManaSample[] {
  let byUnit = rawManaCache.get(rs);
  if (!byUnit) rawManaCache.set(rs, (byUnit = new Map()));
  let list = byUnit.get(unitId);
  if (!list) {
    // raw.txt lines are chronological, so this stays time-ordered
    list = rs.manaSamples.filter((m) => m.unitGuid === unitId && m.manaMax > 0);
    byUnit.set(unitId, list);
  }
  return list;
}

/**
 * The unit's MANA reading at `timestampMs` — the one mana sampler the context
 * lines read (reliability audit D2, 2026-09-25).
 *
 * Advanced samples first (`getUnitResourceAtTimestamp`). Only when the unit's
 * advanced stream carries NO mana at all — a document stored before the
 * parser decoded powers (2026-08-23), which is most of an older library — is
 * the raw.txt pass asked instead, under the same predicate: nearest sample,
 * same `binarySearchClosest` tie rules, same `HP_SAMPLE_RADIUS_MS`. 825ca842
 * had no [MANA] line at all while raw.txt read 91 % → 3 % across the round.
 * A unit whose advanced stream DOES carry mana is never overridden by the raw
 * pass: its null (no sample within the radius) is the answer.
 */
export function manaReadingAt(
  unit: Pick<ICombatUnit, "id" | "advancedActions">,
  timestampMs: number,
  fallback?: ManaFallback,
  maxDtMs = HP_SAMPLE_RADIUS_MS,
): IResourceReading | null {
  const advanced = samplesBearing(
    unit.id,
    getSortedAdvancedActions(unit),
    MANA_POWER_TYPE,
  );
  if (advanced.length > 0 || !fallback?.rawStreams?.available)
    return getUnitResourceAtTimestamp(
      unit,
      timestampMs,
      MANA_POWER_TYPE,
      maxDtMs,
    );
  const tSeconds = (timestampMs - fallback.matchStartMs) / 1000;
  const closest = binarySearchClosest(
    rawManaSamplesOf(fallback.rawStreams, unit.id),
    tSeconds,
    (m) => m.tSeconds,
  );
  if (!closest || Math.abs(closest.tSeconds - tSeconds) * 1000 > maxDtMs)
    return null;
  if (!Number.isFinite(closest.mana)) return null;
  return {
    current: closest.mana,
    max: closest.manaMax,
    pct: Math.round((closest.mana / closest.manaMax) * 100),
  };
}

/** Mana percentage points gained/lost across [fromMs, toMs]; null when either
 * end has no reading — a one-ended window cannot be a delta. Mana only: it
 * reads `manaReadingAt`, so a stored document without powers falls back to
 * the raw pass exactly as the [MANA] markers do. */
export function resourceDeltaPct(
  unit: Pick<ICombatUnit, "id" | "advancedActions">,
  fromMs: number,
  toMs: number,
  fallback?: ManaFallback,
): { fromPct: number; toPct: number; deltaPct: number } | null {
  const a = manaReadingAt(unit, fromMs, fallback);
  const b = manaReadingAt(unit, toMs, fallback);
  if (!a || !b) return null;
  return { fromPct: a.pct, toPct: b.pct, deltaPct: b.pct - a.pct };
}

/** The unit's mana samples inside [fromMs, toMs], by the same precedence as
 * `manaReadingAt`: advanced samples when the unit's advanced stream carries
 * mana at all, otherwise the raw.txt pass. */
function manaSamplesWithin(
  unit: Pick<ICombatUnit, "id" | "advancedActions">,
  fromMs: number,
  toMs: number,
  fallback?: ManaFallback,
): Array<{ current: number; max: number }> {
  const advanced = samplesBearing(
    unit.id,
    getSortedAdvancedActions(unit),
    MANA_POWER_TYPE,
  );
  if (advanced.length > 0 || !fallback?.rawStreams?.available)
    return advanced
      .filter(
        (a) => a.logLine.timestamp >= fromMs && a.logLine.timestamp <= toMs,
      )
      .map((a) => powerEntry(a, MANA_POWER_TYPE)!)
      .filter((e) => e && e.max > 0 && Number.isFinite(e.current))
      .map((e) => ({ current: e.current, max: e.max }));
  const fromS = (fromMs - fallback.matchStartMs) / 1000;
  const toS = (toMs - fallback.matchStartMs) / 1000;
  return rawManaSamplesOf(fallback.rawStreams, unit.id)
    .filter(
      (m) =>
        m.tSeconds >= fromS && m.tSeconds <= toS && Number.isFinite(m.mana),
    )
    .map((m) => ({ current: m.mana, max: m.manaMax }));
}

/**
 * Auras under which the carrier's spells cost no mana — the static DB2 cost
 * does not apply, so affordability is unknown (no gate). Innervate 29166
 * ("mana costs reduced by 100 %", observed in the S2 archive): agy review of
 * F-H6. Other partial reductions are not modelled; a missing one can only
 * over-state the cost, i.e. excuse, never accuse. Registered in
 * curatedIdRegistry.
 */
export const FREE_CAST_AURA_IDS: ReadonlySet<string> = new Set([
  "29166", // Innervate
]);

function freeCastWithin(
  unit: ICombatUnit,
  fromMs: number,
  toMs: number,
  combat?: { startTime: number; endTime: number },
): boolean {
  if (!combat) return false;
  const fromS = (fromMs - combat.startTime) / 1000;
  const toS = (toMs - combat.startTime) / 1000;
  return buildAuraIntervals(unit, combat).some(
    (iv) =>
      FREE_CAST_AURA_IDS.has(iv.spellId) && iv.fromS <= toS && iv.toS >= fromS,
  );
}

const costFor = (
  unit: Pick<ICombatUnit, "spec">,
  spellId: string,
  manaMax: number,
) => manaCostForCast(spellId, String(unit.spec ?? ""), manaMax);

/**
 * "Could the unit pay for this spell's mana at `tMs`" — the ONE affordability
 * predicate (triage 2026-09-29 F-H6 × res-readiness F-C3, user ruling
 * 2026-09-30, res R2 = A). The reading is `manaReadingAt` (the [MANA]
 * sampler); the cost is the official `manaCostForCast` against that reading's
 * max. Null = unknown (no cost row, or no reading): callers must not gate on
 * it. [RES] (res F-C3) keeps an unaffordable cooldown `rdy` and annotates it
 * with `mana` / `cost`.
 */
export function affordableAt(
  unit: ICombatUnit,
  spellId: string,
  tMs: number,
  fallback?: ManaFallback,
  /** the round, for the free-cast auras (`FREE_CAST_AURA_IDS`); absent = not checked */
  combat?: { startTime: number; endTime: number },
): { affordable: boolean; mana: number; cost: number } | null {
  if (freeCastWithin(unit, tMs, tMs, combat)) return null;
  const r = manaReadingAt(unit, tMs, fallback);
  if (!r) return null;
  const cost = costFor(unit, spellId, r.max);
  if (cost === null || !(cost > 0)) return null;
  return { affordable: r.current >= cost, mana: r.current, cost };
}

/**
 * `affordableAt`'s window form for an accusation: affordable if ANY mana
 * sample in [fromMs, toMs] covers the cost (F-H6: [t, t + CD_HOARD_RESPONSE_S]
 * — the player could have waited a second for the mana). Same cost, same
 * sample sources, same comparison. Null = unknown (no cost row or no sample
 * in the window): no gate.
 */
export function affordableWithin(
  unit: ICombatUnit,
  spellId: string,
  fromMs: number,
  toMs: number,
  fallback?: ManaFallback,
  /** the round, for the free-cast auras (`FREE_CAST_AURA_IDS`); absent = not checked */
  combat?: { startTime: number; endTime: number },
): boolean | null {
  if (freeCastWithin(unit, fromMs, toMs, combat)) return null;
  const samples = manaSamplesWithin(unit, fromMs, toMs, fallback);
  let known = false;
  for (const s of samples) {
    const cost = costFor(unit, spellId, s.max);
    if (cost === null || !(cost > 0)) return null;
    known = true;
    if (s.current >= cost) return true;
  }
  return known ? false : null;
}
