# @gladlog/desktop

**English** · [Chinese](README.zh-CN.md)

The gladlog desktop application: an Electron app that watches World of Warcraft arena combat logs in real time, stores completed matches, renders the report/replay UI, and (optionally) drives an AI coach and OBS-based recording. This is the largest package in the repo — roughly 33,000 lines / 192 files under `src/`.

This document assumes you can already write TypeScript and are new to this codebase. Every claim below is grounded in a specific file; when in doubt, open the cited file.

## Process structure

Standard Electron three-process split, built by `electron.vite.config.ts`:

- **Main** — `src/main/index.ts` (245 lines). Boots `app`, registers the `vod://` privileged scheme before `app.ready`, constructs every service (`SettingsStore`, `MatchStore`, `WorkerHost`, `RecorderService`, `CompareService`, `AnalysisService`, `LearningService`, `RecordingsStore`, icon cache), wires them together via `registerIpc()`, and creates the `BrowserWindow` with `contextIsolation: true, nodeIntegration: false`.
- **Preload** — `src/preload/index.ts` + `src/preload/api.ts`. Builds a `GladlogApi` object out of `ipcRenderer.invoke`/`ipcRenderer.on` wrappers, namespaced as `logs`, `matches`, `settings`, `app`, `compare`, `analysis`, `learning`, `recorder`, `icon`, `ai`, `debug`, and exposes it via `contextBridge.exposeInMainWorld("gladlog", api)`. This is the only surface the renderer can touch. Note: `matches.get` decodes the raw bytes returned by main through `parseDocBytes` (`src/shared/parseDocBytes.ts`) — parsing happens in preload/renderer, not main (see "Data storage" below for why).
- **Renderer** — `src/renderer/src/main.tsx`. Mounts `<App/>`, or — if the URL hash is `#export-report=<id>` — `<ExportReportPage/>` (used by the offscreen PNG-export window, see `src/main/exportImage.ts`). If `VITE_FIXTURE_MODE` is set it installs a `fixtureBridge` instead of talking to real IPC, for the browser-only dev test bed (`npm run dev:ui`, see "Local dev loop" below).

`electron.vite.config.ts` defines three build targets — `main`, `preload`, `renderer` — and **all three** set:

```ts
const json = { stringify: true } as const;
```

The reason, quoted from the file's own comment: `spellNames.json` has 410k+ keys; Vite 5's default compiles JSON into a JS **object literal** that V8 must parse as source, which measurably blocked first paint by ~22s; the same data via `JSON.parse` takes ~42ms. Vite's default for `json.stringify` is `false`, so all three targets must opt in explicitly — both main and renderer reach this data through `@gladlog/analysis`. The actual measured before/after, from commit `ac5a2d1` ("大 JSON 走 JSON.parse —— 冷启动 25s→2s,首渲 24s→0.8s"):

| Metric             | Before  | After  |
| ------------------ | ------- | ------ |
| Cold start         | 24832ms | 1427ms |
| Report first paint | 23687ms | 853ms  |
| Visual test suite  | 3.0m    | 22s    |
| E2E test suite     | 1.3m    | 14.5s  |

A follow-up commit (`67ddc95`) found and fixed one file that had slipped past this rule: `spellEffectGenerated.ts` was a 295KB `.ts` object literal (not `.json`, so `json.stringify` didn't touch it) — moved to a same-name `.json` sidecar. Current locked performance budgets (measured, not aspirational) live in `qa/budgets.ts`: `parse: 4900ms, firstPaint: 3300ms, coldStart: 2600ms` — each derived as `max(3 CI samples) × 1.5`, consumed by `packages/parser/test/parseBudget.test.ts`, `qa/visual/firstPaint.spec.ts`, and `qa/e2e/import.spec.ts`.

The `main` build target isn't just `src/main/index.ts` — its `rollupOptions.input` has three entries, all sharing the `main` target's config (hence all get `json.stringify`):

```ts
input: {
  index: resolve(__dirname, "src/main/index.ts"),
  worker: resolve(__dirname, "src/worker/index.ts"),
  slimWorker: resolve(__dirname, "src/main/slimWorker.ts"),
}
```

These correspond to two independent background-process mechanisms, invoked differently at runtime:

- **`src/worker/`** (the real-time log-watcher pipeline: `watcher.ts`, `tailReader.ts`, `pipeline.ts`, `runtime.ts`) is spawned by `src/main/workerHost.ts` as a genuine Electron **utility process** — `utilityProcess.fork(workerModulePath, [], { stdio: "pipe" })` — and communicates over `process.parentPort`. `WorkerHost` also restarts it on crash, consulting `crashPolicy.ts`'s `nextCrashRecord()` to decide when to quarantine a repeatedly-crashing log file (`LIMIT = 3` crashes).
- **`src/main/slimWorker.ts`** is a one-shot self-heal job spawned from `matchStore.ts` via Node's `worker_threads.Worker` (not `utilityProcess`). It reads a legacy "fat" `match.json`, calls the shared `slimStoredDoc()` predicate, and atomically rewrites the file, then terminates. This exists because pre-2026-07-26 fat docs used to get parsed and re-materialized up to 3× (worker/main/renderer) — up to ~5GB peak RSS on a 426MB match — before the "doc byte pass-through" redesign (see "Data storage" below).

## `src/main/` service inventory

29 non-test files. One or two sentences each, with real exported names so this is checkable against the source:

| File                      | ~Lines | Responsibility                                                                                                                                                                                                                                             |
| ------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                | 245    | App bootstrap — wires every service, owns `BrowserWindow` creation, `startMonitoring()`.                                                                                                                                                                   |
| `ipc.ts`                  | 195    | `registerIpc(deps)` — every `ipcMain.handle("gladlog:...")` channel, delegating to injected services.                                                                                                                                                      |
| `matchStore.ts`           | 625    | `class MatchStore` — one-directory-per-match disk store, `_index.ndjson` fast index, byte-capped LRU (`LRU_MAX_BYTES`), `store()/get()/page()/rebuildIndex()/rawLine()`.                                                                                   |
| `analysis.ts`             | 1207   | `createAnalysisService(deps)` — the AI coaching pipeline: build prompt, run backend, audit/parse model JSON, multi-model slot cache (`upsertSlot`/`resolveActiveSlot`), plus `deepen()` (auto follow-up) and `analyzeWindow()` (selection-based analysis). |
| `localAiBackends.ts`      | 549    | CLI-backend client factories: `claudeCliClientFactory`, `codexClientFactory`, `agyClientFactory`; spawn-based `Runner`; Windows `.cmd`/`.bat` argv-injection hardening.                                                                                    |
| `learning.ts`             | 461    | `createLearningService(deps)` — cross-match learning: ledger → `scanPatterns` (deterministic) → AI distillation → `rules.json`. `CONSOLIDATE_EVERY_MATCHES = 10`.                                                                                          |
| `deepseekClient.ts`       | 247    | `deepseekClientFactory(key)` — DeepSeek's OpenAI-compatible SSE API, hand-rolled SSE line parser, dual overall/stall timeout watchdogs.                                                                                                                    |
| `recorder.ts`             | 334    | `createRecorderService(deps)` — OBS remote-control recording start/stop, orphan-recording reconciliation, `SAFETY_STOP_MS = 40min`.                                                                                                                        |
| `settingsStore.ts`        | 313    | `class SettingsStore` — settings persistence with `safeStorage`-encrypted secrets (API keys, OBS password).                                                                                                                                                |
| `cliDetect.ts`            | 225    | `detectLocalCli`/`detectCliForBackend` — locates `claude`/`agy`/`codex`/`node` binaries via PATH + known install dirs.                                                                                                                                     |
| `recordingsStore.ts`      | 224    | `class RecordingsStore` — ndjson index of OBS recordings, overlap-based match linking (`associate()`), orphan pruning.                                                                                                                                     |
| `compare.ts`              | 280    | `createCompareService(deps)` — pro-comparison feature: cohort lookup, `verifiedComparison`, AI narration guarded by `claimChecker`.                                                                                                                        |
| `obsAutoConfig.ts`        | 105    | `detectObsWebsocket()` — reads OBS's own on-disk `config.json` to auto-fill URL/password.                                                                                                                                                                  |
| `exportImage.ts`          | 104    | `exportReportImage(opts)` — offscreen `BrowserWindow` loads the renderer at `#export-report=...`, `capturePage()` → PNG.                                                                                                                                   |
| `learningLedger.ts`       | 92     | `createLearningLedger(dir)` — append-only NDJSON ledger, last-run-wins merge by `matchId`.                                                                                                                                                                 |
| `corpusLoader.ts`         | 92     | `loadBundledCorpus(...)` — loads/validates the bundled `reference_vectors.json` pro-comparison corpus (userData override, then bundled fallback).                                                                                                          |
| `quitLifecycle.ts`        | 93     | `createQuitLifecycleHandler(deps)` — `before-quit` handshake: stop recorder (4s cap), stop worker host, stop AI activity, then real quit. Electron-free, testable.                                                                                         |
| `workerHost.ts`           | 88     | `class WorkerHost` — spawns/supervises the log-watcher utility process, restart-on-crash.                                                                                                                                                                  |
| `iconCache.ts`            | 78     | `createIconCache(deps)` — fetches spell icons from `wow.zamimg.com`, disk-caches as base64, session fetch budget, `offline` mode for deterministic visual tests.                                                                                           |
| `ai.ts`                   | 123    | `resolveAiClient(settings, factory?)` — picks the LLM client per configured backend; `stopAllAiActivity()`.                                                                                                                                                |
| `importLogs.ts`           | 90     | `importLogFiles(paths, store, emit)` — one-shot historical log import, streamed through `GladLogParser`.                                                                                                                                                   |
| `workerMessageHandler.ts` | 67     | `createWorkerMessageHandler(deps)` — pure router for `WorkerToMain` messages (`match`/`shuffle`/`segmentOpen`/`segmentClose`/`status`/`diagnostic`).                                                                                                       |
| `obsClient.ts`            | 38     | `realObsClient()` — thin wrapper around `obs-websocket-js`, with an `ObsClientLike` interface for test fakes.                                                                                                                                              |
| `vodProtocol.ts`          | 58     | `registerVodScheme()`/`handleVodProtocol()` — custom `vod://` privileged protocol serving recording files with HTTP range support.                                                                                                                         |
| `detectWowDir.ts`         | 30     | `detectWowDirCandidates()`/`resolveLogsDir()` — Windows WoW install-path probing.                                                                                                                                                                          |
| `crashPolicy.ts`          | 28     | `nextCrashRecord()` — pure function deciding when to quarantine a repeatedly-crashing log file.                                                                                                                                                            |
| `aiDebugLog.ts`           | 24     | `recordAiDebug`/`listAiDebug` — in-memory ring buffer of recent AI prompts/responses for the dev panel.                                                                                                                                                    |
| `e2eEnv.ts`               | 19     | `e2eUserDataDir(env)` — redirects `userData` to a throwaway path under `GLADLOG_E2E=1`.                                                                                                                                                                    |
| `slimWorker.ts`           | 33     | `worker_threads` entry point for the self-heal slim job (see above).                                                                                                                                                                                       |

## `src/renderer/src/report/` layering

Roughly 16,800 lines across `derive/` and `components/` (~100 files including tests). The split:

- **`derive/`** — pure functions that take a `ReportSource`/doc-like object and return plain view data. No JSX, no React import, e.g. `derive/summary.ts` (`deriveSummary(m, range) → UnitTotals[]`), `derive/mistakes.ts`. The one exception is `derive/inlineRich.tsx`, which is `.tsx` because `makeRichText()` returns `ReactNode` (it wraps matched spell/spec names in `<SpellInline>`/`<SpecInline>` from `components/`).
- **`components/`** — the view layer. `components/MatchReport.tsx` is the main consumer, importing ~17 `derive*` functions and rendering them.

When `derive/` or `components/` code needs a live predicate from `@gladlog/analysis` (not just precomputed doc data), it goes through **`derive/legacySource.ts`**, which exports `toLegacySafe(source)` — a small LRU-cached (`CACHE_MAX = 2`) wrapper around `toLegacyMatch` from `@gladlog/parser-compat`. It pads unit-event arrays that trimmed test fixtures omit (`healIn`/`absorbsIn`/`actionsIn`/... default to `[]`) before calling `toLegacyMatch`, so analysis functions — which expect the full legacy `ICombatUnit` shape — don't throw on a fixture that intentionally strips some arrays to control file size. **Note:** `toLegacySafe` is a desktop-local safety wrapper, not something `@gladlog/parser-compat` itself exports — the package only exports the raw `toLegacyMatch`.

**`derive/analysisInput.ts`** is the main integration point: it imports `buildDeepDivePack`, `buildMatchContext`, `buildWindowPack`, `extractCandidateFindings`, `hasCoachableSignal`, `isHealerSpec`, and others directly from `@gladlog/analysis`, calls `toLegacySafe(source)`, then `extractCandidateFindings(legacy, owner.id)` and `buildMatchContext(legacy, friends, enemies, {...})` to assemble the `AnalysisInput` payload later sent over IPC to `main/analysis.ts`. Roughly 20 other `derive/*.ts` files import from `@gladlog/analysis` directly for their own view-specific predicates (e.g. `derive/mistakes.ts` calls `analyzeKickAudit`, `annotateMissedPurgesWithKillWindows`, `computeOffensiveWindows`; `derive/dampeningSeries.ts` calls `buildDampeningEvents`).

**Note on `parser-compat`:** `packages/desktop/package.json` does not list `@gladlog/parser-compat` as a dependency, even though 15+ `derive/*.ts` files import it directly. It resolves at build/runtime only because npm workspaces symlinks every workspace package into the root `node_modules` regardless of declared dependencies — an implicit coupling worth knowing about if this package is ever built/packaged outside this monorepo's workspace root.

## Data storage

**`MatchStore`** (`src/main/matchStore.ts`) is one directory per match, `join(rootDir, safeName(matchId))`, containing three files written together in `store()`:

- `meta.json` — `StoredMatchMeta`: `id, kind, bracket, zoneId, startTime, endTime, result, storedAt`, plus optional "rich row" fields (`durationS, avgRating, teams, playerName, playerRating, slimmed, roundLinesTotal`) added for list-view rendering without opening the full doc.
- `match.json` — `{ schemaVersion: 1, storedAt, kind, data }`, the full parsed `GladMatch`/`GladShuffle`.
- `raw.txt` — the original combat-log lines, newline-joined.

A root-level `_index.ndjson` (append-only, one `meta.json` line per stored match) is the fast in-memory index, reconciled against actual directory contents on `init()`.

`MatchStore.get(id)` returns the **raw `Buffer`** of `match.json`, not a parsed object — parsing happens client-side via `parseDocBytes` (`src/shared/parseDocBytes.ts`). This "doc byte pass-through" design (comment at `matchStore.ts` around the `get()` method) avoids materializing the full parsed object graph three times (worker → main → renderer), which pre-redesign could peak at multi-GB RSS on a large (426MB) match file. `slimmed?: boolean` on `StoredMatchMeta` flags whether a doc has already been through the size-reduction predicate; unset means an old "fat" doc that gets self-healed in the background by the `slimWorker.ts` thread described above.

**Multi-model analysis cache.** Two files, deliberately split by Node dependency:

- `src/shared/analysisSlots.ts` — zero `fs`/`path` imports, safe for both main and renderer. Defines `AnalysisSlot<T> { promptVersion, createdAt, result }` and the on-disk envelope:
  ```ts
  interface AnalysisCacheDocV2<T> {
    schemaVersion: 2;
    language: string;
    slots: Record<string, AnalysisSlot<T>>;
    lastSlotKey: string;
  }
  ```
  Slots are keyed by `slotKeyOf(backend, model) = "${backend}:${model}"`, split back out by `splitSlotKey()` (splits on the _first_ colon only, since a model id may itself contain one). `resolveActiveSlot(doc)` — reading `doc.slots[doc.lastSlotKey]` — is the single read-side predicate; `upsertSlot()` merges a new slot into existing ones without clobbering other models' cached results.
- `src/shared/analysisCache.ts` — has `import { join } from "path"`, so it's main-process-only (a comment documents a real production incident: `renderer`'s `slotLabel.ts` once imported `splitSlotKey` from this file, and because Rollup pulled the whole module — including the `path` import — into the browser bundle, the packaged app broke with `"join" is not exported by "__vite-browser-external"`; neither local vitest nor `tsc` caught it, only `electron-vite build` did). Exports `analysisCachePath(matchesDir, matchId, lang) = join(matchesDir, matchId, "analysis-v2.${lang}.json")` — cache files are split per match **and** per language.

`src/shared/promptVersion.ts` exports a single `PROMPT_VERSION = 13` constant, the sole invalidation key for cached analysis: any prompt-shape change bumps it, which makes `getCached` treat all existing slots as stale. The file's own comment keeps a changelog from v3 through v13 tracking which finding categories/prompt sections each bump added.

## Testing & QA

- **Unit tests (vitest).** `vitest.config.ts` excludes `qa/**` ("qa/ 是 Playwright 的地盘") and scopes coverage to `src/**`. Run via `npm test --workspace=packages/desktop` (`"test": "vitest run --passWithNoTests"`).
- **`qa/` — Playwright.** `qa/playwright.config.ts` defines two projects:
  - `visual` — screenshot regression, `toHaveScreenshot: { threshold: 0.05, maxDiffPixels: 100 }` (both values calibrated by deliberately breaking a color and confirming CI goes red — see the long comment in the config). `snapshotPathTemplate` has **no `{platform}` segment** — Linux CI is the single baseline source, by design.
  - `e2e` — drives the packaged Electron app (no dev server).
  - `workers: 1` throughout — the `firstPaint`/`coldStart` performance budgets need an uncontended machine.
  - `qa/axe-allowlist.ts` — WCAG 2.1 A+AA accessibility baseline via `@axe-core/playwright`, currently one blanket exemption (`color-contrast`, rationale: dark game-style UI dimming).
  - `qa/budgets.ts` — see the JSON.parse section above.

  **Local-run warning, quoted verbatim from `qa/playwright.config.ts`'s top comment:** "基线是 linux 单源,由 CI 生成与判定 ... 本机只跑 `npm run test:visual:smoke` —— 它带 `--ignore-snapshots`,不比对也不写基线;直跑 `test:visual` 会在基线缺失时写入 mac 截图,污染单源。" In other words: **never run `npm run test:visual` locally** — there is no script-level guard preventing it, only this comment, and doing so on a non-Linux machine will write local-platform screenshots into the shared baseline. Use `npm run test:visual:smoke` (same suite, `--ignore-snapshots`, no comparison) to sanity-check locally instead.

## Push-before checklist

Per the repo's root `CLAUDE.md`:

```
npm test --workspace=packages/desktop && npm run typecheck && npx eslint packages/desktop/src --quiet
```

`npm run typecheck` here runs `tsc --noEmit -p tsconfig.json`, and `tsconfig.json`'s `include` covers `src`, `test`, `dev`, and `qa` — so both the local and CI typecheck already see test files identically. The gap CI's separate `npm run lint` (root `eslint .`, whole repo) closes that the local checklist above does **not**: `npx eslint packages/desktop/src --quiet` is scoped only to `src/`, so lint problems in `packages/desktop/test/`, `qa/`, `dev/`, and `scripts/` go uncaught locally until CI's whole-repo lint step runs. `.github/workflows/test.yml` runs, in order: root `lint` → root `typecheck` → root `test` → `npm -w @gladlog/desktop run verify:vision` → `npm -w @gladlog/desktop run build` (a production `electron-vite build`, which is the only step that catches renderer code accidentally importing a main-only module — see the `analysisCache.ts` incident above); a parallel `frontend-qa` job runs `test:visual` → build → the `e2e` Playwright project under `xvfb-run`.

## Local dev loop

- `npm run dev` — full Electron app via `electron-vite dev`.
- `npm run dev:ui` — a browser-only Vite test bed (`dev/main.tsx`, `dev/scenes.ts`, `dev/fixtures/`) for iterating on the report/replay UI without Electron or a real WoW client; pairs with `VITE_FIXTURE_MODE=1`, which the renderer's `main.tsx` checks to install a `fixtureBridge` instead of real IPC.
- `npm run verify:vision` / `npm run learning:scan` — standalone scripts (`scripts/verifyVision.ts`, `scripts/learningScan.ts`); other scripts under `scripts/` include `backfillMatches.ts`, `repro-badjson.ts`, `slimLibrary.ts`, `smokeAiPipelines.ts`, `smokeStressFixtures.ts`, and `verify-production.ts`.
