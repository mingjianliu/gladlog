# @gladlog/corpus-tools

**English** · [中文](README.zh-CN.md)

**Offline maintainer tools** — not shipped in the desktop app package. Uses gladlog's own parser + analysis metrics to recompute all cohort baselines from the wowarenalogs.com public feed, producing a version-stamped, embedding-free static `data/reference_vectors.json` consumed by SP-B2's compare engine.

> Design basis: `docs/specs/2026-07-11-pro-comparison-cohort-design.md`
> Zero external dependencies at the release layer — the desktop app only consumes this static corpus from the bundle/CDN at runtime.

## Pipeline

```
feed (wowarenalogs.com GraphQL, MIN_RATING=2300, per bracket)
  → downloadLogText (per-match log text)
  → GladLogParser (gladlog's own parser, via parser-compat)
  → computeHealerMetrics + extractRotations/crisisEvents (gladlog analysis)
  → aggregate by cell (spec × bracket × enemyCompArchetype + tiered fallback)
  → validateCorpus (hard gate)
  → write data/reference_vectors.json (version-stamped, embedding-free)
```

Cell = `spec × bracket × archetype`; a cell with fewer than N_floor (30) samples falls back to its `spec × bracket` (archetype `"*"`) parent cell; a parent cell still under 30 is flagged `insufficient: true`. SP-B2 shows "insufficient sample, no comparison yet" for insufficient combinations — it never emits fake percentiles.

## Building the corpus

```bash
cd packages/corpus-tools
WOW_PATCH=<current retail build> MIN_RATING=2300 PER_BRACKET=<samples per bracket> \
  NODE_OPTIONS=--max-old-space-size=4096 \
  npx tsx scripts/buildCorpus.ts
```

**Environment variables**

| Variable      | Default   | Description                                                                                                                                                                                                               |
| ------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WOW_PATCH`   | `unknown` | Current retail build version stamp. Taken from the `build` field of `packages/analysis/src/data/datagen-manifest.json` (the version the game-data pipeline already pulled). Lets SP-B2 judge whether the corpus is stale. |
| `MIN_RATING`  | `2300`    | Server-side rating floor for the feed (cohort = high brackets).                                                                                                                                                           |
| `PER_BRACKET` | `1200`    | Matches sampled per bracket. See "Quota and N_floor" below.                                                                                                                                                               |
| `ARCHIVE_LEDGER` | _(unset)_ | Directory of archive ledger `*.jsonl`. Set together with `ARCHIVE_ROOT` to build from our own archive instead of the feed — see "The feed is gone" below.                                                             |
| `ARCHIVE_ROOT`   | _(unset)_ | Directory holding `<matchId>.txt.gz`, nested by date. Only used when `ARCHIVE_LEDGER` is also set.                                                                                                                    |

`NODE_OPTIONS=--max-old-space-size=4096`: a single Solo Shuffle log can reach ~30MB (6 rounds, full match); each match is parsed then discarded, but the heap ceiling must be raised to avoid OOM.

**Output**: stub counts per bracket, total cell count, size; `validateCorpus` with 0 violations; `data/reference_vectors.json` written. On validation failure (uncleared 1.5 sentinel / non-ASCII spell names / inconsistent N_floor flags / missing version stamp) it exits 1 **before writing the file** — no half-built artifact.

## The feed is gone — rebuild from the archive (2026-09-11)

The upstream discontinued match search on 2026-09-08: `latestMatches` answers every
query with a GraphQL `SEARCH_DISABLED` error inside an HTTP 200, and the ruling that day
was to stop asking (`docs/DATA-COMPLIANCE.md`). The feed path above therefore cannot
rebuild anything any more, and it fails **silently** — zero stubs, no error.

Our own archive is what remains. Point the builder at it:

```bash
ARCHIVE_LEDGER=$GLADLOG_EVAL_HOME/archive/ledger \
ARCHIVE_ROOT=$GLADLOG_EVAL_HOME/corpus/archive-gz \
WOW_PATCH=<build> MIN_RATING=2300 PER_BRACKET=1200 OUT=/tmp/rv.json \
  npx tsx scripts/buildCorpus.ts
```

The ledger carries `bracket` and `playerTeamRating` per match, i.e. exactly the filter the
feed used to apply server-side, so the cohort definition is unchanged in shape.

**What the archive cannot do**: reproduce the production corpus at its own floor. Measured
2026-09-11 over 63,309 archived matches — at `MIN_RATING=2300` it holds **518** Solo
Shuffle / **50** 3v3 / **550** 2v2, and 50 3v3 matches put every 3v3 cell under
`N_floor`. Lowering `MIN_RATING` to 2100 gives 1,624 / 620 / 2,378 — a usable corpus, but
it redefines who "the reference cohort" is, which is a user call, not a default. Build to
a scratch `OUT`, compare cell counts against the live file, and decide before replacing
production data.

## Quota and N_floor (production vs smoke)

The archetype dimension is only worth having when every archetype-cell can reach `N_floor=30`. Rule of thumb: `PER_BRACKET ≥ 30 × number of mainstream archetypes` (roughly 100–150+/bracket minimum; 1200 recommended for production).

- **Smoke / pipeline verification**: `PER_BRACKET=50` is enough to run end to end and produce a **real but sparse** corpus (most cells flagged `insufficient` because N<30 — that is correct behavior, not a defect). Use it to prove the pipeline holds on real feed data.
- **Production rebuild**: `PER_BRACKET=1200` (default). The download is large (SS ~30MB/match × 1200 × 3 brackets = tens of GB, hours) — an independent long-running maintainer task; run it on a separate machine, not to completion inside an interactive session.

## Downloading other players' logs by spec/rating (fetch-pvp-logs)

```bash
SPEC=Shaman_Restoration MIN_RATING=2100 LIMIT=20 npx tsx scripts/fetchPvpLogs.ts
```

Bulk-downloads raw logs from the same feed by bracket/rating tier (server-side) + spec (compQueryString server-side pre-filter + recorder/any client-side refinement) into `$GLADLOG_EVAL_HOME/downloads/`, with a manifest (rating/MMR/everyone's spec/GCS timezone meta) and resumable downloads. Parameters, rating-tier semantics, the 7-day retention window and other pitfalls: see `.claude/skills/fetch-pvp-logs`.

## Smoke gate (go/no-go)

Before a production run, smoke-test feed availability:

```bash
npx tsx scripts/smokeFeed.ts
```

Confirms all three brackets return logs at minRating and that logs download and parse. On failure, switch to the fallback source (user-collected log corpus) or stop and report — don't discover a feed outage halfway through a build.

## Tests

```bash
npx vitest run   # cellAggregator / validateCorpus / feedClient / perMatchRecord
```

`combatToRecords` is tested with synthetic combats (pure function), no real-log fixtures (privacy/size); `buildPerMatchRecords` is a parse wrapper.

## Build-aware grouping (SP-B1.5)

For healer specs whose **talent build materially changes the compared metrics**, cells are further split into buildGroups by a deterministic keystone-talent boolean gate (e.g. Discipline Priest's `offensive`/`standard`), so "your play vs the cohort" compares within the same build family; specs whose build does not affect the metrics (Mistweaver, Preservation Evoker) stay archetype-only and don't fragment the sample.

**Gate table**: `data/keystoneGates.json` (version-stamped, human-reviewed). Schema: `{ wowPatchVersion, gates: [{ spec, keystoneNodeIds, match: "any"|"all", metric, groupPresent, groupAbsent }] }`. Currently active: Discipline Priest → Voidweaver package `[82585,110277,82583]` (any) → `offensive`/`standard`.

**Discovery workflow (maintainer, rerun after patches)**:

```
STUDY_LOGS=600 STUDY_OUT=<rows.json> npx tsx scripts/collectBuildStudy.ts   # collect per-round {spec,archetype,talents,metrics}
STUDY_ROWS=<rows.json> npx tsx scripts/discoverKeystones.ts                  # rank candidate keystones by metric separation
# Human review of candidates → hand-edit data/keystoneGates.json (the tool never writes it automatically)
```

**Cell splitting + N_floor guard**: gated specs emit four cell kinds — `archetype×buildGroup`, `*×buildGroup`, `archetype×*`, `*×*` — with fallback preferring to keep the build while retaining the archetype baseline (`archetype×buildGroup` → `*×buildGroup` → `archetype×*` → `*×*`). Gates activate **per bracket**: if a buildGroup's build parent (`*×buildGroup`) cell is under N_floor=30, that (spec,bracket) falls back to archetype-only (records get `buildGroup="*"`). The corpus's top-level `buildGroups` declares activated gates (a spec is listed once it splits in any bracket) for the runtime (SP-B2) to classify against; the presence of `archetype×*` guarantees unsplit brackets still have an archetype baseline to fall back to.

**offensiveIndex winsorization**: clipped at the pool's p99 before aggregation (damage/healing explodes in rounds where healing ≈ 0). Only protects qualifying cells; for tiny insufficient cells (e.g. n=4) p99≈max and clipping is ineffective, but those cells are never consumed.

**Runtime (SP-B2, not implemented in this package)**: reads `corpus.buildGroups` for an O(1) boolean classification of the user's build; **fail-open** — if the gate table's version mismatches the game build, or keystone nodes have become invalid, it silently falls back to `buildGroup="*"`.

## Compliance

- **Data source**: the wowarenalogs.com feed is the public API of a **third-party volunteer project** (this repo only forked its code; the data is not ours — corrected 2026-07-29, previously misrecorded as "our own product"); the data is voluntarily and publicly uploaded by players. Build-time only, maintainer-side, offline calls, restrained frequency.
- Extraction of old-fork logic is done only by the controller against the subproject's 0-audit (all CLEAN files); subagents/agy do not read the old fork.

## Long-term PvP log archiving (archivePvpLogs)

Scans the feed every 6 hours and archives newly appeared public matches as raw gzip bytes to Google Drive.
Usage, environment variables, and operational notes: [PvP log archive](../../docs/pvp-log-archive.md); design in
`docs/superpowers/specs/2026-08-01-pvp-log-archive-design.md`, compliance in
[`docs/DATA-COMPLIANCE.md`](../../docs/DATA-COMPLIANCE.md).
