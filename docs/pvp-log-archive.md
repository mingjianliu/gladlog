# PvP Log Long-Term Archive

**English** · [Chinese](pvp-log-archive.zh-CN.md)

`scripts/archivePvpLogs.ts` (in `packages/corpus-tools`) scans the
wowarenalogs.com public feed every 6 hours and archives every newly-seen
public match **in the archived brackets** to Google Drive as **raw gzip
bytes**, sorted into per-day directories. It is collection-only: no
parsing, no derived data, nothing that changes the source bytes. Compliance basis (data source, terms,
collection discipline): [DATA-COMPLIANCE.md](DATA-COMPLIANCE.md). Design
rationale and the measured numbers behind every parameter:
`docs/superpowers/specs/2026-08-01-pvp-log-archive-design.md`.

## Which brackets get archived

`ARCHIVED_BRACKETS` (`src/pvpLogFetch.ts`) — **3v3 and Rated Solo Shuffle.
2v2 is not archived**, by user ruling on 2026-09-04: it was roughly a third
of every round's downloads and Drive bytes, and the corpus work it fed had
already ruled it out (the review bench found no value impact by mode for
2v2; the rotation study dropped it on 2026-08-29).

It is a **separate constant from `KNOWN_BRACKETS`, and the two must not be
merged**. `KNOWN_BRACKETS` states a fact about the server — the three values
its feed accepts — so that a typo raises instead of silently querying an
empty result set; `ARCHIVED_BRACKETS` states our collection policy.
Narrowing `KNOWN_BRACKETS` instead would make an explicit, human-initiated
`BRACKET=2v2 npm run logs:fetch-public` throw, which is a separate on-demand
pull nobody asked to remove. The subset relation is enforced by the
`readonly Bracket[]` annotation on the constant (a bracket the server does
not recognize will not compile) plus a runtime test in
`src/pvpLogFetch.test.ts`.

Each run prints the bracket set it covers, derived from the two constants —
so that the "did every bracket stop on the consecutive-known threshold"
audit below knows how many stop-page lines to expect, and a deliberately
skipped bracket never reads as a truncated one:

```
本轮 bracket:3v3 / Rated Solo Shuffle(按采集策略不归档:2v2)
```

Already-archived 2v2 days stay on Drive untouched — this changes what is
collected from here on, not what was collected before.

## Credentials

**This is a record of what is already set up, not a to-do.** Since
2026-08-23 the `gdrive:` remote runs on **its own Google Drive
client_id** — no longer rclone's built-in shared one, which Google is
retiring during 2026.

|                   |                                                                       |
| ----------------- | --------------------------------------------------------------------- |
| GCP project       | `gladlog-archive`                                                     |
| OAuth client      | `gladlog-archive-desktop`, application type **Desktop app**           |
| Publishing status | **In production**                                                     |
| Scopes            | `.../auth/docs`, `.../auth/drive`, `.../auth/drive.metadata.readonly` |

The verification criterion is one line of output: every rclone call used
to print `NOTICE: gdrive: This remote uses rclone's shared Google Drive
client_id...`, and now prints it **zero** times. `rclone config show
gdrive:` should list a `client_id` field.

### Redoing this (new machine, revoked token)

Follow https://rclone.org/drive/#making-your-own-client-id to create the
OAuth client, then:

```bash
rclone config update gdrive client_id <ID> client_secret <SECRET> --non-interactive
printf 'y\ny\nn\n' | rclone config reconnect gdrive:
```

Two things that cost time the first time round:

- **Publishing status must be "In production".** Leaving the app in
  "Testing" also works — but every grant then expires after a week. For
  an unattended archiver that is not a caveat, it is a guaranteed silent
  failure seven days later.
- **`rclone config reconnect` asks three questions, not two**:
  `refresh?` → `auto config?` → **`Shared Drive (Team Drive)?`**. The
  third is asked _after_ `Got code`, so answering only the first two
  kills the process with `Failed to read line: EOF` **after
  authorization already succeeded** — the token is never written to
  disk, and the symptom looks exactly like a failed authorization. That
  is what the `n` in the `printf` above is for.

Why the credential path is worth this much care: when it breaks, uploads
fail silently from the archiver's point of view — `rclone copy` returns
non-zero, the run keeps the local staging directory and retries next
time, so staging only grows and never drains. The 20 GB free-disk guard
(below) eventually stops the process, but that is a halt, not an alert —
nobody gets told why.

## Usage

```bash
cd packages/corpus-tools
npx tsx scripts/archivePvpLogs.ts
```

Requires `rclone` on `PATH` with a `gdrive` remote already configured
(or point `RCLONE_REMOTE` at a different configured remote name). The script
checks both **before** it touches the feed and exits with instructions if
either is missing — otherwise it would download tens of thousands of matches
from a volunteer project's storage and be unable to upload a single byte.

`DRY_RUN=1` still scans the feed, downloads, and writes to local staging —
that part is the point of the rehearsal — but it skips **flushing entirely**:
nothing is uploaded, nothing is recorded in the ledger as uploaded, and
nothing local is deleted. It is not "`rclone --dry-run`": `rclone copy
--dry-run` transfers nothing yet exits 0, so treating it as a successful
upload would write `uploaded: true` for matches that are not on Drive, and
the next real run would delete the local bytes and never re-download them.
Because staging is not drained, a `DRY_RUN` run leaves its downloads on disk
for the next real run to upload — remove `ARCHIVE_ROOT/staging` by hand if
you don't want that.

Note what the preflight above does **not** check: it only confirms `rclone`
is on `PATH` and that a remote named `gdrive` (or `RCLONE_REMOTE`) exists in
`rclone listremotes` — it never exercises auth, so an expired or revoked
token still passes it silently. `DRY_RUN=1` no longer touches rclone at all
(see above), so it can't stand in for an auth rehearsal either. So verify
authorization directly — but note that `rclone lsd gdrive:` is **not
sufficient on its own**: listing only proves the read-only directory path
works, while a flush depends on `rclone cat` (reading the day's cloud
`index.jsonl`) and `rclone copy` (the upload itself). Exercise both:

```bash
# read path — what flushDay does first
rclone cat gdrive:gladlog-pvp-archive/2026/08/23/index.jsonl | wc -l
# write path — upload a probe, read it back, then remove it
mkdir -p /tmp/authcheck && date > /tmp/authcheck/probe.txt
rclone copy /tmp/authcheck gdrive:gladlog-pvp-archive/_authcheck
rclone cat gdrive:gladlog-pvp-archive/_authcheck/probe.txt
rclone purge gdrive:gladlog-pvp-archive/_authcheck
```

If either errors, fix auth before enabling the schedule.

## Environment variables

| Variable            | Default                                   | Meaning                                                                            |
| ------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------- |
| `ARCHIVE_ROOT`      | `$HOME/code/gladlog-eval-private/archive` | Root for local staging and the ledger                                              |
| `RCLONE_REMOTE`     | `gdrive`                                  | rclone remote name                                                                 |
| `DOWNLOAD_SLEEP_MS` | `2000`                                    | Delay between downloads — **never set to 0** (the upstream is a volunteer project) |
| `MAX_PAGES`         | `2000`                                    | Max pages paged per bracket per run                                                |
| `DRY_RUN`           | unset                                     | `1` = skip flushing entirely (see below)                                           |

`DOWNLOAD_SLEEP_MS` and `MAX_PAGES` are parsed with a hard floor
(`parseThrottleEnv` in `src/archivePlan.ts`), and the two kinds of
"invalid" are treated differently. **Unset or an empty string** is
treated as "not configured" and silently falls back to the default —
no warning, since that's the ordinary case of the variable simply not
being set. **A non-numeric value, or a value below the floor**, is
different: it also falls back to the default, but the script prints a
`console.warn` naming the offending value, because that usually means
the variable was set to something wrong rather than left unset. The
floor for `DOWNLOAD_SLEEP_MS` is 250 ms (`MIN_DOWNLOAD_SLEEP_MS`); for
`MAX_PAGES` it is 1. The reason either case must not silently become
`0`: `Number("")` is `0`, `Number("2s")` is `NaN`, and
`setTimeout(r, NaN)` behaves like `0ms` — both would silently cancel
the politeness throttle against the upstream feed if left uncaught.

## Why store compressed bytes

Google Cloud Storage already stores each log gzip-compressed
(`content-encoding: gzip`). Downloading and storing the raw compressed
bytes — instead of decompressing before writing to disk — measured
**11.4x** smaller on the same objects. That turns a 5 TB Google Drive from
roughly **27 weeks** of runway (decompressed) into roughly **6 years**
(compressed). This is the single highest-leverage decision in the design;
see the "Empirical Base" table in the design spec for the underlying
measurements (feed depth, per-match size, growth rate).

## Installing as a scheduled job (launchd)

The plist lives at `packages/corpus-tools/ops/app.gladlog.pvp-archive.plist`
and is **not loaded automatically** — committing it to the repo does
nothing on its own. **When** to enable it is a decision for whoever runs
it, not something this doc prescribes. **As of 2026-08-23 it is
deliberately still not installed**: the archiver is being run by hand
instead, while the season's corpus builds up. That is a standing decision,
not an oversight — don't "fix" it by installing the plist.

Running it by hand is safe to repeat: the script takes a lock and exits
immediately if another run is already in progress.

To install:

```bash
sed 's|<Repository Path>|/absolute/path/to/gladlog|' \
  packages/corpus-tools/ops/app.gladlog.pvp-archive.plist \
  > ~/Library/LaunchAgents/app.gladlog.pvp-archive.plist
launchctl load ~/Library/LaunchAgents/app.gladlog.pvp-archive.plist
```

To stop it:

```bash
launchctl unload ~/Library/LaunchAgents/app.gladlog.pvp-archive.plist
```

Runs 4 times a day (01:00 / 07:00 / 13:00 / 19:00 local time), logging to
`/tmp/gladlog-pvp-archive.log` / `.err`. launchd (rather than cron) is used
deliberately: cron simply skips a run missed because the laptop's lid was
closed, while launchd's `StartCalendarInterval` catches up on wake.

## Operational notes

1. **Zero new matches in a run is an incident, not a quiet success.** A
   normal run archives on the order of a thousand-plus matches. Zero means
   the feed is down or its query shape changed (e.g. an upstream schema
   change) — the script logs an explicit warning line when this happens,
   but nothing pages anyone. The feed only retains ~7 days, so a silent
   failure that lasts a week is a **permanent** week of lost data.
2. **Enablement timing is a human decision; the plist does not act on its
   own.** See "Installing as a scheduled job" above for the current plan
   and the install/uninstall commands.

## What's been verified so far

Real-machine verified (see `.superpowers/sdd/2026-08-01-pvp-log-archive/task-6-report.md`
for the full numbers): single-page scan against the live feed, downloading
and staging compressed bytes, uploading to Drive, the ledger only being
written **after** an upload is confirmed successful, and ledger-based
dedup across two consecutive runs (first run: 114 matches confirmed
uploaded, local staging emptied afterward, `rclone ls` showed 115 files on
Drive = 114 `.txt.gz` + 1 `index.jsonl`).

**Verified in production since (2026-08-23 run: 1345 matches archived in
~80 minutes, 1345 download attempts → 1345 archived, exit 0, no skips or
upload failures)**:

- **Batched flushing.** Local staging was observed rising to ~200 files
  and draining back down repeatedly across the run, rather than
  accumulating to the end.
- **The 200-consecutive-known page-stop threshold.** All three brackets
  stopped this way — 2v2 at 237 consecutive known, 3v3 at 204, Rated Solo
  Shuffle at 207. (That run predates the 2026-09-04 ruling above; runs from
  then on sweep two brackets, so expect two such lines, not three.) This is
  also the line to read first in any run log:
  stopping on the known-threshold means the run caught up, whereas
  stopping on `queryLimitReached` means deep pagination was truncated and
  the round may have a collection gap.
- **`classifyIndexFetch`'s "ok" path.** `rclone cat` against a real cloud
  index (`2026/08/23/index.jsonl`, 1653 lines) succeeded and parsed.

**Still without real-machine evidence**: the 20 GB free-disk guard,
flushing leftover staging from a prior run, and — separately — the
missing-index branch of `classifyIndexFetch` described next.

**One open risk to check first on the next smoke test**: `classifyIndexFetch`
(`src/archiveUpload.ts`) decides whether `rclone cat` failed because the
day's cloud index simply doesn't exist yet (normal, proceed with an empty
index) versus a real read failure (must abort the flush and keep local
staging) using a regex matched against `rclone`'s stderr text. The success
path is now confirmed on a real machine (above); **the regex itself is
not** — it has never been checked against the stderr rclone actually emits
for a missing object. Two commands settle it:

```bash
rclone cat gdrive:gladlog-pvp-archive/2026/08/23/nosuchfile.jsonl   # missing object, existing dir
rclone cat gdrive:gladlog-pvp-archive/1999/01/01/index.jsonl        # missing directory
```

The two misclassifications are **asymmetric**: treating a real read failure
as "doesn't exist" makes the run write this batch over the cloud's complete
index for that day — irreversible. Treating a genuinely-missing index as a
read failure is the recoverable direction: staging is kept and the next
round retries. So the regex is deliberately narrow —
`object|directory|file not found`, matching rclone's own
`ErrorObjectNotFound` / `ErrorDirNotFound` wording — and everything else
classifies as an error, including DNS failures whose text contains "no such
host" and rclone config errors like "didn't find section".

Note the residual risk that narrowness buys, because it is not merely "one
forfeited flush": if rclone's real "doesn't exist" wording is _not_ one of
those three, then **every day's first flush** is misread as a read failure,
staging never drains, and the archiver uploads nothing at all — a silent
stall, the same shape as the credential failure described under
"Credentials". Confirming the actual `rclone cat` stderr for a missing
object is therefore the first thing to check on the next real-machine
smoke test.

The next smoke test should also use `MAX_PAGES=3` or higher, and should
**count duplicates by `logObjectUrl`, not by match `id`**. Solo Shuffle
plays 6 rounds that share a single GCS log object under 6 different match
ids, so id-based duplicate counting is blind to that entire class of
duplication.
