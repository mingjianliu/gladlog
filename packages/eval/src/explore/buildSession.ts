/**
 * Deterministic machine prescreen + review-session assembly for the review
 * workbench: turns raw deep-dive claims + evidence lines into `ReviewCard`s a
 * human can judge, cross-checking every deep-dive evidence line against the
 * SAME query dispatch (`runQuery`, Task 2) the exploration CLI uses — per
 * CLAUDE.md's shared-predicate rule, this file must never reimplement any of
 * the eight query predicates itself, only call the shared dispatch and
 * compare its output text.
 *
 * Baseline cards (`baselineToCards`, Task 4) are NOT run through `prescreen`:
 * their evidence lines are deterministic derivations of the persisted
 * analysis cache, not fresh model claims, so `buildSession` short-circuits
 * them straight to `"verified"` (see `baselineFindings.ts`'s own header for
 * why that's not a gap).
 */
import {
  type DeepFindingInput,
  type EvidenceRef,
  type PrescreenVerdict,
  type ReviewCard,
  type ReviewSession,
} from "./reviewTypes";
import { baselineToCards, readActiveAnalysisResult } from "./baselineFindings";
import { runQuery } from "./matchExplore";
import { type LegacyRound, readRawText, splitTeams } from "./storeAccess";

// ---------------------------------------------------------------------------
// prescreen
// ---------------------------------------------------------------------------

/**
 * Re-runs each evidence line's `cmd` (a `runQuery` argv string, e.g.
 * `"cd --t 93"`) through the injected `query` and compares its output
 * against the claimed `line` (trimmed, exact match against ANY output line —
 * a query's answer is multiple lines, one header plus one per unit/row).
 * `query` throwing (bad/unparseable `cmd`) is `"unverifiable"`, not
 * `"mismatch"` — those are different failure modes a reviewer should read
 * differently (evidence that can't be checked vs. evidence that was checked
 * and contradicted). Production callers inject `(argv) => runQuery(legacy,
 * argv)`; tests inject a stub — this function itself never imports
 * `runQuery` or any `LegacyRound`, so it stays independently testable.
 */
export function prescreen(
  evidence: EvidenceRef[],
  query: (argv: string[]) => string[],
): Array<EvidenceRef & { verdict: PrescreenVerdict }> {
  return evidence.map((e) => {
    let output: string[];
    try {
      output = query(e.cmd.split(/\s+/));
    } catch {
      return { ...e, verdict: "unverifiable" as const };
    }
    const target = e.line.trim();
    const verdict: PrescreenVerdict = output.some(
      (line) => line.trim() === target,
    )
      ? "verified"
      : "mismatch";
    return { ...e, verdict };
  });
}

// ---------------------------------------------------------------------------
// seededShuffle — mulberry32(fnv1a(seed)), no Math.random anywhere
// ---------------------------------------------------------------------------

/** 32-bit FNV-1a string hash — turns an arbitrary seed string into a single
 * uint32 seed for `mulberry32`. */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 PRNG (public-domain, widely used minimal seedable generator):
 * returns a `() => number in [0, 1)` closure, deterministic for a given
 * uint32 seed. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic Fisher-Yates shuffle keyed on `seed` (same `seed` → same
 * permutation always, across runs and processes — NO `Math.random`, so a
 * review session's card order is reproducible from `name` alone). Used by
 * `buildSession` to interleave deep/baseline cards so the assigned `cardId`
 * (`"c" + index`, post-shuffle) never leaks which source a card came from.
 */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  const rand = mulberry32(fnv1a(seed));
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------------------------------------------------------------------------
// buildSession
// ---------------------------------------------------------------------------

/**
 * Assembles one `ReviewSession`: deep-dive claims (`opts.deep`) become cards
 * whose evidence is run through `prescreen` against `opts.legacy` via
 * `runQuery` (the single shared query dispatch); the match's persisted
 * baseline analysis findings (`readActiveAnalysisResult` + `baselineToCards`,
 * absent when no analysis cache exists on disk) become cards whose evidence
 * is short-circuited straight to `"verified"`. Both card sets are merged,
 * shuffled with `seededShuffle(cards, opts.name)` (so `opts.name` alone
 * determines the reviewable order, reproducibly), and only THEN assigned
 * `cardId = "c" + index` — numbering after the shuffle, not before, is what
 * keeps a card's id from leaking whether it came from `deep` or `baseline`.
 */
export function buildSession(opts: {
  name: string;
  matchId: string;
  roundSeq?: number;
  /** Id the analysis cache lives under (`loadLegacyRound().analysisId`):
   * a shuffle round's own id — only round 0 shares the storage id. Defaults
   * to `matchId`, which is correct for non-shuffle matches and round 0. */
  analysisId?: string;
  deep: DeepFindingInput[];
  legacy: LegacyRound;
  matchesDir: string;
}): ReviewSession {
  const query = (argv: string[]): string[] => runQuery(opts.legacy, argv);

  const deepCards: Array<Omit<ReviewCard, "cardId">> = opts.deep.map((d) => ({
    source: "deep" as const,
    claim: d.claim,
    anchorT: d.anchorT,
    unitNames: d.unitNames,
    evidence: prescreen(d.evidence, query),
  }));

  const { owner } = splitTeams(opts.legacy);
  const activeResult = readActiveAnalysisResult(
    opts.matchesDir,
    opts.analysisId ?? opts.matchId,
  );
  const baselineCards: Array<Omit<ReviewCard, "cardId">> = activeResult
    ? baselineToCards(
        activeResult.findings,
        opts.legacy,
        owner,
        readRawText(opts.matchesDir, opts.matchId),
      ).map((c) => ({
        ...c,
        evidence: c.evidence.map((e) => ({
          ...e,
          verdict: "verified" as const,
        })),
      }))
    : [];

  const shuffled = seededShuffle([...deepCards, ...baselineCards], opts.name);
  const cards: ReviewCard[] = shuffled.map((c, i) => ({
    ...c,
    cardId: `c${i}`,
  }));

  return {
    schemaVersion: 1,
    name: opts.name,
    matchId: opts.matchId,
    roundSeq: opts.roundSeq,
    createdAt: Date.now(),
    cards,
  };
}
