import benchmarksJson from '../data/benchmarks.json';
import { bracketKey } from './bracketKey';
import { cdIsProcOnly, IMajorCooldownInfo } from './cooldowns';
import { fmtTime } from './renderGrid';

// benchmarks.json is a copy of packages/analysis/benchmarks/benchmark_data.json (collectBenchmarks.ts default --out).
// Re-run collectBenchmarks and copy the output here to keep them in sync.

interface ISpecCDBaseline {
  neverUsedRate: number;
  medianFirstUseSeconds: number | null;
  p75FirstUseSeconds: number | null;
}

interface ISpecBaseline {
  sampleCount: number;
  defensiveTiming: {
    optimalPct: number;
    earlyPct: number;
    latePct: number;
    reactivePct: number;
    unknownPct: number;
  } | null;
  cdUsage: Record<string, ISpecCDBaseline>;
  pressureWindows?: { p50: number; p75: number; p90: number; p95: number };
}

export interface IBenchmarkData {
  bySpec: Record<string, ISpecBaseline>;
}

export const benchmarks: IBenchmarkData = benchmarksJson as unknown as IBenchmarkData;

/** The rating floor of the benchmark corpus — `collectBenchmarks`' default
 * `--min-rating`, which imports this constant. Both sides read the same field:
 * COMBATANT_INFO `personalRating`, the player's own rating in the bracket. It
 * is NOT the lobby's matchmaking rating (ARENA_MATCH_END carries that, and
 * nothing here reads it) — triage other F-O2: 52 of 60 rounds printed the
 * personal rating as "MMR", median 806 away from the team's MMR. */
export const BASELINE_RATING_FLOOR = 2100;

/**
 * B-tier B21a (user ruling 2026-10-06): the lobby's matchmaking rating as its
 * own MATCH FACTS line — a fact beside the personal rating, never part of the
 * "below the reference bracket" comparison (that one stays on personal
 * rating, which is what the reference corpus is filtered on). `teamMmr` is
 * the parser's ARENA_MATCH_END pair by team id. "your team / enemy team" only
 * for a 2v2 / 3v3 with a known own team: a Solo Shuffle round (`bracketKey`
 * "solo") carries the shuffle's closing pair and its teams re-form every
 * round, so there the two numbers are printed without sides. [] when the log
 * did not say.
 */
export function formatLobbyMmrFact(combat: {
  teamMmr?: { team0: number; team1: number } | null;
  playerTeamId?: string | null;
  startInfo?: { bracket?: string };
}): string[] {
  const m = combat.teamMmr;
  if (!m || !(m.team0 > 0) || !(m.team1 > 0)) return [];
  const tail =
    " — the lobby's rating, not your personal rating; the reference rates below are filtered on personal rating, never on this";
  const own =
    bracketKey(combat.startInfo?.bracket) === "solo"
      ? null
      : combat.playerTeamId === "0"
        ? { mine: m.team0, theirs: m.team1 }
        : combat.playerTeamId === "1"
          ? { mine: m.team1, theirs: m.team0 }
          : null;
  return [
    own
      ? `  Lobby matchmaking rating (MMR): your team ${own.mine} | enemy team ${own.theirs}${tail}`
      : `  Lobby matchmaking rating (MMR): ${m.team0} / ${m.team1}${tail}`,
  ];
}

export function formatSpecBaselines(
  ownerSpec: string,
  ownerCDs: IMajorCooldownInfo[],
  data: IBenchmarkData,
  /** the log owner's rating this match (COMBATANT_INFO personalRating; 0 / undefined = unknown) */
  ownerRating?: number,
): string[] {
  const spec = data.bySpec[ownerSpec];
  if (!spec) return [];

  const lines: string[] = [];
  // Reliability round 1 rerun #8: the ≥2100 reference was quoted as the norm for
  // 1.5–1.7k matches. State the owner's own rating next to the bracket so the
  // model reads the rates as what higher-rated players do, not as a target.
  const ratingNote =
    ownerRating && ownerRating > 0
      ? ownerRating < BASELINE_RATING_FLOOR
        ? ` — your personal rating in this bracket is ${ownerRating}, below the reference bracket: read the rates as what higher-rated players do, not as a norm for this match`
        : ` — your personal rating in this bracket is ${ownerRating}`
      : "";
  lines.push(
    `SPEC BASELINES — ${ownerSpec} at ≥${BASELINE_RATING_FLOOR} personal rating (n=${spec.sampleCount})${ratingNote}:`,
  );

  const dt = spec.defensiveTiming;
  if (dt) {
    lines.push(
      `  Defensive timing: Optimal ${Math.round(dt.optimalPct)}% | Early ${Math.round(dt.earlyPct)}% | Late ${Math.round(dt.latePct)}% | Reactive ${Math.round(dt.reactivePct)}% | Unknown ${Math.round(dt.unknownPct)}%`,
    );
  }

  // The table promises first-USE timing; a proc-only entry (Renewing Blaze —
  // its "use" is Obsidian Scales' proc) has no use to time (round 3 N5).
  const relevantCDs = ownerCDs.filter((cd) => spec.cdUsage[cd.spellName] && !cdIsProcOnly(cd));
  if (relevantCDs.length > 0) {
    lines.push('  CD reference (% of matches used | median first use | p75 first use):');
    for (const cd of relevantCDs) {
      const baseline = spec.cdUsage[cd.spellName];
      const usedPct = Math.round((1 - baseline.neverUsedRate) * 100);
      const median = baseline.medianFirstUseSeconds !== null ? fmtTime(baseline.medianFirstUseSeconds) : '—';
      const p75 = baseline.p75FirstUseSeconds !== null ? fmtTime(baseline.p75FirstUseSeconds) : '—';
      lines.push(`    ${cd.spellName}: ${usedPct}% used | ${median} median | ${p75} p75`);
    }
  }

  return lines;
}

/**
 * Emits a per-spec incoming-damage baseline block for all friendly specs that have
 * benchmark data. Helps the model interpret [DMG SPIKE] magnitudes.
 * Each value is the total damage received in a 10-second window by players at
 * ≥ BASELINE_RATING_FLOOR personal rating.
 */
export function formatDTPSBaselines(friendlySpecs: string[], data: IBenchmarkData): string[] {
  const rows: string[] = [];
  for (const spec of friendlySpecs) {
    const entry = data.bySpec[spec];
    if (!entry?.pressureWindows) continue;
    const p50k = Math.round(entry.pressureWindows.p50 / 1000);
    const p90k = Math.round(entry.pressureWindows.p90 / 1000);
    rows.push(`  ${spec} (n=${entry.sampleCount}): p50 ${p50k}k | p90 ${p90k}k`);
  }
  if (rows.length === 0) return [];
  return [`INCOMING DAMAGE BASELINES (per 10s window, ≥${BASELINE_RATING_FLOOR} personal rating):`, ...rows];
}
