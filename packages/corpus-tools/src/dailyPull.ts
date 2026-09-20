// Planning for the daily quota pull (scripts/dailyPull.ts). Pure functions
// only; the driver spawns fetchPvpLogs.ts per step.
//
// User ruling 2026-09-15: spend the upstream's 15 distinct logs per UTC day on
// 2100+ (the highest reachable filter tier), any spec, any uploader — 10 Solo
// Shuffle matches (one shuffle object = six rounds for one quota unit; revised
// from 5 the same day) and 3v3 for the rest. Be very careful with paging and every other request.
import { type QuotaState, remainingGrantsToday } from "./pvpLogFetch";

/** The upstream's flat daily quota (their accessLimits.ts, 2026-09-13). */
export const DAILY_QUOTA = 15;
/** Solo Shuffle objects to take first each day; 3v3 gets the remainder. */
export const DAILY_SHUFFLE_SHARE = 10;
/** Highest filter tier the server indexes (1400/1800/2100/2400; 2400 is empty this season). */
export const DAILY_MIN_RATING = 2100;
/** Feed pages per step at most — one page (50 stubs) normally covers a step. */
export const DAILY_MAX_PAGES = 3;
/** fetchPvpLogs exit code for "no usable Battle.net session" (missing/stale cookie). */
export const EXIT_AUTH = 3;

export interface PullStep {
  bracket: "Rated Solo Shuffle" | "3v3";
  limit: number;
}

/** Grants still available today according to the last recorded state. */
export function remainingToday(
  state: QuotaState | undefined,
  now: Date = new Date(),
  quota: number = DAILY_QUOTA,
): number {
  return remainingGrantsToday(state, now, quota);
}

/**
 * Shuffle share first, 3v3 the rest; a step with nothing to take is omitted.
 * `done` lists the brackets this run has already stepped through: a finished
 * bracket takes nothing more, and whatever it left (it found fewer matches
 * than its share, or simply took its share) goes to 3v3. The driver re-plans
 * from the recorded quota after every step, so without `done` the shuffle
 * share was re-issued to a finished bracket and 3v3 never ran (2026-09-16..18:
 * three days of 10/15).
 */
export function planSteps(
  remaining: number,
  done: PullStep["bracket"][] = [],
  shuffleShare: number = DAILY_SHUFFLE_SHARE,
): PullStep[] {
  const shuffleDone = done.includes("Rated Solo Shuffle");
  const ss = shuffleDone ? 0 : Math.max(0, Math.min(shuffleShare, remaining));
  const threes = done.includes("3v3") ? 0 : Math.max(0, remaining - ss);
  const steps: PullStep[] = [];
  if (ss > 0) steps.push({ bracket: "Rated Solo Shuffle", limit: ss });
  if (threes > 0) steps.push({ bracket: "3v3", limit: threes });
  return steps;
}

/** The `done: N new logs` line fetchPvpLogs prints; 0 when it never got there. */
export function parseFreshCount(stdout: string): number {
  const m = /done: (\d+) new logs/.exec(stdout);
  return m ? Number(m[1]) : 0;
}

export type RunStatus = "ok" | "auth-expired" | "error";

export function classifyExit(code: number | null): RunStatus {
  if (code === 0) return "ok";
  if (code === EXIT_AUTH) return "auth-expired";
  return "error";
}

/** One line of downloads/daily-pull/runs.jsonl. */
export interface RunRecord {
  startedAt: string;
  finishedAt: string;
  utcDay: string;
  status: RunStatus;
  steps: { bracket: string; limit: number; fresh: number; exit: number | null }[];
  quotaAfter: QuotaState | null;
  /** The Drive archive steps that follow the pull, in order. Absent on records
   * written before 2026-09-20 (no archive step existed) and when
   * DAILY_SKIP_DRIVE_SYNC=1. `driveSync` is the first-generation single-step
   * shape, kept so old runs.jsonl lines still render. */
  archives?: { name: string; exit: number | null; seconds: number }[];
  driveSync?: { exit: number | null; seconds: number };
  note?: string;
}
