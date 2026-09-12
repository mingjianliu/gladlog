# gladlog developer guide

**English** · [Chinese](developer-guide.zh-CN.md)

For people who need to read or modify this codebase. Read alongside: `CLAUDE.md` at the repo root (the hard rules), `docs/verifiability-roadmap.md` (the verification system as a whole), and `docs/plans/` (the history and current state of design decisions).

## Development dependencies

- **Node 20+ / npm**: a single `npm install` covers every workspace (that's all the product build needs).
- **rclone (optional)**: used only by `corpus-tools` for archiving the PvP corpus to Google Drive (`syncPvpLogsToDrive.ts`); it never ships in the product. Install with `brew install rclone` on macOS or `winget install Rclone.Rclone` on Windows, then run `rclone config` once to create a Google Drive remote named `gdrive` (details in `.claude/skills/fetch-pvp-logs`). If it isn't installed or configured, the script prints the same instructions rather than hard-failing.

## Architecture overview

```
WoWCombatLog*.txt
   │  (worker process tails it with a checkpoint; or importLogs does a one-shot full pass)
   ▼
@gladlog/parser        L1 line decoding → L2 match segmentation → L3 collection into a GladMatch/GladShuffle doc
   │
   ▼
desktop main           MatchStore (one directory per match: meta.json + match.json + raw.txt,
   │                   NDJSON index) · AI service (findings generation/caching/marking/aggregation) · IPC
   ▼
desktop renderer       report/derive/* (pure functions over the doc) → the three view UIs
   │                   when an analysis predicate is needed: toLegacySafe(doc) → @gladlog/analysis
   ▼
@gladlog/analysis      the combat analysis core: CC / dispel / positioning / death / window analysis
                       plus prompt construction (data catalogs = curated whitelists + datagen output)
@gladlog/parser-compat conversion layer from the new doc to the old ICombatUnit shape (analysis's input)
@gladlog/eval          the prompt/response quality evaluation toolchain (corpus building, coverage gates, score validation)
```

The packages: `parser` (pure parsing, no dependencies), `parser-compat` (shape conversion), `analysis` (analysis + prompts + game data), `desktop` (the Electron app), `eval` (evaluation scripts), `corpus-tools`, and `log-pipeline` (cross-machine log relay).

The diagram above is the short version. For the full picture — every main-process
service, where data lands on disk with measured sizes, the cross-cutting
constraints, and five "start reading here" paths — see
[architecture](architecture.md). Two packages also have their own READMEs:
[`packages/analysis`](../packages/analysis/README.md) and
[`packages/desktop`](../packages/desktop/README.md).

Before adding a predicate that both analysis and a gate will evaluate, check
[the predicate index](predicate-index.md) first — the repo's most expensive
recurring bug is the same fact computed two slightly different ways.

## Three iron rules (all three have been violated, and all three cost us)

1. **The gate predicate is the spec (shared-predicate rule)** — any two consumers of the same fact (analysis vs. verification gate, main vs. renderer, prompt vs. UI) must import the same constant or function, anchored to the rendered value (floored seconds). Eleven independent bugs in this codebase's history were all two copies of a predicate quietly diverging. The fix is always to make the consumers share the predicate, never to loosen the verification gate. See the root `CLAUDE.md`.
2. **Whitelists rot** — every curated set of spell IDs (CC, dispels, interrupts, burst cooldowns, icons) silently decays each patch. Before adding new tracking, get **corpus evidence** (mine SPELL_CAST_SUCCESS / SPELL_DISPEL and look at the per-spec **rate**, not the absolute count). Missing values (cooldowns, durations) come from corpus measurements (minimum inter-cast gap, median from buff applied → removed), never from guesswork. The data refresh procedure in `docs/commands/update-wow-data.md` includes a rot-regression check step.
3. **Deterministic verification first** — anything a deterministic gate can decide (coverage, invariants, differential oracle) does not go to an LLM judge, and any judge dimension a gate can anchor must cite measured numbers. Changes to the prompt builder go through `/eval-ab`; the exception is low-frequency events, where A/B lacks the power to decide — there, follow precedent, verify on the next baseline, and say so explicitly.

## Development loop

```bash
npm ci
npm run dev                         # real Electron (VITE_FIXTURE_MODE=1 npm run dev = preview without real data)
cd packages/desktop && npm run dev:ui   # browser-only report UI test bed, HMR, http://localhost:5199
npm run typecheck                   # whole repo (never tsc -b — it emits .js into src)
npm test --workspaces
```

**Before pushing desktop changes** (CI and local are not equivalent — this has broken the build three times in a row):

```bash
npm test --workspace=packages/desktop && npm run typecheck && npx eslint packages/desktop/src --quiet
```

CI's `tsc -p` includes test files and there is a separate Lint step — local vitest covers neither. After pushing, watch it go green with `gh run watch <explicit run id> --exit-status`.

**Desktop code conventions** (the three data-flow paths, the seekReq nonce pattern, the synthetic-injection fixture testing approach, and more) are collected in `.claude/skills/desktop-dev/SKILL.md` — read it before touching `packages/desktop`.

**Parser changes** must pass the differential oracle in the private repo (`oracle/`, `npm run gate`, comparing old and new parser output across 164 pairs of real matches).

## Test map

- `packages/parser/test` — L1/L2/L3 unit tests over synthetic lines, plus fixtures.
- `packages/analysis/test` — 546+ cases: analysis predicates, prompt construction, gate consistency.
- `packages/desktop` (`test/` plus `*.test.tsx` beside the source) — derive pure functions, component rendering (jsdom), and a real anonymized fixture (`test/fixtures/real-match-sample.json`, trimmed to the first 90s with no player deaths — to test death-related paths, clone it and inject synthetic events).
- `packages/eval` — unit tests for the coverage gates and the scoring contract.

## The eval system (prompt/response quality)

Three workflows (`docs/commands/`), with output landing in the private repo at `$GLADLOG_EVAL_HOME`:

- **/eval-baseline** — evaluate the current state to find problems: build the corpus → deterministic quality gates (coverage / noise / leading words) → generate responses → three-pass scoring (anchored rubric + discriminant validity) → report and ledger.
- **/eval-ab** — controlled A/B validation of a prompt-builder change (same corpus, blind scoring, bootstrap CI). Note that the worktree must run `npm ci` — symlinks will silently fall back to the main checkout's code.
- **/calibrate-judge** — calibrate the judge before trusting its scores.

Known measurement facts: a single-round accuracy Δ of ≲0.6 is noise (measured by test-retest); batch responder/judge subagents use Opus 5 (`claude-opus-5`), the same model as the product coach default (`AI_DEFAULT_MODEL`). Before 2026-09-12 both were Sonnet: noise floors, judge calibrations and baselines recorded before that date were measured with a Sonnet responder/judge and are not directly comparable — re-run `/calibrate-judge` and a fresh baseline before comparing across the switch.

## Game data pipeline

`packages/analysis/scripts/datagen/`: pulls DB2 tables from wago.tools to generate spell names, effects, talents, icons, and so on, with the build recorded in `datagen-manifest.json`. Refresh for a new patch by following `docs/commands/update-wow-data.md` (which includes the manual adjudication gate for curated catalogs and the whitelist rot regression check).

## Releasing

GitHub Actions builds the Windows x64 and macOS installers natively on tag (no Wine). The electron-builder traps — pin electronVersion, don't add `files`, `extraResources`, macOS ad-hoc signing — are in `docs/BUILD-WINDOWS.md` and the commit history.

## Where to start reading the code

- How a match becomes a report: `packages/parser/src/api.ts` → `packages/desktop/src/main/matchStore.ts` → `packages/desktop/src/renderer/src/report/derive/` → `report/components/MatchReport.tsx`.
- How a match becomes an AI prompt: `packages/analysis/src/context/buildMatchContext.ts` (the `useTimelinePrompt` path) → `matchTimeline.ts`.
- How a finding gets verified: `packages/analysis/src/analysis/` (candidateFindings → buildFindingsPrompt → auditFindings).
