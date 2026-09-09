# Data & Licensing Compliance

**English** · [Chinese](DATA-COMPLIANCE.zh-CN.md)

This page records what gladlog takes from outside sources, under what terms, and
which practices we have explicitly ruled out. It exists so the question does not
have to be researched from scratch every time — and because this repo has already
been wrong about it once (an earlier note called the wowarenalogs feed "our own
product"; it is not).

Findings below were verified on **2026-08-01** unless stated otherwise. Anything
load-bearing is dated, because terms change and code does not notice.

## 1. The upstream data source

`wowarenalogs.com` is a **third-party volunteer project** (legal entity: Alotof
Technology LLC, Kirkland WA; contact `privacy@wowarenalogs.com`; maintainer
channel: their [Discord](https://discord.gg/NFTPK9tmJK)). We are not affiliated
with it. Its Firestore reads and Cloud Storage egress are billed to them, not us.

What governs use of the site, in full:

| Document                                                | What it says                                                                                                                                    | Effect on us                                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [privacy.html](https://wowarenalogs.com/privacy.html)   | "Your contributions to the Service are intended for public consumption and are therefore viewable by the public, **including your game logs**." | Uploaders consented to their logs being public. This is our strongest footing. |
| `robots.txt`                                            | `User-agent: * / Disallow:` — fully permissive, no `Crawl-delay`                                                                                | Automated access does not violate robots.                                      |
| [LICENSE](https://github.com/wowarenalogs/wowarenalogs) | `CC BY-NC-ND 4.0`, worded as covering "WoW Arena Logs and **all other code** in this repository"                                                | Covers **code only**, not the uploaded log data.                               |

**There is no Terms of Service.** `tos.html` returns 404 and the repository
contains no terms file — only `packages/web/public/privacy.html`. So there is no
contractual prohibition on automated access, and equally no express permission.
Our restraint is a choice, not a compliance obligation.

## 2. Interfaces we use, and the one we refuse

**Used — the public GraphQL feed.** `POST https://wowarenalogs.com/api/graphql`,
anonymous, `latestMatches(...)` with server-side `bracket` / `minRating` /
`compQueryString` filters, page size capped at 50. Then a plain GET of the
returned `logObjectUrl`. This is the interface their own web client uses.

**Refused — bucket enumeration.** The GCS bucket `wowarenalogs-log-files-prod`
grants `storage.objects.list` to `allUsers`, so
`GET https://storage.googleapis.com/wowarenalogs-log-files-prod?max-keys=1`
returns a full object listing to anyone, unbounded by the feed's ~7-day retention
window. Their web client never needs to list the bucket, so this is almost
certainly a misconfiguration rather than an offered interface.

**We do not use it.** Publicly reachable is not the same as intended to be
public, and taking data outside the surface a project actually publishes is not
something we want to rely on. Decision of 2026-08-01: do not use it, and do not
report it either. Recorded here so the option is not rediscovered and quietly
taken later.

## 3. Collection discipline (`packages/corpus-tools`)

- **Identifying User-Agent** on every outbound request — feed and GCS alike,
  attached at the single choke point `fetchWithRetry` in
  `src/feedClient.ts`. Without it we are indistinguishable from any other
  scraper in their logs, and the only remedy available to them is a blanket
  IP ban that also hits other people.
- **Separate throttles per cost centre.** Paging costs them Firestore reads;
  a log download costs GCS egress and a single Solo Shuffle log can reach ~30 MB.
  Page interval 500 ms, download interval 2 s (`DOWNLOAD_SLEEP_MS`), serial,
  never concurrent. The download counter counts _attempts_, not successes — a
  discarded incomplete download still consumed their bandwidth.
- **Bounded paging**, with a different bound per script because they do
  different jobs: `scripts/fetchPvpLogs.ts` (targeted spec/rating sampling)
  defaults `MAX_PAGES` to **40**, while `scripts/archivePvpLogs.ts` (sequential
  full sweep of the whole feed) defaults it to **2000** — it has to reach the
  far end of a ~39,000-stub window before it stops. Both stop early on a short
  page or an empty page. `queryLimitReached` from the server is currently
  handled only by the archiver (`scripts/archivePvpLogs.ts:342`): it warns and
  stops paging that bracket after finishing the current page.
  `scripts/fetchPvpLogs.ts:134` still discards the flag entirely
  (`const { stubs } = await fetchDetailedStubs(...)`) — not wired up on
  purpose, since it's a maintainer-run one-off tool and its `MAX_PAGES=40`
  bound already caps how deep a run can go. The archiver additionally stops
  on 200 consecutive already-known matches.
- **Resume so a re-run never re-downloads what we already have** —
  by `manifest.json` for `fetchPvpLogs`, by the per-day ledger for the archiver.
  Both dedupe on `id` **and** `logObjectUrl`, since a Solo Shuffle's 6 rounds
  share one GCS object under 6 different match ids.
- **Retry only on 429/5xx/network**, exponential backoff capped at 15 s.

The feed only retains about 7 days (GCS objects about 30), so accumulating a
corpus means polling over time rather than one burst.

**As of 2026-08-01 this is built as a standing scheduled job**, so the
paragraph that used to say "revisit this section if it ever becomes one" is now
cashed in. (Built, not enabled — see the last bullet below.)
`scripts/archivePvpLogs.ts` sweeps the whole feed and archives every new public
match; `packages/corpus-tools/ops/app.gladlog.pvp-archive.plist` runs it under
launchd **4 times a day, every 6 hours** (01:00 / 07:00 / 13:00 / 19:00 local).
What that means in numbers, and why we consider it acceptable:

- **Throttling is unchanged from the numbers above** — 500 ms between pages,
  2 s between downloads, strictly serial, one process at a time (a `pid`-based
  run lock, since a first full sweep takes ~22 h and would otherwise overlap
  the next scheduled start). Running more often but shorter is deliberate: the
  same total load on them, in smaller pieces, with less lost to a sleeping
  laptop.
- **What we take:** about 5,570 matches/day, ~2.4 GB/day of GCS egress, which
  accumulates to roughly **860 GB/year** stored (gzip, as served).
- **What it costs them:** roughly **$100–200/year** at published GCS egress
  rates, billed to a volunteer project. The user is aware of this figure and
  accepts it. If we ever want to reduce it, the lever is **coverage**, not
  frequency and not compression: we already store exactly the bytes they serve,
  and polling less often does not save a single byte as long as the same
  objects are eventually downloaded — it only saves bytes when it makes us
  *miss* matches. (This bullet said "frequency" until 2026-09-09; it was wrong.)
- **It was never put on the schedule.** Committing the plist does nothing and
  nobody ever loaded it — the ruling of 2026-08-23 was to run the archiver by
  hand instead. So every number in the three bullets above is a *projection* of
  a cadence that never ran. What actually happened is measured below.
  Enable/disable instructions and operational notes:
  [pvp-log-archive.md](pvp-log-archive.md).

If the cadence rises above every 6 hours, or the archiver stops being the only
scheduled consumer, revisit this section and §1.

### What we actually took, and what it cost them — measured 2026-09-08

**On 2026-09-08 the upstream discontinued match search, and we have stopped
collecting.** `latestMatches` now answers every query — with or without a
bracket — with **HTTP 200 plus a GraphQL error** carrying
`extensions.code = SEARCH_DISABLED`:

> Automated scraping of search results has driven our hosting costs up sharply,
> so match search is discontinued until we can find a way to prevent it. Your
> own uploaded matches and any match shared with you by link are still
> available.

The user's ruling the same day was to stop: no retries, no alternate entry
point, no schedule. Note the shape of the failure for whoever debugs this next
— a GraphQL error does not travel in the HTTP status code, so `fetchWithRetry`
neither retries nor warns, and the archiver surfaces it only as the generic
`feed-detailed: empty latestMatches response`. Read the raw response body
before concluding anything.

The archiver ran by hand from **2026-08-13 to 2026-09-05** — 24 consecutive day
shards, no gaps. Measured off the archive itself, not projected:

| What                    | Amount                                                        |
| ----------------------- | ------------------------------------------------------------- |
| Matches downloaded      | 63,309                                                        |
| Bytes taken off their bucket | 41.96 GiB — raw gzip, exactly the bytes they serve        |
| Feed pages requested    | roughly 1,200–1,500, at 50 stubs per page                     |

What that costs them at published GCP list prices (North America → internet):

| Line item                            | Quantity        | Rate            | Estimate    |
| ------------------------------------ | --------------- | --------------- | ----------- |
| GCS egress                           | 41.96 GiB       | ~$0.12/GiB      | **~$5.0**   |
| GCS class B operations (object GET)  | 63,309          | $0.004/10k      | $0.03       |
| Firestore document reads (feed)      | ~2M–46M         | $0.06/100k      | **$1.5–27** |
| API compute and egress               | ~1.4k requests  | —               | <$0.5       |

**Somewhere between $7 and $35.** The Firestore row is the whole width of that
range, and it is wide for a reason given below — an earlier version of this
section quoted "$7–10" by leaving the first full sweep out of the read count.
Two things this table does not say on its own:

- **Our paging is the pathological kind, and the cost is in depth, not
  frequency.** Every round restarts at `page = 0` (`archivePvpLogs.ts:374`)
  with `offset: page * 50, count: 50` — no cursor, no resume — and Firestore
  bills for documents an `offset()` **skips**. Walking P pages costs
  `50 × P(P+1)/2` reads instead of `50 × P`, so the amplification factor is
  `(P+1)/2` and grows with how deep a round has to go:

  | Round shape                                    | Pages | Reads      | Amplification |
  | ---------------------------------------------- | ----: | ---------: | ------------: |
  | Idle (nothing new; only the 200-known tail)     |     4 |        500 |          2.5x |
  | Catch-up after a few days                       |    84 |    178,500 |         42.5x |
  | First full sweep (~39,000-stub window)          |   780 | 15,200,000 |        390.5x |

  So **rare deep rounds are far worse than frequent shallow ones** — eight
  14-page rounds cost 42,000 reads against 178,500 for one 84-page round, a
  factor of 4.25 for the same data. This inverts the usual "polling less often
  is more polite" instinct, and only for the read bill: it changes egress not
  at all.

  The upper end of the Firestore row is the first full sweep across three
  brackets (~45.7M reads). **We cannot pin what it actually was**: the run log
  prints the stop reason but never the page count, and the first round's log is
  gone. Treat 46M as a bound, not a measurement — and if this collector is ever
  revived, **log the page count per bracket per round**, which is the cheap fix
  that would have made this section a fact instead of a range. It would also be
  lower if their resolver does not pass the offset straight through to
  Firestore. Anyone reviving it should switch to cursor paging first — but note
  that cursors remove only this quadratic term: they do not reduce the number
  of requests, and they do not save a byte of egress.
- **A small dollar figure can still be a large share.** wowarenalogs users read
  parsed matches in a browser; almost nobody pulls the raw gzip objects. Over
  three and a half weeks, from one client, 41.96 GiB was plausibly a leading
  share of that bucket's raw-object egress. "We only cost them about ten
  dollars" and "we were a main driver of that cost line" are both true.

Their notice names *search results*, i.e. the query path rather than the
download path — which is precisely where our offset paging was worst.

## 4. Personal data in the logs

Combat logs contain character names, realms, and `Player-realmID-hexID` GUIDs.
A GUID is stable across a player's characters, which makes this pseudonymous
personal data under GDPR, not anonymous data. The uploader consented to
publication (§1); the other players in the match did not, beyond what the game
itself broadcasts to participants.

Current policy (decision of 2026-08-01): **store as-is, no pseudonymisation.**
Rationale: the parser needs GUIDs to relate units, and the data is already
public. This is a deliberate choice, not an oversight.

What we deliberately do **not** collect: the GCS object metadata header
`x-goog-meta-ownerid`, which carries the uploader's account id. Both collectors
go through the same `buildGcsMeta` and take only `wow-version`,
`client-timezone`, `client-year`, and `starttime-utc` — the fields needed to
reconstruct absolute time, since log timestamps carry no year and are in the
uploader's local timezone. `fetchPvpLogs` stores them in `manifest.json`, the
archiver in its ledger and in the per-day `index.jsonl` on Drive; the GCS
objects themselves disappear after ~30 days, so a field not captured at
download time is gone for good.

Downloaded logs and `manifest.json` live outside the repo by default
(`$GLADLOG_EVAL_HOME`) and must never be committed to the public repository.

## 5. Code licensing — the part that actually mattered

gladlog is MIT. wowarenalogs' code is **CC BY-NC-ND 4.0**, which forbids
commercial use _and_ derivative works. These are incompatible: MIT
redistribution cannot be layered on top of an ND licence, and attribution alone
does not cure it.

`packages/parser-compat/src/enums.ts` was, until 2026-08-01, transcribed line for
line from their `packages/parser/src/types.ts` — including their code style and
their misspelling of Blizzard's "Brewmaster" as `Monk_BrewMaster`.

**Fix:** `CombatUnitSpec` and `CombatUnitClass` are now generated from Blizzard's
own DB2 tables (`ChrSpecialization`, `ChrClasses`) by
`packages/analysis/scripts/datagen/genCombatUnitEnums.ts`, with a naming rule
this repo defines and documents. The remaining enums are each anchored to a
Blizzard fact: `LogEvent` values are the literal event tokens in the log format,
`CombatUnitPowerType` mirrors the client API's `Enum.PowerType`, and the flag
masks are the published `COMBATLOG_OBJECT_*` constants.

An honest note on what this did and did not change. Line-for-line overlap with
their file did **not** drop — normalised for quote style it went 108 → 115 lines,
because 51 `LogEvent` lines and 39 `SpecName = "blizzardId"` lines are the same
facts any correct implementation must express. The argument is independent
derivation and merger, not textual difference. What did change is the part that
was **not** factual:

- `CombatUnitClass`: 13/13 values replaced. Their numbering was invented
  (`Hunter = 2`), and we carried a `BLIZZARD_CLASS_TO_LEGACY` translation table
  just to speak it. Now the values _are_ Blizzard's `ChrClasses.ID`
  (`Hunter = 3`) and the translation table is deleted.
- Member ordering: 41/41 positions matched theirs, now 1/41.
- Provenance: values regenerate from DB2 on each game build, so there is no
  manual transcription path from their repository any more.

`packages/parser-compat/data/legacy-enum-manifest.json` is kept and is _not_ a
problem: it was dumped from the old package at runtime (the M4 plan explicitly
forbade reading their source) and records observed interop facts. Copying
interface facts for interoperability is the favoured case, not the disfavoured
one. The differential oracle does not compare `class` (its `NormUnit` takes
`spec`/`reaction`/`type`), so the renumbering does not touch that gate.

## 6. Blizzard's assets, and their CDN

Combat logs are client-generated text that players opt into and upload
themselves; Warcraft Logs has operated this way for over a decade. The exposure
sits in **art assets**, not log data.

Until 2026-08-01 the shipping app hot-linked `images.wowarenalogs.com` at runtime
for spec icons and arena minimaps — spending a volunteer project's bandwidth on
every install, for Blizzard art they re-host.

- **Spec icons: fixed.** `specIconName()` now resolves Blizzard's
  `ChrSpecialization.SpellIconFileID` to an icon base name
  (`genSpecIcons.ts`, 40/40 resolved) and rendering goes through the existing
  main-process `iconCache` — the same path spell icons already used, with a
  permanent disk cache and a per-session fetch budget.
- **Arena minimaps: removed entirely.** They were briefly bundled into the app
  before we actually looked at what was inside them. The files are not map art:
  each is a 95–98% transparent PNG whose only opaque content is a handful of
  boxes, and those boxes are **the same obstacles this repo already draws as
  vectors** — connected-component analysis puts them one-for-one at the same
  positions (zone 1505: 4↔4, 1911: 3↔3, 2547: 4↔4, within a few pixels). The
  overlay was drawing a duplicate of `arenaObstacles` on top of `arenaObstacles`.

  So neither hot-linking nor bundling bought anything visual, while each carried
  a cost: the first spends a volunteer project's bandwidth, the second puts 15
  binaries of unclear provenance into an MIT repository. Both are gone. The
  replay's floor rendering is entirely our own data — outline from
  `arenaFloors.json` (mined from position samples), obstacles from
  `@gladlog/analysis`'s `arenaObstacles`, which shares the LoS predicate and
  covers 16 zones, one more than the PNG set did.

The app now makes **no runtime requests to `images.wowarenalogs.com` at all**.
The visual-regression harness asserts this: `qa/support/stubExternal.ts` no longer
allows any external host, so a new CDN dependency fails the test by name instead
of leaving a flaky baseline. Icon fetching happens in the main process, which
Playwright's `page.route` cannot intercept, so `iconCache` takes an `offline`
flag set from `GLADLOG_E2E=1`.

## Open items

- **Scheduled polling** (BACKLOG #19) — **closed by the upstream on
  2026-09-08**, which discontinued match search for everyone. Collection has
  stopped; what we took and what it cost them is measured in §3. The schedule
  was never loaded, so there is nothing to disable. The 2026-08-01 decision not
  to contact the maintainers still stands and has not been revisited; if that
  changes, §3 now carries the concrete figures (63,309 matches, 41.96 GiB) to
  open with.
- **Spell and spec icons** are still fetched from Wowhead's CDN
  (`wow.zamimg.com`) at runtime, cached to disk. That art is Blizzard's and is
  not licensed to us; it rests on Blizzard's general tolerance of fan tools.
  This is the remaining art-asset exposure, and it is the same one every
  combat-log tool carries.
