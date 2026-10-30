import { type RawStreams,roundDurationSOf } from "@gladlog/analysis";

import { bridge } from "../../bridge";
import { toLegacySafe } from "./legacySource";
import type { ReportSource } from "./types";

/**
 * Intent guard (BACKLOG #26 Task 2, 意图守护): a session-lifetime, in-memory
 * cache of `RawStreams` keyed by `source.id` (a match's or shuffle round's
 * own content-hash id — the same value every caller already passes around as
 * `matchId`; ShuffleReport sets `matchId={round.id}` `source={round}`
 * verbatim, so the two are always identical in practice). Backs
 * `extractCandidateFindings`'s optional `rawStreams` param in
 * `analysisInput.ts`.
 *
 * Two ids, one cache key: `source.id` (round-specific — each shuffle round
 * needs its OWN parsed `RawStreams`, since `parseRawStreams` bakes in
 * `baseMs` = that round's own startTime) is NOT the same as the on-disk
 * STORAGE id `MatchStore` resolves raw.txt from (for a shuffle, that is the
 * *lobby's* directory, "= first round's id" per `MatchReport.tsx`'s
 * `videoMatchId` doc comment — rounds 2-6 have a different `source.id` from
 * it). So every write here takes an explicit `storageId` (defaults to the
 * cache key for the common case where they coincide — a regular match, or a
 * shuffle's first round) while the cache itself stays keyed by the
 * round-specific id every reader already has.
 *
 * Why a cache instead of an inline `await` inside `buildAnalysisInput`/
 * `buildWindowAnalysisRequest`: both are called SYNCHRONOUSLY, several times,
 * from many render-path call sites (StructuredAnalysisPanel, VideoTab,
 * CoachChatCard, MatchReport's own window-analysis loop) — making them async
 * to await an IPC round-trip on every call would ripple into every one of
 * those callers' effect/memo plumbing, a much bigger blast radius than this
 * task's guard warrants. Instead: `prefetchRawStreams`/`ensureRawStreams` are
 * the ONLY writers (called from `MatchReport.tsx` on mount, with the correct
 * `storageId`, and from `batchAnalysis.ts`'s driver, which has the real
 * on-disk id directly from the match list) — `buildAnalysisInput`/
 * `buildWindowAnalysisRequest` only ever do a synchronous `getRawStreamsSync`
 * READ, never trigger a write themselves. This is deliberate, not an
 * oversight: a reader that doesn't know the correct `storageId` and
 * defaulted to guessing (cache key == storage id) could, on a shuffle round
 * 2-6, race the correct writer and poison the cache with a false
 * `available:false` (the wrong directory simply doesn't exist) that the
 * later correct write would never overwrite (`fetchRawStreams` short-circuits
 * once an entry exists). Keeping writes to the few call sites that actually
 * know the right storage id avoids that failure mode entirely.
 *
 * `parseRawStreams` on the largest sampled real raw.txt (Task 1 report:
 * 70.8MB) took 681ms end-to-end including the read, so a match-open-time
 * kickoff comfortably beats a user's click. A cache miss (prefetch hasn't
 * landed yet, or no `window.gladlog` bridge — fixture/E2E mode) degrades to
 * `undefined`, and every downstream consumer already treats `rawStreams`
 * absent as "keep existing behavior" (Global Constraint, docs/superpowers/
 * plans/2026-08-15-raw-streams.md) — so a cold cache is never a correctness
 * bug, only a missed guard for that one call.
 */
const cache = new Map<string, RawStreams>();
const inFlight = new Map<string, Promise<RawStreams>>();

const UNAVAILABLE: RawStreams = {
  available: false,
  manaSamples: [],
  castFailed: [],
};

/** Idempotent per cache key: a second call while a fetch is in flight, or
 * after one has already landed, returns the same promise/cached value —
 * there is exactly one fetch path, shared by `prefetchRawStreams`
 * (fire-and-forget) and `ensureRawStreams` (awaited). */
function fetchRawStreams(
  source: ReportSource,
  storageId: string,
): Promise<RawStreams> {
  const cacheKey = source.id;
  const cached = cache.get(cacheKey);
  if (cached) return Promise.resolve(cached);
  const already = inFlight.get(cacheKey);
  if (already) return already;
  // bridge()/toLegacySafe wrapped together: a fixture/test double without
  // `matches.getRawStreams`, a missing window.gladlog (no preload context),
  // or a source that fails legacy conversion must all degrade the same way —
  // silently, never throw (Global Constraint).
  let baseMs: number;
  let roundDurationS: number | undefined;
  let getRawStreams:
    | ((
        id: string,
        baseMs: number,
        roundDurationS?: number,
      ) => Promise<RawStreams>)
    | undefined;
  try {
    getRawStreams = bridge()?.matches?.getRawStreams;
    const legacy = toLegacySafe(source);
    baseMs = legacy.startTime ?? 0;
    // BACKLOG #32: this source's OWN round span (never the whole shuffle
    // lobby's) — `toLegacySafe` already converts exactly the one round
    // `source` refers to, so `endTime - startTime` is this round's own
    // duration, the exact bound `parseRawStreams`' clamp needs.
    // `roundDurationSOf` is the guarded, single-sourced derivation (BACKLOG
    // #26 final review §2.d.2): a missing/non-finite `endTime` (older
    // fixture shapes) falls back to `undefined` (unbounded), NOT a
    // fabricated 0/negative duration — `?? 0` here would silently clamp
    // every sample out, a worse failure than no clamp at all.
    roundDurationS = roundDurationSOf(baseMs, legacy.endTime);
  } catch {
    return Promise.resolve(UNAVAILABLE);
  }
  if (!getRawStreams) return Promise.resolve(UNAVAILABLE);
  const p = getRawStreams(storageId, baseMs, roundDurationS)
    .then((rs) => rs ?? UNAVAILABLE)
    .catch(() => UNAVAILABLE)
    .then((rs) => {
      cache.set(cacheKey, rs);
      inFlight.delete(cacheKey);
      return rs;
    });
  inFlight.set(cacheKey, p);
  return p;
}

/** Fire-and-forget kickoff — call as soon as a match is opened (well before
 * the user can click "Analyze"), so later synchronous `getRawStreamsSync`
 * reads land warm. `storageId` defaults to `source.id` (correct for a
 * regular match / a shuffle's first round); pass the lobby's real storage id
 * explicitly for any other shuffle round (see this module's doc comment). */
export function prefetchRawStreams(
  source: ReportSource,
  storageId: string = source.id,
): void {
  void fetchRawStreams(source, storageId);
}

/** Synchronous cache read, keyed by `source.id` (== the `matchId` every
 * caller already carries) — `undefined` on a cold/unfetched entry, the same
 * "absent" shape `extractCandidateFindings`'s `rawStreams` param already
 * degrades silently on. */
export function getRawStreamsSync(sourceId: string): RawStreams | undefined {
  return cache.get(sourceId);
}

/** For callers that can afford to await (`batchAnalysis.ts`'s per-match
 * driver) and would rather have a deterministic guard than race a
 * fire-and-forget kickoff — same single fetch path as `prefetchRawStreams`,
 * just awaited instead of fired-and-forgotten. */
export function ensureRawStreams(
  source: ReportSource,
  storageId: string = source.id,
): Promise<RawStreams> {
  return fetchRawStreams(source, storageId);
}
