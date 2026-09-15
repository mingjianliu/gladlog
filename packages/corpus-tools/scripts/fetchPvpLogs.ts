// Download other players' raw PvP combat logs (wowarenalogs, signed in),
// filtered by spec/rating. Since 2026-09-13 the upstream requires a Battle.net
// session for search and hands out each raw log as a 10-minute signed URL
// charged against a flat quota of 15 distinct logs per user per UTC day —
// this is a targeted-sampling tool, not a corpus collector.
// See .claude/skills/fetch-pvp-logs for usage; typical invocation:
//   WAL_COOKIE=<session token> SPEC=Shaman_Restoration MIN_RATING=2100 npx tsx scripts/fetchPvpLogs.ts
import fs from "fs-extra";
import os from "os";
import path from "path";

import {
  decodeRawPayload,
  downloadRaw,
  FeedError,
  fetchDetailedStubs,
  type LogDownloadGrant,
  LogQuotaExceededError,
  requestLogGrant,
  sessionCookieHeader,
} from "../src/feedClient";
import { EXIT_AUTH } from "../src/dailyPull";
import {
  buildCompQueryString,
  buildGcsMeta,
  checkDecompressedPayload,
  checkRawPayloadBytes,
  dedupeByLogObject,
  grantsRemaining,
  isKnownBracket,
  KNOWN_BRACKETS,
  logObjectIdFromUrl,
  type ManifestEntry,
  matchesSpecFilter,
  nextUtcMidnight,
  parseSpecArg,
  quotaAlreadySpent,
  type QuotaState,
  shouldSleepBeforeDownload,
  shouldSleepBeforePage,
  type SpecRole,
  stubToManifestEntry,
  upsertManifestEntry,
  utcDayKey,
} from "../src/pvpLogFetch";

const BRACKET = process.env.BRACKET ?? "3v3"; // "2v2" | "3v3" | "Rated Solo Shuffle"
// Server-side only four tiers take effect: 1400/1800/2100/2400 (by average
// match MMR); pass 0 for no filtering
const MIN_RATING = Number(process.env.MIN_RATING ?? 0);
const SPEC = process.env.SPEC ?? ""; // Comma separated, numeric id or enum name
const SPEC_ROLE = (process.env.SPEC_ROLE ?? "recorder") as SpecRole;
// Default = the upstream's whole daily quota; the server's own counter is the
// hard stop regardless of what is asked for here.
const LIMIT = Number(process.env.LIMIT ?? 15);
// The feed only keeps the last ~7 days, and deep paging bills their Firestore
// -- a backstop so we do not page forever
const MAX_PAGES = Number(process.env.MAX_PAGES ?? 40);
// The Firestore/GCS bill of a volunteer project (wowarenalogs) is not ours --
// so throttle politely: always pause between pages. See the "polite request
// rate" item in .claude/skills/fetch-pvp-logs: they impose no rate limit, but
// do not hammer them concurrently and do not page through empty results.
const PAGE_SLEEP_MS = 500;
// The download budget is separate from the paging budget: paging costs
// Firestore reads, downloading costs GCS egress bandwidth, and a single log
// can reach ~30MB -- reasoning by analogy with the page interval badly
// underestimates the download-side cost. The default is 2s and serial, a
// fraction of a ~15MB/s peak; when rushing to build a corpus you can tune
// DOWNLOAD_SLEEP_MS, but never to 0.
const DOWNLOAD_SLEEP_MS = Number(process.env.DOWNLOAD_SLEEP_MS ?? 2000);
const EVAL_HOME =
  process.env.GLADLOG_EVAL_HOME ??
  path.join(os.homedir(), "code/gladlog-eval-private");
// Battle.net session: WAL_COOKIE inline, or a file holding it. The default
// file lives outside every repo on purpose — a session token is a credential,
// and eval-private is still a git repo.
const COOKIE_FILE =
  process.env.WAL_COOKIE_FILE ??
  path.join(os.homedir(), ".gladlog", "wal-session-cookie");
const COOKIE_HELP = `no Battle.net session. Sign in at https://wowarenalogs.com in Chrome, then
DevTools → Application → Cookies → https://wowarenalogs.com → copy the value of
__Secure-next-auth.session-token and either export WAL_COOKIE=<value> or write it
to ${COOKIE_FILE} (chmod 600). Details: .claude/skills/fetch-pvp-logs`;

function loadSessionCookie(): string {
  const inline = process.env.WAL_COOKIE?.trim();
  if (inline) return sessionCookieHeader(inline);
  if (fs.pathExistsSync(COOKIE_FILE)) {
    return sessionCookieHeader(fs.readFileSync(COOKIE_FILE, "utf8"));
  }
  console.error(COOKIE_HELP);
  // Distinct exit code so the daily driver can tell "cookie problem" from
  // any other failure and notify the operator to re-login.
  process.exit(EXIT_AUTH);
}

if (!isKnownBracket(BRACKET)) {
  console.error(
    `BRACKET must be one of ${KNOWN_BRACKETS.map((b) => `"${b}"`).join(", ")}, got "${BRACKET}"`,
  );
  process.exit(1);
}

if (SPEC_ROLE !== "recorder" && SPEC_ROLE !== "any") {
  console.error(`SPEC_ROLE must be "recorder" or "any", got "${SPEC_ROLE}"`);
  process.exit(1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const specIds = parseSpecArg(SPEC);
const slug = [
  BRACKET.replace(/\s+/g, ""),
  MIN_RATING > 0 ? `r${MIN_RATING}` : "rall",
  specIds.length ? `${SPEC_ROLE}-${specIds.join("_")}` : "allspecs",
].join("-");
// Defaults to outside the repo ($GLADLOG_EVAL_HOME); OUT_DIR= can override it
// to any path -- if you point it inside the repo, the root .gitignore's
// `**/downloads/` plus packages/corpus-tools/.gitignore are the backstop, but
// do not rely on them: manifest.json and the raw logs contain other players'
// names/ratings, and must never be carried into the public repo by a
// `git add -A` (this nearly happened in 2026-07 via a scratch-directory
// override).
const OUT_DIR = process.env.OUT_DIR ?? path.join(EVAL_HOME, "downloads", slug);
const MANIFEST = path.join(OUT_DIR, "manifest.json");
// The quota is per account per UTC day, not per filter, so its record lives
// above every OUT_DIR: a second run the same day — any bracket, any spec —
// must be able to see that the day is spent and exit without one request.
const QUOTA_STATE = path.join(EVAL_HOME, "downloads", "wal-quota-state.json");

async function saveQuotaState(state: QuotaState): Promise<void> {
  await fs.ensureDir(path.dirname(QUOTA_STATE));
  await fs.writeJson(QUOTA_STATE, state, { spaces: 2 });
}

async function downloadWithMeta(
  url: string,
  id: string,
): Promise<{
  text: string;
  meta: NonNullable<ManifestEntry["gcsMeta"]>;
  rawCheck: ReturnType<typeof checkRawPayloadBytes>;
}> {
  const raw = await downloadRaw(url, `log download for ${id}`);
  const { meta, missingFields } = buildGcsMeta({
    wowVersion: raw.header("x-goog-meta-wow-version"),
    clientTimezone: raw.header("x-goog-meta-client-timezone"),
    clientYear: raw.header("x-goog-meta-client-year"),
    startTimeUtc: raw.header("x-goog-meta-starttime-utc"),
  });
  if (missingFields.length > 0) {
    console.warn(`  ${id}: gcsMeta 缺字段 ${missingFields.join(",")}`);
  }
  // The byte-count check must be done on the **undecompressed** bytes;
  // comparing after decompression was the bug in c9c463e.
  const rawCheck = checkRawPayloadBytes(raw.bytes.length, raw.expectedBytes);
  return { text: rawCheck.ok ? decodeRawPayload(raw) : "", meta, rawCheck };
}

async function main() {
  const cookie = loadSessionCookie();
  const prior: QuotaState | undefined = (await fs.pathExists(QUOTA_STATE))
    ? await fs.readJson(QUOTA_STATE)
    : undefined;
  if (quotaAlreadySpent(prior)) {
    console.log(
      `today's upstream quota is already spent (${prior!.downloadsUsedToday}/${prior!.downloadsQuota}, UTC ${prior!.utcDay}); no request made. Resets ${nextUtcMidnight().toISOString()}.`,
    );
    return;
  }
  await fs.ensureDir(OUT_DIR);
  // Resume support: skip matches already in the manifest whose file is on disk
  const manifest: ManifestEntry[] = (await fs.pathExists(MANIFEST))
    ? await fs.readJson(MANIFEST)
    : [];
  const have = new Set(
    manifest
      .filter((e) => fs.pathExistsSync(path.join(OUT_DIR, e.fileName)))
      .map((e) => e.id),
  );
  const haveLogs = new Set(
    manifest.filter((e) => have.has(e.id)).map((e) => e.logObjectUrl),
  );

  console.log(
    `bracket=${BRACKET} minRating=${MIN_RATING || "off"} spec=${specIds.join(",") || "all"} role=${SPEC_ROLE} limit=${LIMIT}`,
  );
  console.log(`out: ${OUT_DIR} (resume: ${have.size} already downloaded)`);

  let fresh = 0;
  let scanned = 0;
  let pagesFetched = 0;
  let downloadsAttempted = 0;
  let lastGrant: LogDownloadGrant | undefined;
  let quotaHit: LogQuotaExceededError | undefined;
  // Either way the day is over: the server refused, or its counter reached the quota.
  const quotaReached = () =>
    quotaHit !== undefined || (lastGrant !== undefined && grantsRemaining(lastGrant) === 0);
  pages: for (let page = 0; page < MAX_PAGES && fresh < LIMIT; page++) {
    // No need to wait before the first page (there is no earlier request to
    // space out from); every page after that sleeps PAGE_SLEEP_MS first.
    // The "should we sleep" predicate (shouldSleepBeforePage) has unit test
    // coverage; main() itself is a top-level immediately-executed script
    // (there is no fetchPvpLogs.test.ts, and like MAX_PAGES and the resume
    // logic it is not directly exercised by unit tests), so wiring it into
    // the real setTimeout loop is not covered by an extra test -- if it ever
    // breaks, the page intervals in a real run's log will show it.
    if (shouldSleepBeforePage(page)) await sleep(PAGE_SLEEP_MS);
    let stubs;
    try {
      ({ stubs } = await fetchDetailedStubs({
        bracket: BRACKET,
        minRating: MIN_RATING > 0 ? MIN_RATING : undefined,
        // Server-side comp pre-filter (some team contains these specs); the
        // recorder semantics are refined client-side
        compQueryString: specIds.length
          ? buildCompQueryString(specIds)
          : undefined,
        offset: page * 50,
        count: 50,
        cookie,
      }));
    } catch (e) {
      if (e instanceof FeedError && e.code === "UNAUTHENTICATED") {
        console.error(`session rejected (${e.message}) — the cookie is stale or wrong.\n${COOKIE_HELP}`);
        process.exit(EXIT_AUTH);
      }
      throw e;
    }
    if (stubs.length === 0) break;
    pagesFetched++;
    scanned += stubs.length;
    // A shuffle's 6 rounds share one log object: dedupe within the page and
    // against what has already been downloaded
    const candidates = dedupeByLogObject(stubs).filter(
      (s) =>
        !have.has(s.id) &&
        !haveLogs.has(s.logObjectUrl) &&
        matchesSpecFilter(s, specIds, SPEC_ROLE),
    );
    for (const stub of candidates) {
      if (fresh >= LIMIT) break;
      const fileName = `${stub.id}.txt`;
      // Count **attempts** rather than successes: an incomplete download has
      // already consumed their egress bandwidth, and should not be exempted
      // from the interval just because we threw the result away.
      if (shouldSleepBeforeDownload(downloadsAttempted))
        await sleep(DOWNLOAD_SLEEP_MS);
      // The grant is charged against the daily quota *here*; request it
      // right before the download so the 10-minute URL is never left to age.
      const objectId = logObjectIdFromUrl(stub.logObjectUrl);
      let grant: LogDownloadGrant;
      try {
        grant = await requestLogGrant({ matchId: objectId, cookie });
      } catch (e) {
        if (e instanceof LogQuotaExceededError) {
          quotaHit = e;
          await saveQuotaState({
            utcDay: utcDayKey(),
            downloadsUsedToday: e.usedToday,
            downloadsQuota: e.quota,
          });
          break pages;
        }
        throw e;
      }
      lastGrant = grant;
      await saveQuotaState({
        utcDay: utcDayKey(),
        downloadsUsedToday: grant.downloadsUsedToday,
        downloadsQuota: grant.downloadsQuota,
      });
      downloadsAttempted++;
      const { text, meta, rawCheck } = await downloadWithMeta(
        grant.url,
        objectId,
      );
      const completeness = rawCheck.ok
        ? checkDecompressedPayload(text)
        : rawCheck;
      if (!completeness.ok) {
        // Do not write the file, do not enter the manifest, do not enter the
        // dedupe sets: the feed only keeps ~7 days, so leave it to be retried
        // on the next run; recording it early means it is skipped forever, and
        // once the stub expires it can never be recovered.
        console.warn(
          `  skip ${stub.id}: incomplete download (${completeness.reason})`,
        );
        continue;
      }
      await fs.writeFile(path.join(OUT_DIR, fileName), text);
      upsertManifestEntry(manifest, {
        ...stubToManifestEntry(stub, fileName),
        gcsMeta: meta,
      });
      // Write the manifest once per match: an interruption then loses no
      // metadata for matches already downloaded
      await fs.writeJson(MANIFEST, manifest, { spaces: 2 });
      have.add(stub.id);
      haveLogs.add(stub.logObjectUrl);
      fresh++;
      console.log(
        `  [${fresh}/${LIMIT}] ${stub.id} ${stub.bracket} teamRating=${stub.playerTeamRating} recorderSpec=${stub.units.find((u) => u.id === stub.playerId)?.spec ?? "?"} ${Math.round(text.length / 1024)}KB  quota ${grant.downloadsUsedToday}/${grant.downloadsQuota}`,
      );
      if (grantsRemaining(grant) === 0) {
        console.log(
          `  daily quota reached (${grant.downloadsUsedToday}/${grant.downloadsQuota}); resets ${nextUtcMidnight().toISOString()}`,
        );
        break pages;
      }
    }
    if (stubs.length < 50) break; // A short page = end of the feed
  }

  console.log(
    `done: ${fresh} new logs (scanned ${scanned} stubs over ${pagesFetched} pages), manifest ${manifest.length} entries`,
  );
  if (quotaHit) {
    console.log(
      `stopped: upstream daily log quota spent (${quotaHit.usedToday}/${quotaHit.quota}) — "${quotaHit.message}"; resets ${nextUtcMidnight().toISOString()}`,
    );
  } else if (lastGrant) {
    console.log(
      `quota: ${lastGrant.downloadsUsedToday}/${lastGrant.downloadsQuota} distinct logs used today (${grantsRemaining(lastGrant)} left; resets ${nextUtcMidnight().toISOString()})`,
    );
  }
  if (fresh < LIMIT && !quotaReached()) {
    console.log(
      `note: feed 只覆盖最近约 7 天(且最近 1 小时内的场次不可见);没凑满 LIMIT 说明该过滤条件下近期就这么多,过几天再跑会有新场次(断点续传自动跳过已下载)。`,
    );
  }
}

main().catch((e) => {
  console.error("fetchPvpLogs failed:", e);
  process.exit(1);
});
