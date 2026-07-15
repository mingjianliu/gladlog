/**
 * Core benchmark metrics computation
 */

import {
  CombatUnitReaction,
  CombatUnitType,
  LogEvent,
} from "@gladlog/parser-compat";
import type {
  AtomicArenaCombat,
  IArenaMatch,
} from "@gladlog/parser-compat";
import { specToString } from "../utils/cooldowns";
import {
  annotateDefensiveTimings,
  extractMajorCooldowns,
  IEnemyCDTimelineForTiming,
} from "../utils/cooldowns";
import { getDampeningPercentage } from "../utils/dampening";
import { canOffensivePurge } from "../utils/dispelAnalysis";
import { reconstructEnemyCDTimeline } from "../utils/enemyCDs";

// ── Config ────────────────────────────────────────────────────────────────────

const WINDOW_SECONDS = 10;
const MIN_SAMPLES_FOR_SUMMARY = 5;

// ── Types ─────────────────────────────────────────────────────────────────────

interface TimingCounts {
  optimal: number;
  early: number;
  late: number;
  reactive: number;
  unknown: number;
}

interface SpecStats {
  sampleCount: number;
  pressureWindowsSamples: number[];
  hpsSamples: number[];
  dpsSamples: number[];
  cdFirstUse: Record<string, Array<number | null>>;
  defensiveTimings: TimingCounts & { total: number };
  purgesPerMinuteSamples: number[];
  matchDurationSamples: number[];
  dampeningAtDeathSamples: number[];
}

interface Percentiles {
  p50: number;
  p75: number;
  p90: number;
  p95: number;
}

interface CDSummary {
  neverUsedRate: number;
  medianFirstUseSeconds: number | null;
  p75FirstUseSeconds: number | null;
}

export interface SpecSummary {
  sampleCount: number;
  pressureWindows: Percentiles;
  hps: Percentiles | null;
  dps: Percentiles;
  matchDuration: Percentiles;
  cdUsage: Record<string, CDSummary>;
  defensiveTiming: {
    sampleCasts: number;
    optimalPct: number;
    earlyPct: number;
    latePct: number;
    reactivePct: number;
    unknownPct: number;
  } | null;
  purgesPerMinute: Percentiles | null;
  dampeningAtDeath: Percentiles | null;
}

export interface BenchmarkOutput {
  bySpec: Record<string, SpecSummary>;
}

// ── Stat helpers ──────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

function toPercentiles(values: number[]): Percentiles {
  const s = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(s, 50),
    p75: percentile(s, 75),
    p90: percentile(s, 90),
    p95: percentile(s, 95),
  };
}

function specLabel(spec: string | number): string {
  const label = specToString(spec as never);
  return label && label !== "Unknown" ? label : String(spec);
}

function emptyTimingCounts(): TimingCounts & { total: number } {
  return { optimal: 0, early: 0, late: 0, reactive: 0, unknown: 0, total: 0 };
}

function ensureSpec(acc: Record<string, SpecStats>, label: string): SpecStats {
  if (!acc[label]) {
    acc[label] = {
      sampleCount: 0,
      pressureWindowsSamples: [],
      hpsSamples: [],
      dpsSamples: [],
      cdFirstUse: {},
      defensiveTimings: emptyTimingCounts(),
      purgesPerMinuteSamples: [],
      matchDurationSamples: [],
      dampeningAtDeathSamples: [],
    };
  }
  return acc[label];
}

// ── Core extraction ───────────────────────────────────────────────────────────

function extractCombatStats(
  combat: AtomicArenaCombat,
  acc: Record<string, SpecStats>,
  ratingFloor: number,
): void {
  const matchStartMs = combat.startTime;
  const matchEndMs = combat.endTime;
  const durationSeconds = (matchEndMs - matchStartMs) / 1000;
  if (durationSeconds < 30) return;

  const allUnits = Object.values(combat.units);
  const friendlies = allUnits.filter(
    (u) =>
      u.type === CombatUnitType.Player &&
      u.reaction === CombatUnitReaction.Friendly,
  );
  const enemies = allUnits.filter(
    (u) =>
      u.type === CombatUnitType.Player &&
      u.reaction === CombatUnitReaction.Hostile,
  );

  if (friendlies.length === 0 || enemies.length === 0) return;

  const owner =
    friendlies.find((u) => u.id === (combat as IArenaMatch).playerId) ??
    friendlies[0];
  const enemyCDTimeline = reconstructEnemyCDTimeline(
    enemies,
    combat,
    owner,
    friendlies,
  );

  const totalFriendlyDmg = friendlies
    .flatMap((f) => f.damageOut)
    .reduce((s, d) => {
      // Damage is negative in the log convention (absorbs positive): abs(·),
      // not max(0,·), or DPS baselines count absorbed-only damage.
      return "effectiveAmount" in d ? s + Math.abs(d.effectiveAmount) : s;
    }, 0);
  const avgDmgPerSec =
    durationSeconds > 0 ? totalFriendlyDmg / durationSeconds : 0;

  for (const unit of friendlies) {
    if (ratingFloor > 0 && (unit.info?.personalRating ?? 0) < ratingFloor)
      continue;
    const label = specLabel(unit.spec);
    const stats = ensureSpec(acc, label);
    stats.sampleCount++;
    stats.matchDurationSamples.push(durationSeconds);

    // ── 1. Damage taken per WINDOW_SECONDS buckets ─────────────────────────
    const bucketCount = Math.ceil(durationSeconds / WINDOW_SECONDS);
    const buckets = new Array<number>(bucketCount).fill(0);
    for (const d of unit.damageIn) {
      const t = (d.logLine.timestamp - matchStartMs) / 1000;
      const bi = Math.min(Math.floor(t / WINDOW_SECONDS), bucketCount - 1);
      buckets[bi] += Math.abs(d.effectiveAmount);
    }
    stats.pressureWindowsSamples.push(...buckets);

    // ── 2. HPS ────────────────────────────────────────────────────────────
    const totalHeal = unit.healOut.reduce(
      (s, h) => s + Math.max(0, h.effectiveAmount),
      0,
    );
    if (totalHeal > 0) stats.hpsSamples.push(totalHeal / durationSeconds);

    // ── 3. DPS ────────────────────────────────────────────────────────────
    stats.dpsSamples.push(avgDmgPerSec);

    // ── 4. CD usage + defensive timing annotation ─────────────────────────
    const cooldowns = extractMajorCooldowns(unit, combat);
    annotateDefensiveTimings(
      cooldowns,
      unit,
      combat,
      enemyCDTimeline as IEnemyCDTimelineForTiming,
    );

    for (const cd of cooldowns) {
      const spellLabel = cd.spellName;
      if (!stats.cdFirstUse[spellLabel]) stats.cdFirstUse[spellLabel] = [];
      const firstCast = cd.neverUsed
        ? null
        : (cd.casts[0]?.timeSeconds ?? null);
      while (stats.cdFirstUse[spellLabel].length < stats.sampleCount - 1) {
        stats.cdFirstUse[spellLabel].push(null);
      }
      stats.cdFirstUse[spellLabel].push(firstCast);

      if (cd.tag === "Defensive" || cd.tag === "External") {
        for (const cast of cd.casts) {
          const timing = cast.timingLabel ?? "Unknown";
          stats.defensiveTimings.total++;
          if (timing === "Optimal") stats.defensiveTimings.optimal++;
          else if (timing === "Early") stats.defensiveTimings.early++;
          else if (timing === "Late") stats.defensiveTimings.late++;
          else if (timing === "Reactive") stats.defensiveTimings.reactive++;
          else stats.defensiveTimings.unknown++;
        }
      }
    }

    for (const arr of Object.values(stats.cdFirstUse)) {
      while (arr.length < stats.sampleCount) arr.push(null);
    }

    // ── 5. Purge rate ─────────────────────────────────────────────────────
    if (canOffensivePurge(unit)) {
      const enemyIds = new Set(enemies.map((e) => e.id));
      const purgeCount = unit.actionOut.filter(
        (a) =>
          (a.logLine.event === LogEvent.SPELL_DISPEL ||
            a.logLine.event === LogEvent.SPELL_STOLEN) &&
          enemyIds.has(a.destUnitId),
      ).length;
      stats.purgesPerMinuteSamples.push(purgeCount / (durationSeconds / 60));
    }

    // ── 6. Dampening at friendly deaths ───────────────────────────────────
    const bracket = (combat as IArenaMatch).startInfo?.bracket ?? "3v3";
    for (const death of unit.deathRecords) {
      const dampPct =
        getDampeningPercentage(bracket, allUnits, death.timestamp) / 100;
      stats.dampeningAtDeathSamples.push(dampPct);
    }
  }
}

// ── Summarise ─────────────────────────────────────────────────────────────────

function summarise(
  acc: Record<string, SpecStats>,
): Record<string, SpecSummary> {
  const out: Record<string, SpecSummary> = {};

  for (const [label, stats] of Object.entries(acc)) {
    if (stats.sampleCount < MIN_SAMPLES_FOR_SUMMARY) continue;

    const cdUsage: Record<string, CDSummary> = {};
    for (const [spellLabel, timings] of Object.entries(stats.cdFirstUse)) {
      const used = timings.filter((t): t is number => t !== null);
      const sorted = [...used].sort((a, b) => a - b);
      cdUsage[spellLabel] = {
        neverUsedRate:
          Math.round(((timings.length - used.length) / timings.length) * 1000) /
          1000,
        medianFirstUseSeconds:
          sorted.length > 0 ? percentile(sorted, 50) : null,
        p75FirstUseSeconds: sorted.length > 0 ? percentile(sorted, 75) : null,
      };
    }

    const dt = stats.defensiveTimings;
    const defensiveTiming =
      dt.total >= 10
        ? {
            sampleCasts: dt.total,
            optimalPct: Math.round((dt.optimal / dt.total) * 1000) / 10,
            earlyPct: Math.round((dt.early / dt.total) * 1000) / 10,
            latePct: Math.round((dt.late / dt.total) * 1000) / 10,
            reactivePct: Math.round((dt.reactive / dt.total) * 1000) / 10,
            unknownPct: Math.round((dt.unknown / dt.total) * 1000) / 10,
          }
        : null;

    out[label] = {
      sampleCount: stats.sampleCount,
      pressureWindows: toPercentiles(stats.pressureWindowsSamples),
      hps:
        stats.hpsSamples.length >= MIN_SAMPLES_FOR_SUMMARY
          ? toPercentiles(stats.hpsSamples)
          : null,
      dps: toPercentiles(stats.dpsSamples),
      matchDuration: toPercentiles(stats.matchDurationSamples),
      cdUsage,
      defensiveTiming,
      purgesPerMinute:
        stats.purgesPerMinuteSamples.length >= MIN_SAMPLES_FOR_SUMMARY
          ? toPercentiles(stats.purgesPerMinuteSamples)
          : null,
      dampeningAtDeath:
        stats.dampeningAtDeathSamples.length >= MIN_SAMPLES_FOR_SUMMARY
          ? toPercentiles(stats.dampeningAtDeathSamples)
          : null,
    };
  }

  return out;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute benchmark metrics from a collection of arena combats.
 * Aggregates per-spec statistics on pressure, HPS/DPS, CD usage, timing, purges, and dampening.
 */
export function computeBenchmarks(
  matches: AtomicArenaCombat[],
  ratingFloor: number = 0,
): BenchmarkOutput {
  const acc = createBenchmarkAccumulator(ratingFloor);
  for (const combat of matches) acc.add(combat);
  return acc.finalize();
}

/** 流式聚合:逐场喂入即弃,避免整语料对局驻留内存 */
export function createBenchmarkAccumulator(ratingFloor: number = 0): {
  add(combat: AtomicArenaCombat): void;
  finalize(): BenchmarkOutput;
} {
  const acc: Record<string, SpecStats> = {};
  return {
    add(combat) {
      extractCombatStats(combat, acc, ratingFloor);
    },
    finalize() {
      return { bySpec: summarise(acc) };
    },
  };
}
