/**
 * Shared types for cross-match learning
 * (spec: docs/superpowers/specs/2026-07-26-self-learning-rules-design.md).
 * Shared by the ledger (desktop main) and the scan/distill/apply steps (this
 * directory) — single-source predicates presuppose single-source types.
 *
 * The cross-match key is the category (+ candidate event type), **not the
 * findingKey**: findingKey embeds eventIds, which are per-match local ids and
 * therefore never repeat across matches (aggregate() also uses only the
 * category across matches; findingKey serves single-match flags only).
 */

/** One ledger line = one analysis run (with that match's findings embedded).
 * Re-analysing a match appends a new line; on read, the line with the largest
 * createdAt per matchId wins (last-run-wins, replacing the WHOLE match — a
 * per-finding last-write-wins would leave findings the new run dropped stuck in
 * the ledger forever). */
export interface LedgerRun {
  v: 1;
  matchId: string;
  /** Match start time (ms) — the window sort key (meta.json's startTime). */
  startTime: number;
  win: boolean;
  zoneId?: string;
  bracket?: string;
  /** Enemy spec ids (meta.teams[1]); [] for legacy records without teams. */
  enemySpecs: number[];
  /** Recorded but never used for invalidation: learned memory is decoupled
   * from prompt-cache invalidation (spec §1). */
  promptVersion: number;
  createdAt: number;
  findings: LedgerFinding[];
}

export interface LedgerFinding {
  /** Slug already run through normalizeFindingCategory (guaranteed by the
   * writing side). */
  category: string;
  severity: string;
  /** Candidate event types referenced by the finding, deduped and ascending
   * (present on live writes; [] for backfilled legacy matches). */
  eventTypes: string[];
}

/** Post-merge match view of the ledger = LedgerRun minus the envelope fields;
 * the input to scanning/statistics. */
export type LedgerMatch = Omit<LedgerRun, "v" | "promptVersion" | "createdAt">;

export interface PatternCondition {
  enemySpec?: number;
  zoneId?: string;
}

export interface GroupStats {
  /** Actual window size (min(matching match count, PATTERN_WINDOW_MATCHES)). */
  windowMatches: number;
  hits: number;
  /** startTime of the first/last hitting match over ALL history (no window
   * limit); 0 when there are no hits. */
  firstSeen: number;
  lastSeen: number;
  /** Hit counts within the window, bucketed by TREND_BUCKET_MATCHES matches,
   * oldest → newest. */
  trend: number[];
  /** Most recent hitting match ids within the window, newest → oldest, <=3 —
   * used as distillation examples and the UI evidence chain. */
  exampleMatchIds: string[];
  /** Whether hits span both the older and newer halves of the window (rules
   * out a single losing-streak spike). */
  spansBothHalves: boolean;
}

export interface StablePattern {
  /** Deterministic id, also used as the ruleId:
   * cat:<c>[|type:<t>][|spec:<id>][|zone:<id>] */
  patternId: string;
  category: string;
  /** [] = category level; ["death"] = category+type level (a single type). */
  eventTypes: string[];
  condition: PatternCondition | null;
  windowMatches: number;
  hits: number;
  firstSeen: number;
  lastSeen: number;
  trend: number[];
  exampleMatchIds: string[];
}

export interface LearnedRule {
  ruleId: string;
  status: "active" | "improved";
  category: string;
  eventTypes: string[];
  condition: PatternCondition | null;
  stats: {
    windowMatches: number;
    hits: number;
    firstSeen: number;
    lastSeen: number;
    trend: number[];
  };
  /** Template text (containing {{hits}}/{{windowMatches}} placeholders),
   * interpolated at render time.
   * Missing the current language → the UI shows the other language's text
   * with a content-language label (spec §6.13), or a placeholder when neither
   * exists, and the next consolidation fills the current language in lazily. */
  description: { zh?: string; en?: string };
  advice: { zh?: string; en?: string };
  evidence: string[];
  distilledAt: number;
  distillModel: string;
}

export interface RulesDoc {
  schemaVersion: 1;
  updatedAt: number;
  /** Match count the ledger covered at the last consolidation — the criterion
   * for auto-triggering an incremental run. */
  ledgerMatches: number;
  rules: LearnedRule[];
}
