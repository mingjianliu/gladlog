import { gunzipSync } from "node:zlib";

export interface MatchStub {
  id: string;
  bracket: string;
  rating: number;
  logObjectUrl: string;
}

const FEED_ENDPOINT = "https://wowarenalogs.com/api/graphql";
// The real query (taken from fetchStubs in the old CLEAN fork; proven by a
// go/no-go smoke test). minRating is a **server-side** variable — the returned
// combats are already rating-filtered, so the client must not filter by rating
// again. `combats` is the interface type CombatDataStub, so fields must be
// selected through `... on ArenaMatchDataStub` / `... on ShuffleRoundStub`
// inline fragments (selecting fields directly returns 400).
const STUBS_QUERY = `query GetLatestMatches($wowVersion: String!, $bracket: String, $offset: Int!, $count: Int!, $minRating: Float) {
  latestMatches(wowVersion: $wowVersion, bracket: $bracket, offset: $offset, count: $count, minRating: $minRating) {
    combats {
      ... on ArenaMatchDataStub { id logObjectUrl startInfo { bracket } }
      ... on ShuffleRoundStub { id logObjectUrl startInfo { bracket } }
    }
  }
}`;

type FetchResponse = {
  ok: boolean;
  status?: number;
  json: () => Promise<any>;
  text?: () => Promise<any>;
};
type FetchLike = (url: string, init?: any) => Promise<FetchResponse>;

/**
 * Outbound identity. wowarenalogs is a **third-party volunteer project** and the
 * feed and GCS bills are theirs; bare node-fetch default headers would make us
 * indistinguishable from any random crawler in their logs — their only recourse
 * would be a blanket IP ban that also hits innocent traffic. Carrying the tool
 * name and repo URL lets them find out who we are and what we are doing at any
 * time, and gives them a way to reach us if they want us to slow down or stop.
 * Compliance rationale: docs/DATA-COMPLIANCE.md.
 */
export const USER_AGENT =
  "gladlog-corpus-tools/1.0 (+https://github.com/mingjianliu/gladlog)";

/**
 * Merge the UA into init.headers while preserving the caller's own headers. init
 * may be undefined (a bare GCS GET), in which case an init carrying the UA is
 * still constructed — this is the single source, so callers never have to
 * remember it individually.
 */
export function withUserAgent(init: any): any {
  return {
    ...(init ?? {}),
    headers: { ...((init?.headers as any) ?? {}), "user-agent": USER_AGENT },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Per-attempt wall-clock budget for feed queries (small JSON responses). */
export const FEED_TIMEOUT_MS = 60_000;
/**
 * Per-attempt budget for a GCS log download including body read. A full Solo
 * Shuffle log is ~30MB; at a modest 1MB/s that is 30s, so 5 min is generous
 * for "slow" while still turning "hung" into a retry.
 */
export const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
/** Download attempts = retries + 1; worst case per match ≈ 3 × DOWNLOAD_TIMEOUT_MS. */
export const DOWNLOAD_RETRIES = 2;

/**
 * Fetch with exponential backoff. A production corpus build makes thousands of
 * feed requests; transient 429/5xx and network blips are expected and must not
 * abort the whole run. Retries only retryable failures (429, 5xx, network
 * errors, timeouts); 4xx (other than 429) throw immediately. Exposed for unit
 * testing.
 *
 * Every attempt runs under an AbortController with a `timeoutMs` budget, and
 * when `consume` is given the body read happens inside that budget too: the
 * 2026-08-21 archive run hung for 30+ min with the event loop idle on one GCS
 * socket — headers had arrived, `arrayBuffer()` never resolved, and nothing
 * was armed to notice. A timeout counts as a network error → retried.
 */
type RetryOpts = { retries?: number; baseDelayMs?: number; timeoutMs?: number };
// Overloads: without `consume` the caller gets the response (and owns the body);
// with `consume` they get whatever it resolved to. Keeps `fetchWithRetry<X>()`
// without a consume from claiming to return an X it never produces.
export async function fetchWithRetry(
  f: FetchLike,
  url: string,
  init: any,
  label: string,
  opts?: RetryOpts,
): Promise<FetchResponse>;
export async function fetchWithRetry<T>(
  f: FetchLike,
  url: string,
  init: any,
  label: string,
  opts: RetryOpts & { consume: (res: FetchResponse) => Promise<T> },
): Promise<T>;
export async function fetchWithRetry<T = FetchResponse>(
  f: FetchLike,
  url: string,
  init: any,
  label: string,
  opts: RetryOpts & { consume?: (res: FetchResponse) => Promise<T> } = {},
): Promise<T> {
  const retries = opts.retries ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const timeoutMs = opts.timeoutMs ?? FEED_TIMEOUT_MS;
  // The single outbound choke point: both feed queries and GCS log downloads go
  // through here, so attaching the UA once covers everything.
  const initWithUa = withUserAgent(init);
  let lastErr: Error = new Error(`${label}: no attempt made`);
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: FetchResponse | undefined;
    let body: T | undefined;
    let netErr: unknown;
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, timeoutMs);
    let success = false;
    try {
      res = await f(url, { ...initWithUa, signal: ctrl.signal });
      if (res.ok && opts.consume) body = await opts.consume(res);
      success = res.ok;
    } catch (e) {
      netErr = timedOut
        ? new Error(`${label}: timed out after ${timeoutMs}ms`)
        : e;
    } finally {
      clearTimeout(timer);
      // Non-ok responses (429/5xx/4xx) are never consumed by anyone: in
      // node-fetch an unread body keeps its socket paused and out of the
      // keep-alive pool, so over thousands of requests that is a leak. Abort
      // tears the connection down. On success without `consume` the caller
      // owns the body, so the controller must stay live. (agy flash review)
      if (!success) ctrl.abort();
    }
    if (success) return (opts.consume ? body : res) as T;
    const status = res?.status;
    const retryable =
      netErr != null || status === 429 || (!!status && status >= 500);
    lastErr =
      netErr instanceof Error
        ? netErr
        : new Error(`${label} HTTP ${status ?? "?"}`);
    if (!retryable || attempt === retries) throw lastErr;
    // exponential backoff with jitter, capped
    await sleep(
      Math.min(baseDelayMs * 2 ** attempt, 15000) + Math.random() * 500,
    );
  }
  throw lastErr;
}

export async function fetchMatchStubs(
  opts: { bracket: string; minRating: number; specId?: number; limit: number },
  fetchImpl?: FetchLike,
): Promise<MatchStub[]> {
  const f: FetchLike =
    fetchImpl ?? ((await import("node-fetch")).default as any);
  const out: MatchStub[] = [];
  let offset = 0;
  const page = 50;
  while (out.length < opts.limit) {
    const res = await fetchWithRetry(
      f,
      FEED_ENDPOINT,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: STUBS_QUERY,
          variables: {
            wowVersion: "retail",
            bracket: opts.bracket,
            offset,
            count: page,
            minRating: opts.minRating, // server-side filter
          },
        }),
      },
      "feed",
    );
    const combats = (await res.json())?.data?.latestMatches?.combats ?? [];
    if (combats.length === 0) break;
    for (const c of combats) {
      // The server already filtered by minRating; the client only maps.
      out.push({
        id: c.id,
        bracket: opts.bracket,
        rating: opts.minRating,
        logObjectUrl: c.logObjectUrl,
      });
      if (out.length >= opts.limit) break;
    }
    // A short page (fewer than the requested count) means the end of the feed;
    // this avoids re-requesting the same page forever against mock or real paging.
    if (combats.length < page) break;
    offset += page;
  }
  return out;
}

export async function downloadLogText(
  stub: MatchStub,
  fetchImpl?: FetchLike,
): Promise<string> {
  const f: FetchLike =
    fetchImpl ?? ((await import("node-fetch")).default as any);
  const res = await fetchWithRetry(
    f,
    stub.logObjectUrl,
    undefined,
    `log download for ${stub.id}`,
  );
  return await (res as any).text();
}

// ── Signed-in access (upstream change of 2026-09-08 / 2026-09-13) ──────────
// The upstream no longer serves the feed anonymously: `latestMatches` needs a
// Battle.net session ("Sign in with Battle.net to view matches."), the log
// bucket is private, and raw logs are handed out through `logDownloadUrl`
// as a 10-minute V4 signed URL charged against a flat quota of 15 distinct
// logs per user per UTC day (their `accessLimits.ts`; admins exempt, a
// `blocked` profile tag refuses everything). This is the interface their own
// web client uses — we consume it as offered and never around it:
// docs/DATA-COMPLIANCE.md §2.

/** next-auth v4 database-session cookie on an https origin. */
export const WAL_SESSION_COOKIE_NAME = "__Secure-next-auth.session-token";

/**
 * Normalise what the operator pasted into a Cookie header value. A bare token
 * (copied from DevTools → Application → Cookies → wowarenalogs.com) gets the
 * next-auth cookie name; a full `name=value; ...` header passes through.
 * Empty input throws rather than silently sending an anonymous request that
 * the server would refuse one round-trip later.
 */
export function sessionCookieHeader(raw: string): string {
  const v = (raw ?? "").trim();
  if (!v) {
    throw new Error(
      "session cookie is empty — set WAL_COOKIE (or WAL_COOKIE_FILE); see .claude/skills/fetch-pvp-logs",
    );
  }
  return v.includes("=") ? v : `${WAL_SESSION_COOKIE_NAME}=${v}`;
}

export interface GraphqlErrorInfo {
  code: string;
  message: string;
  extensions: Record<string, unknown>;
}

/**
 * GraphQL errors travel inside an HTTP 200, so `fetchWithRetry` neither
 * retries nor warns on them — the 2026-09-08 shutdown surfaced only as the
 * generic "empty latestMatches response" until someone printed the body.
 * Every feed call must classify the body before reading `data`.
 */
export function firstGraphqlError(json: any): GraphqlErrorInfo | null {
  const e = json?.errors?.[0];
  if (!e) return null;
  const extensions = (e.extensions ?? {}) as Record<string, unknown>;
  return {
    code: String(extensions.code ?? "UNKNOWN"),
    message: String(e.message ?? ""),
    extensions,
  };
}

/** A GraphQL-level refusal, with the upstream's own code and wording. */
export class FeedError extends Error {
  constructor(
    label: string,
    public readonly code: string,
    message: string,
  ) {
    super(`${label}: ${code}: ${message}`);
    this.name = "FeedError";
  }
}

/** The daily distinct-log quota is spent; resets at 00:00 UTC. */
export class LogQuotaExceededError extends FeedError {
  public readonly usedToday: number;
  public readonly quota: number;
  constructor(label: string, message: string, usedToday: number, quota: number) {
    super(label, "LOG_QUOTA_EXCEEDED", message);
    this.name = "LogQuotaExceededError";
    this.usedToday = usedToday;
    this.quota = quota;
  }
}

function throwOnGraphqlError(label: string, json: any): void {
  const err = firstGraphqlError(json);
  if (!err) return;
  if (err.code === "LOG_QUOTA_EXCEEDED") {
    throw new LogQuotaExceededError(
      label,
      err.message,
      Number(err.extensions.usedToday ?? NaN),
      Number(err.extensions.quota ?? NaN),
    );
  }
  throw new FeedError(label, err.code, err.message);
}

function graphqlHeaders(cookie?: string): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (cookie) h.cookie = sessionCookieHeader(cookie);
  return h;
}

/** Mirrors the upstream `LogDownloadGrant` type (their `accessGuard.ts`). */
export interface LogDownloadGrant {
  /** V4 signed URL for the raw gzip object; valid until `expiresAt`. */
  url: string;
  /** Epoch ms; 10 minutes from issue. Treat the URL as a short-lived credential. */
  expiresAt: number;
  /** Distinct logs charged to this user today, after this grant. */
  downloadsUsedToday: number;
  /** The flat daily quota (15 as of 2026-09-13). */
  downloadsQuota: number;
}

const LOG_GRANT_QUERY = `query GetLogDownloadUrl($matchId: String!) {
  logDownloadUrl(matchId: $matchId) { url expiresAt downloadsUsedToday downloadsQuota }
}`;

/**
 * Ask for a signed download URL. **The quota is charged here, not at
 * download time**: a grant whose download then fails has still cost one of
 * the day's 15 (re-requesting the same id the same day is free, so the
 * retry is cheap — but do request the grant immediately before downloading,
 * never in a batch ahead of time; the URL dies in 10 minutes).
 *
 * `matchId` is the **GCS object name**, i.e. the last path segment of the
 * stub's `logObjectUrl` — for a Solo Shuffle that is the shared per-match
 * object, not one of the six round stub ids (see `logObjectIdFromUrl`).
 */
export async function requestLogGrant(
  opts: { matchId: string; cookie: string },
  fetchImpl?: FetchLike,
): Promise<LogDownloadGrant> {
  if (!opts.matchId || opts.matchId.includes("/")) {
    throw new Error(`invalid match id for log grant: "${opts.matchId}"`);
  }
  const f: FetchLike =
    fetchImpl ?? ((await import("node-fetch")).default as any);
  const label = `log grant for ${opts.matchId}`;
  const res = await fetchWithRetry(
    f,
    FEED_ENDPOINT,
    {
      method: "POST",
      headers: graphqlHeaders(opts.cookie),
      body: JSON.stringify({
        query: LOG_GRANT_QUERY,
        variables: { matchId: opts.matchId },
      }),
    },
    label,
  );
  const json = await res.json();
  throwOnGraphqlError(label, json);
  const g = json?.data?.logDownloadUrl;
  if (!g?.url) throw new Error(`${label}: empty logDownloadUrl response`);
  return {
    url: String(g.url),
    expiresAt: Number(g.expiresAt),
    downloadsUsedToday: Number(g.downloadsUsedToday),
    downloadsQuota: Number(g.downloadsQuota),
  };
}

// ── Detailed stubs (for fetch-public corpus harvesting) ────────────────────
// Same endpoint / paging / retry as STUBS_QUERY; a superset of fields:
// identifies the recorder and advanced logging.
// Note: minRating is a server-side Firestore composite-index variable and must
// be passed together with bracket (bracket:null + minRating →
// FAILED_PRECONDITION, measured 2026-07-16).

export interface DetailedStubUnit {
  id: string;
  name: string;
  spec: string;
  reaction: number;
  // Player details derived from COMBATANT_INFO; null for non-player units
  // (pets / totems).
  info?: { specId: string; personalRating: number; teamId: string } | null;
}

export interface DetailedMatchStub {
  typename: string;
  id: string;
  logObjectUrl: string;
  playerId: string;
  hasAdvancedLogging: boolean;
  durationInSeconds: number;
  bracket: string;
  units: DetailedStubUnit[];
  // Rating / time metadata (fields confirmed by introspection 2026-07-29).
  // startTime is the uploader's epoch ms.
  startTime: number;
  result: number;
  playerTeamRating: number;
  winningTeamId: string;
  playerTeamId: string;
  team0MMR: number;
  team1MMR: number;
}

// compQueryString: server-side pre-indexed team spec-composition filter (specId
// strings sorted **lexicographically** and joined with `_`, e.g. "105_263";
// subsets are indexed too, and both teams are expressed as "AxB"). Only the four
// minRating tiers 1400/1800/2100/2400 take effect, and the criterion is the
// match's average MMR — all confirmed 2026-07-29 against the wowarenalogs source
// plus real requests.
const DETAILED_STUBS_QUERY = `query GetLatestMatchesDetailed($wowVersion: String!, $bracket: String, $offset: Int!, $count: Int!, $minRating: Float, $compQueryString: String) {
  latestMatches(wowVersion: $wowVersion, bracket: $bracket, offset: $offset, count: $count, minRating: $minRating, compQueryString: $compQueryString) {
    combats {
      __typename
      ... on ArenaMatchDataStub {
        id logObjectUrl playerId hasAdvancedLogging durationInSeconds
        startTime result playerTeamRating winningTeamId playerTeamId
        startInfo { bracket }
        endInfo { team0MMR team1MMR }
        units { id name spec reaction info { specId personalRating teamId } }
      }
      ... on ShuffleRoundStub {
        id logObjectUrl playerId hasAdvancedLogging durationInSeconds
        startTime result playerTeamRating winningTeamId playerTeamId
        startInfo { bracket }
        units { id name spec reaction info { specId personalRating teamId } }
      }
    }
    queryLimitReached
  }
}`;

export async function fetchDetailedStubs(
  opts: {
    bracket?: string;
    minRating?: number;
    offset?: number;
    count?: number;
    compQueryString?: string;
    /** Battle.net session (bare token or full Cookie header); required since 2026-09-13. */
    cookie?: string;
  },
  fetchImpl?: FetchLike,
): Promise<{ stubs: DetailedMatchStub[]; queryLimitReached: boolean }> {
  const f: FetchLike =
    fetchImpl ?? ((await import("node-fetch")).default as any);
  if (opts.minRating && !opts.bracket) {
    throw new Error(
      "minRating requires bracket (server-side composite index; 2026-07-16 FAILED_PRECONDITION)",
    );
  }
  const res = await fetchWithRetry(
    f,
    FEED_ENDPOINT,
    {
      method: "POST",
      headers: graphqlHeaders(opts.cookie),
      body: JSON.stringify({
        query: DETAILED_STUBS_QUERY,
        variables: {
          wowVersion: "retail",
          bracket: opts.bracket ?? null,
          offset: opts.offset ?? 0,
          count: opts.count ?? 50,
          minRating:
            opts.minRating && opts.minRating > 0 ? opts.minRating : null,
          compQueryString: opts.compQueryString ?? null,
        },
      }),
    },
    "feed-detailed",
  );
  const json = await res.json();
  throwOnGraphqlError("feed-detailed", json);
  const data = json?.data?.latestMatches;
  if (!data) throw new Error("feed-detailed: empty latestMatches response");
  const stubs: DetailedMatchStub[] = (data.combats ?? []).map((c: any) => ({
    typename: c.__typename ?? "",
    id: c.id,
    logObjectUrl: c.logObjectUrl,
    playerId: c.playerId ?? "",
    hasAdvancedLogging: !!c.hasAdvancedLogging,
    durationInSeconds: c.durationInSeconds ?? 0,
    bracket: c.startInfo?.bracket ?? "",
    units: c.units ?? [],
    startTime: c.startTime ?? 0,
    result: c.result ?? 0,
    playerTeamRating: c.playerTeamRating ?? 0,
    winningTeamId: c.winningTeamId ?? "",
    playerTeamId: c.playerTeamId ?? "",
    // ShuffleRoundStub has no endInfo (the whole-match MMR lives in
    // shuffleMatchEndInfo); default to 0.
    team0MMR: c.endInfo?.team0MMR ?? 0,
    team1MMR: c.endInfo?.team1MMR ?? 0,
  }));
  return { stubs, queryLimitReached: !!data.queryLimitReached };
}

/**
 * The byte count from the GCS response headers usable for integrity checking:
 * prefer x-goog-stored-content-length (the stored object's raw size, unaffected
 * by transfer-encoding), falling back to content-length. When neither is
 * available (some proxies and test fetches do not return them) it returns
 * undefined — callers then skip the byte check, because "no header" must not be
 * mistaken for "truncated".
 *
 * Moved here from pvpLogFetch.ts: downloadRaw needs it, and feedClient cannot
 * import a value from pvpLogFetch in the other direction (pvpLogFetch already
 * imports types from feedClient, so a value import back would be a runtime
 * cycle). The original location in pvpLogFetch.ts is now a one-line re-export.
 */
export function expectedByteLength(headers: {
  contentLength?: string;
  storedContentLength?: string;
}): number | undefined {
  const raw = headers.storedContentLength || headers.contentLength;
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export interface RawDownload {
  /** Undecompressed response body bytes. Objects on GCS are stored gzipped, so this is exactly those compressed bytes. */
  bytes: Buffer;
  /** The response's content-encoding, usually "gzip"; an empty string means uncompressed. */
  contentEncoding: string;
  /** Read a response header (lowercase name); returns an empty string when absent. */
  header(name: string): string;
  /** The byte count GCS declares (= compressed size), or undefined if unavailable. */
  expectedBytes: number | undefined;
}

/**
 * Download but **do not decompress**.
 *
 * node-fetch's default compress:true auto-gunzips, so content-length (the
 * compressed size) no longer matches the body length we get: truncation cannot
 * be verified, and we are forced to store their already-compressed data
 * decompressed (measured 11.4x inflation). compress:false stops node-fetch from
 * decompressing on the client.
 *
 * But compress:false alone is not enough — caught by real-machine verification
 * on 2026-08-01: node-fetch only adds `Accept-Encoding: gzip` automatically when
 * compress is true (see node-fetch v3 request.js `if (request.compress &&
 * !headers.has('Accept-Encoding'))`). With compress:false the request carries no
 * such header, and GCS's default behavior for gzip-stored objects is
 * **server-side transcoding**: without `Accept-Encoding: gzip` it decompresses
 * the object before sending, and the response then carries **no**
 * content-length/content-encoding (chunked) while
 * `x-goog-stored-content-length` (the compressed size) is still returned — so
 * the "expected compressed size, got decompressed byte count" mismatch replayed
 * itself at this layer, the same shape of bug as c9c463e, just moved from
 * "comparing at the text layer" to "never explicitly asking for a compressed
 * response". Hence `Accept-Encoding: gzip` must be declared explicitly so GCS
 * honestly emits compressed bytes, with compress:false keeping node-fetch from
 * unwrapping them for us on the client.
 */
export async function downloadRaw(
  url: string,
  label: string,
  fetchImpl?: FetchLike,
): Promise<RawDownload> {
  const f: FetchLike =
    fetchImpl ?? ((await import("node-fetch")).default as any);
  // Body read inside the retry/timeout scope: a stalled body after 200 OK is
  // exactly the hang this guards against.
  const { res, buf } = await fetchWithRetry(
    f,
    url,
    { compress: false, headers: { "accept-encoding": "gzip" } },
    label,
    {
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
      // 3 attempts, not the feed default of 5: a link too slow for 30MB in
      // 5 min would otherwise stall one match for 25 min before giving up.
      retries: DOWNLOAD_RETRIES,
      consume: async (r: any) => ({ res: r, buf: await r.arrayBuffer() }),
    },
  );
  const header = (name: string): string =>
    res.headers?.get?.(name.toLowerCase()) ?? "";
  const bytes = Buffer.from(buf);
  return {
    bytes,
    contentEncoding: header("content-encoding"),
    header,
    expectedBytes: expectedByteLength({
      contentLength: header("content-length"),
      storedContentLength: header("x-goog-stored-content-length"),
    }),
  };
}

/** Raw bytes → text. Whether to gunzip is decided by content-encoding. */
export function decodeRawPayload(raw: RawDownload): string {
  if (raw.contentEncoding === "gzip") {
    return gunzipSync(raw.bytes).toString("utf8");
  }
  return raw.bytes.toString("utf8");
}
