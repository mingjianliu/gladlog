import { CombatUnitSpec } from "@gladlog/parser-compat";

import type { DetailedMatchStub } from "./feedClient";

export type SpecRole = "recorder" | "any";

export const KNOWN_BRACKETS = ["2v2", "3v3", "Rated Solo Shuffle"] as const;
export type Bracket = (typeof KNOWN_BRACKETS)[number];

/**
 * BRACKET validation: the server only recognizes these three, and a misspelled
 * value (e.g. "Ratad Solo Shuffle") used to silently return empty results
 * instead of erroring. Mirrors the existing SPEC/SPEC_ROLE principle of "a
 * typo raises, no fuzzy correction" -- same class of trap, same class of fix.
 */
export function isKnownBracket(value: string): value is Bracket {
  return (KNOWN_BRACKETS as readonly string[]).includes(value);
}

/**
 * Which brackets the unattended archiver (`scripts/archivePvpLogs.ts`) sweeps
 * every round. Deliberately **not** KNOWN_BRACKETS, and nobody should "unify"
 * the two: KNOWN_BRACKETS is a fact about the server (the three values its feed
 * accepts, so a typo raises instead of silently querying empty), while this is
 * our own collection policy. 2v2 was dropped by user ruling on 2026-09-04; the
 * corpus work it fed had already ruled it out (review-bench value-by-mode found
 * no 2v2 impact; the rotation study dropped it on 2026-08-29). Measured on the
 * 2026-09-04 round (7,937 matches over the three day shards it created): 2v2 is
 * **34.8% of the downloads but only 13.0% of the bytes**, so the saving is
 * wall-clock, not Drive runway — a round costs one DOWNLOAD_SLEEP_MS per match
 * regardless of its size. Rated Solo Shuffle is the opposite shape (16.4% of
 * matches, 50.2% of bytes); bracket counts and bracket bytes are not
 * interchangeable when sizing either.
 *
 * The `readonly Bracket[]` annotation is the structural coupling rather than a
 * comment: a bracket the server does not recognize will not compile here.
 * Narrowing KNOWN_BRACKETS instead would have made an explicit, human-initiated
 * `BRACKET=2v2 npm run logs:fetch-public` throw — a separate on-demand pull
 * that nobody asked to remove.
 */
export const ARCHIVED_BRACKETS: readonly Bracket[] = [
  "3v3",
  "Rated Solo Shuffle",
];

/**
 * Paging throttle predicate: should we pause before fetching this page (see
 * the politeness note on PAGE_SLEEP_MS at the top of fetchPvpLogs.ts). The
 * first page (page===0) needs no wait -- there is no earlier request to space
 * out from, and the first call should not slow startup for nothing.
 */
export function shouldSleepBeforePage(page: number): boolean {
  return page > 0;
}

/**
 * Download throttle predicate: should we pause before downloading this match.
 * Structurally the same as shouldSleepBeforePage (no wait on the first one),
 * but the **budget is separate** -- feed queries hit their Firestore reads,
 * while a single log download hits GCS egress bandwidth (up to ~30MB per
 * match); the two costs differ by orders of magnitude and must be counted
 * separately. See DOWNLOAD_SLEEP_MS in fetchPvpLogs.ts and the
 * collection-restraint section of docs/DATA-COMPLIANCE.md.
 */
export function shouldSleepBeforeDownload(downloadsDone: number): boolean {
  return downloadsDone > 0;
}

const SPEC_NAME_TO_ID: Record<string, string> = Object.fromEntries(
  Object.entries(CombatUnitSpec).filter(([k]) => k !== "None"),
);

/**
 * Parse the SPEC argument: comma-separated, each item either a numeric specId
 * ("264") or a CombatUnitSpec enum name ("Shaman_Restoration"); returns an
 * array of specId strings. An unknown name throws and lists the legal names,
 * with no fuzzy guessing -- silently pulling the whole feed because of a
 * misspelled spec costs far more than an error.
 */
export function parseSpecArg(arg: string): string[] {
  const out: string[] = [];
  for (const raw of arg.split(",")) {
    const item = raw.trim();
    if (!item) continue;
    if (/^\d+$/.test(item)) {
      out.push(item);
      continue;
    }
    const id = SPEC_NAME_TO_ID[item];
    if (!id) {
      throw new Error(
        `unknown spec "${item}"; use a numeric specId or one of: ${Object.keys(SPEC_NAME_TO_ID).join(", ")}`,
      );
    }
    out.push(id);
  }
  return out;
}

/**
 * wowarenalogs server-side comp index encoding: specIds sorted by **string
 * lexicographic order** and joined with `_` (["263","1468"] -> "1468_263", not
 * numeric order). Subsets are pre-indexed too, so 1-2 specs are enough to match
 * any team containing that combination. Verified 2026-07-29 against the
 * buildQueryHelpers source plus live requests.
 */
export function buildCompQueryString(specIds: string[]): string {
  return [...specIds].sort().join("_");
}

/**
 * Client-side spec refinement. The server's compQueryString only guarantees
 * "some team contains these specs"; the recorder semantics (the uploader
 * themselves plays that spec, giving the best advanced-logging viewpoint) must
 * be re-checked client-side by matching playerId back against units.
 */
export function matchesSpecFilter(
  stub: DetailedMatchStub,
  specIds: string[],
  role: SpecRole,
): boolean {
  if (specIds.length === 0) return true;
  const set = new Set(specIds);
  if (role === "recorder") {
    const recorder = stub.units.find((u) => u.id === stub.playerId);
    return !!recorder && set.has(recorder.spec);
  }
  return stub.units.some((u) => set.has(u.spec));
}

/**
 * A Solo Shuffle match emits one ShuffleRoundStub per each of its 6 rounds, but
 * logObjectUrl points at the same GCS object shared by the whole match -- dedupe
 * by logObjectUrl, keeping the first stub seen, so the same file is not
 * downloaded 6 times.
 */
export function dedupeByLogObject(
  stubs: DetailedMatchStub[],
): DetailedMatchStub[] {
  const seen = new Set<string>();
  const out: DetailedMatchStub[] = [];
  for (const s of stubs) {
    if (seen.has(s.logObjectUrl)) continue;
    seen.add(s.logObjectUrl);
    out.push(s);
  }
  return out;
}

export interface ManifestPlayer {
  name: string;
  spec: string;
  teamId: string;
  personalRating: number;
}

export interface ManifestEntry {
  id: string;
  typename: string;
  bracket: string;
  fileName: string;
  logObjectUrl: string;
  startTime: number;
  durationInSeconds: number;
  hasAdvancedLogging: boolean;
  playerTeamRating: number;
  playerTeamId: string;
  winningTeamId: string;
  result: number;
  team0MMR: number;
  team1MMR: number;
  recorder: ManifestPlayer | null;
  players: ManifestPlayer[];
  // GCS object meta (captured at download time). Log-text timestamps carry no
  // year and are in the uploader's local timezone, so these headers are the
  // only way to reconstruct absolute time. Each field is optional: an old
  // uploader client or a header-stripping CDN leaves it missing, and missing
  // must mean "the key is absent" rather than an empty string -- an empty
  // string is a signal-free landmine for future absolute-time reconstruction
  // consumers (the reader cannot tell "confirmed empty" from "never captured").
  // Old manifests (historical data where the fields are all "") still read back
  // compatibly as string.
  gcsMeta?: GcsMeta;
}

/**
 * The four `x-goog-meta-*` fields needed to reconstruct absolute time. This
 * shape is **defined once** -- the manifest (fetchPvpLogs) and the archive
 * ledger (archiveLedger) store the same batch of headers, so both point here;
 * do not write it out twice.
 */
export interface GcsMeta {
  wowVersion?: string;
  clientTimezone?: string;
  clientYear?: string;
  startTimeUtc?: string;
}

// expectedByteLength has moved to feedClient.ts (downloadRaw needs it, and
// feedClient must not import values back from pvpLogFetch, to avoid a runtime
// cycle). This is only a re-export, keeping the import path unchanged for
// existing callers and this file's tests.
export { expectedByteLength } from "./feedClient";

export interface GcsMetaHeaders {
  wowVersion: string;
  clientTimezone: string;
  clientYear: string;
  startTimeUtc: string;
}

export interface GcsMetaResult {
  meta: GcsMeta;
  missingFields: string[];
}

/**
 * Turn the 4 `x-goog-meta-*` header values (upstream passes "" by convention
 * when a header is absent) into the gcsMeta shape the manifest writes: fields
 * actually obtained are written as-is, while fields we could not get have
 * **their key omitted entirely** (rather than written as ""), so that "missing"
 * and "confirmed empty string" stay distinguishable in the data -- future
 * absolute-time reconstruction consumers must not mistake a silent empty string
 * for "this client genuinely has no timezone".
 * The missing field names are also collected so the caller can log one warn
 * line (triggered by old uploader clients and header-stripping CDNs; worth a
 * trace but not fatal, so the download is not interrupted).
 */
export function buildGcsMeta(headers: GcsMetaHeaders): GcsMetaResult {
  const meta: GcsMeta = {};
  const missingFields: string[] = [];
  const entries: Array<[keyof GcsMetaHeaders, string]> = [
    ["wowVersion", headers.wowVersion],
    ["clientTimezone", headers.clientTimezone],
    ["clientYear", headers.clientYear],
    ["startTimeUtc", headers.startTimeUtc],
  ];
  for (const [key, value] of entries) {
    if (value === "") {
      missingFields.push(key);
    } else {
      meta[key] = value;
    }
  }
  return { meta, missingFields };
}

export interface CompletenessResult {
  ok: boolean;
  reason?: string;
}

/**
 * Raw-byte layer check: the number of compressed bytes received must exactly
 * equal the content-length GCS reported.
 *
 * This is what catches an HTTP 200 whose connection dies mid-stream (a full SS
 * match can be 30MB). It **must compare undecompressed bytes** -- the GCS-side
 * object is gzip-stored (content-encoding: gzip) and content-length is the
 * compressed size; comparing it against the decompressed text length never
 * matches, which is exactly the "every match judged truncated" bug introduced
 * in c9c463e and confirmed by measurement on 2026-08-01.
 */
export function checkRawPayloadBytes(
  receivedBytes: number,
  expectedBytes: number | undefined,
): CompletenessResult {
  if (expectedBytes === undefined) return { ok: true };
  if (receivedBytes !== expectedBytes) {
    return {
      ok: false,
      reason: `byte length mismatch: expected ${expectedBytes}, got ${receivedBytes}`,
    };
  }
  return { ok: true };
}

/**
 * Decompressed-text layer check: both sentinels must be present.
 *
 * ARENA_MATCH_END is checked too -- the 6 Solo Shuffle rounds share one log
 * object, a round change only emits a new START, and END is emitted exactly
 * once when the whole match ends (verified in segmenter.ts), so a complete
 * payload ends with END just like a normal match and the predicate needs no
 * per-bracket branching.
 *
 * This layer **ignores byte counts**: byte counts are about the raw compressed
 * bytes, see checkRawPayloadBytes.
 */
export function checkDecompressedPayload(text: string): CompletenessResult {
  if (!text.includes("ARENA_MATCH_START")) {
    return { ok: false, reason: "missing ARENA_MATCH_START" };
  }
  if (!text.includes("ARENA_MATCH_END")) {
    return { ok: false, reason: "missing ARENA_MATCH_END" };
  }
  return { ok: true };
}

/**
 * Write into the manifest deduped by id (rather than unconditionally pushing):
 * when a file was deleted by hand but its manifest row survived, re-downloading
 * would create a second record with the same id. On an id hit replace in place,
 * otherwise append. The passed array is mutated in place (the script writes the
 * same `manifest` variable to disk) and also returned for chaining/test
 * assertions.
 */
export function upsertManifestEntry(
  manifest: ManifestEntry[],
  entry: ManifestEntry,
): ManifestEntry[] {
  const idx = manifest.findIndex((e) => e.id === entry.id);
  if (idx === -1) {
    manifest.push(entry);
  } else {
    manifest[idx] = entry;
  }
  return manifest;
}

export function stubToManifestEntry(
  stub: DetailedMatchStub,
  fileName: string,
): ManifestEntry {
  const players: ManifestPlayer[] = stub.units
    .filter((u) => u.info != null)
    .map((u) => ({
      name: u.name,
      spec: u.spec,
      teamId: u.info!.teamId,
      personalRating: u.info!.personalRating,
    }));
  const rec = stub.units.find((u) => u.id === stub.playerId);
  const recorder: ManifestPlayer | null = rec
    ? {
        name: rec.name,
        spec: rec.spec,
        teamId: rec.info?.teamId ?? "",
        personalRating: rec.info?.personalRating ?? 0,
      }
    : null;
  return {
    id: stub.id,
    typename: stub.typename,
    bracket: stub.bracket,
    fileName,
    logObjectUrl: stub.logObjectUrl,
    startTime: stub.startTime,
    durationInSeconds: stub.durationInSeconds,
    hasAdvancedLogging: stub.hasAdvancedLogging,
    playerTeamRating: stub.playerTeamRating,
    playerTeamId: stub.playerTeamId,
    winningTeamId: stub.winningTeamId,
    result: stub.result,
    team0MMR: stub.team0MMR,
    team1MMR: stub.team1MMR,
    recorder,
    players,
  };
}
