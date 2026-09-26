# gladlog architecture

**English** · [Chinese](architecture.zh-CN.md)

This document describes how gladlog is put together: what the seven packages are, which process each piece of code runs in, where the data lands on disk, and which constraints you will break if you don't know about them.

**Audience.** Someone who can write TypeScript but has never seen this repo, and the author three months from now. It assumes no World of Warcraft knowledge beyond "the game can write a combat log to a text file".

**Scope and honesty rules.** Every claim below points at a file, a symbol, or a number that was measured. Where a number came from this author's machine rather than from the code, it is labelled as such. Where something was not verified, it says so rather than guessing. If you find a statement here that the code contradicts, the code wins — fix the document.

Related reading: [developer guide](developer-guide.md) (workflows, test map, release), `CLAUDE.md` at the repo root (the non-negotiable rules), [verifiability roadmap](verifiability-roadmap.md) (why the verification machinery exists), [data compliance](DATA-COMPLIANCE.md) (where game data comes from and under what licence).

---

## 1. The whole pipeline in one picture

```
World of Warcraft
  └─ writes  <WoW>/Logs/WoWCombatLog*.txt        plain text, one event per line, append-only
       │
       │  (A) live path: desktop utility process tails the file from a byte checkpoint
       │  (B) bulk path: main/importLogs.ts streams whole files once, on user request
       ▼
@gladlog/parser                                   zero runtime dependencies
  L1  parseLine()            one text line  → ParsedLine (decoded, timestamped)
  L2  Segmenter              line stream    → Segment  (one arena match, or one shuffle round)
  L3  buildMatch/buildShuffle Segment       → GladMatch / GladShuffle    ← "the doc"
       │                                       slimMatchParams() runs here: born slim
       ▼
desktop main process
  MatchStore          one directory per match on disk: meta.json + match.json + raw.txt,
  │                   plus an append-only NDJSON index (_index.ndjson)
  ├─ RecorderService  OBS websocket start/stop, driven by segmentOpen/segmentClose
  ├─ AnalysisService  candidate findings → prompt → LLM → audit → per-model cache slots
  ├─ CompareService   your metrics vs a pre-built reference corpus of high-rated players
  ├─ LearningService  cross-match ledger → deterministic pattern scan → distilled rules
  └─ IPC              ~40 ipcMain.handle channels + push channels (src/main/ipc.ts)
       │
       │  matches:get returns RAW BYTES; nothing in main parses a doc
       ▼
preload (contextIsolation bridge)
  parseDocBytes()  JSON.parse + slim fallback — the doc is materialised exactly once,
                   in the same heap the renderer uses
       │
       ▼
desktop renderer (React)
  report/derive/*   38 pure modules: doc → view models (timeline, meters, replay, deaths…)
  │                 when an analysis predicate is needed:
  │                 toLegacySafe(doc) → @gladlog/parser-compat → @gladlog/analysis
  report/components/*  41 components: report / replay / events / video / AI tabs
       │
       ▼
you, looking at a match report
```

Two side channels hang off this spine:

- **`@gladlog/eval`** consumes the same prompt builder and re-checks its output against the raw log (deterministic gates), then scores model responses (LLM judge). It never runs inside the app.
- **`@gladlog/log-pipeline`** and **`@gladlog/corpus-tools`** are maintainer tooling: relaying logs between machines, and building the reference corpus that `CompareService` reads. Neither ships in the desktop bundle.

---

## 2. The seven packages and which way the arrows point

Each package keeps its sources under `src/` (with co-located `*.test.ts`) and a separate `test/` directory. Per-package and per-file size numbers were removed from this document on 2026-09-26 — they had rotted badly since the 2026-08-01 measurement and nobody re-ran it; run `wc -l` if you need a figure today.

| Package                  | Runtime deps declared                                     | One-line job                                               |
| ------------------------ | --------------------------------------------------------- | ---------------------------------------------------------- |
| `@gladlog/analysis`      | `@gladlog/parser-compat`                                  | combat analysis predicates, prompt construction, game data |
| `@gladlog/desktop`       | `@gladlog/parser` (see caveat)                            | the Electron app                                           |
| `@gladlog/eval`          | parser, parser-compat, analysis, corpus-tools, `fs-extra` | prompt/response quality gates and judging                  |
| `@gladlog/corpus-tools`  | analysis, parser-compat, `node-fetch`, `fs-extra`         | reference-corpus build, third-party log archiving          |
| `@gladlog/parser`        | **none**                                                  | combat log → typed match documents                         |
| `@gladlog/log-pipeline`  | **none**                                                  | cross-machine log relay via a shared folder                |
| `@gladlog/parser-compat` | `@gladlog/parser`                                         | new doc shape → legacy `ICombatUnit` shape                 |

Dependency direction:

```
parser  ←  parser-compat  ←  analysis  ←  corpus-tools  ←  eval
   ↑                            ↑             ↑             ↑
   └────── desktop ─────────────┘             └─────────────┘

log-pipeline: depends on nothing (Node stdlib only)
```

Read that as "arrows point at what a package is allowed to import". Three properties are load-bearing:

1. **`parser` has zero dependencies.** `packages/parser/package.json` has no `dependencies` key at all, and every module specifier under `packages/parser/src/` is relative. The only platform API it touches is `Intl.DateTimeFormat` (`src/l1/timestamp.ts`). This is what lets the parser be reused in a worker process, in a test harness, and in a benchmark script without dragging anything along.
2. **`analysis` consumes `parser-compat`, not `parser`.** Analysis code is written against the legacy `ICombatUnit` shape, not against `GladUnit`. `packages/analysis/src/index.ts` states the intent: the entry shape is legacy, and the type design leaves room to migrate utils to the native shape one at a time.
3. **The renderer calls `analysis` directly.** It does not ask main to compute analysis predicates. `report/derive/*.ts` calls `toLegacySafe(source)` (`src/renderer/src/report/derive/legacySource.ts`) and then calls analysis functions in-process. Most of the derive modules import `@gladlog/analysis`.

### Caveat: undeclared workspace dependencies

`packages/desktop/package.json` declares `@gladlog/parser` but **not** `@gladlog/analysis`, `@gladlog/parser-compat`, or `fs-extra` — all three of which desktop source imports (analysis in ~20 places, `parser-compat` in `derive/legacySource.ts` and `derive/analysisInput.ts`, `fs-extra`'s `ensureDirSync` in `main/iconCache.ts`). Likewise `corpus-tools` imports `@gladlog/parser` without declaring it. These resolve only because npm workspaces hoists every workspace package into the repo-root `node_modules/@gladlog/`.

Practical consequence: **a git worktree without its own `npm install` resolves these imports by walking up to the main checkout**, i.e. you typecheck a different branch's source than the one you are editing. Run `npm ci` (or at least `npm install`) in any new worktree before trusting `npm run typecheck`.

---

## 3. Process model

Electron gives four JavaScript contexts, and gladlog uses all of them plus `worker_threads`:

| Context              | Entry                                                                     | What runs there                                                              |
| -------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **main**             | `src/main/index.ts`                                                       | window lifecycle, all services, all disk writes, all LLM calls               |
| **utility process**  | `src/worker/index.ts`                                                     | tails the log directory and parses; one long-lived child, restarted on crash |
| **preload**          | `src/preload/index.ts` + `api.ts`                                         | the `window.gladlog` bridge; also where a match doc is JSON-parsed           |
| **renderer**         | `src/renderer/src/main.tsx`                                               | React UI, derive layer, direct calls into `@gladlog/analysis`                |
| **`worker_threads`** | `src/main/slimWorker.ts`, plus an inline eval'd worker in `matchStore.ts` | one-off heavy JSON parse / slim-and-rewrite, off the main thread             |

`src/main/index.ts` is the wiring diagram in code — almost all of it constructing services and handing them their dependencies. Reading it top to bottom tells you what exists.

### The log-tailing utility process

`WorkerHost` (`src/main/workerHost.ts`) forks `worker.js` via `utilityProcess.fork`, pipes stdout/stderr into `electron-log`, and restarts it one second after any unexpected exit. The reason it is a separate OS process rather than a thread: a parse crash on one malformed log line must not take the UI down, and it must be attributable.

That attribution is `crashPolicy.ts`: the worker reports `{fileKey, offset}` in its status messages; if the process dies three times at approximately the same spot (`OFFSET_TOLERANCE = 65536` bytes), that file is **quarantined** — added to `WorkerConfig.quarantined` and skipped from then on. Any successful `match`/`shuffle` message resets the counter.

Inside the worker (`src/worker/`):

- `watcher.ts` — `fs.watch` on the logs directory marks files dirty; a `flushIntervalMs` timer (2 s) drains them, plus one extra flush after a `quietPeriodMs` (5 s) lull so the tail of the last match arrives promptly. Flush failures re-add the files to the dirty set instead of killing the watcher.
- `tailReader.ts` — `readTail(filePath, state)` reads 8 MB chunks from the checkpoint offset, splits on `\n` (stripping a trailing `\r`), and **only advances the offset to the last complete line**. Rotation is detected by the file shrinking or by the sha1 of its first line changing.
- `pipeline.ts` — `FilePipeline` owns one `GladLogParser` per file. Its one non-obvious rule: the persisted checkpoint advances **only when `!parser.hasOpenSegment()`**. Never checkpoint in the middle of a match. On rotation it emits a synthetic aborted `segmentClose` (so the OBS recorder doesn't wait out its 40-minute safety valve) and rebuilds the parser.
- `checkpoints.ts` — the registry is `{ files: { [fileKey]: { offset, firstLineChecksum } } }`, written with tmp + rename to `<userData>/checkpoints.json`.

Messages back to main are the `WorkerToMain` union in `src/shared/protocol.ts`: `match`, `shuffle`, `diagnostic`, `segmentOpen`, `segmentClose`, `status`. Routing lives in `workerMessageHandler.ts` as a pure function so it can be unit-tested without Electron; `index.ts` only injects the Electron-specific ends of it.

---

## 4. Main-process services

`packages/desktop/src/main/` holds the service modules below (tests sit beside them). Everything here is constructed in `index.ts` inside `app.whenReady()` and reached from the renderer through `ipc.ts`.

| Module                             | What it owns                                                                                                                                    | On-disk state                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `matchStore.ts`                    | The match library: `store` / `list` / `page` / `get` / `rawLine` / `rebuildIndex`. `get()` returns **raw bytes**, never an object.              | `<userData>/matches/<id>/` + `_index.ndjson`                              |
| `analysis.ts`                      | AI review: `run`, `deepen`, `analyzeWindow`, `cancel`, `getState`, `getCached`, `getFlags`/`setFlag`, `aggregate`, `notebook`, `listAnalyzed`   | `analysis-v2.<lang>.json`, `windowAnalysis.<lang>.json`, flags, per match |
| `learning.ts`                      | Cross-match coaching loop: ledger → deterministic pattern scan → AI distillation → rules                                                        | `<userData>/learning/rules.json` (+ ledger, below)                        |
| `learningLedger.ts`                | Append-only NDJSON, one line per analysis run; read is last-run-wins per match; compacts past 1.2× redundancy                                   | `<userData>/learning/ledger.ndjson`                                       |
| `compare.ts`                       | Comparison against the reference corpus; `N_FLOOR = 30`; emits streaming deltas                                                                 | `compare.json` per match                                                  |
| `recorder.ts`                      | Drives OBS over websocket on `segmentOpen`/`segmentClose`; 40-minute safety stop; serialised through one promise chain                          | none directly (delegates to `recordingsStore`)                            |
| `recordingsStore.ts`               | Index of recorded videos and their match association (`TOLERANCE_MS = 60_000` overlap rule); prunes to `recordingKeepCount`                     | `<userData>/recordings/` NDJSON index + the video files                   |
| `settingsStore.ts`                 | Typed settings with defaults, patch sanitisation, legacy migration, and `safeStorage` encryption of secret fields                               | `<userData>/settings.json`                                                |
| `workerHost.ts`                    | Spawn/restart/reconfigure the log-tailing utility process                                                                                       | none                                                                      |
| `workerMessageHandler.ts`          | Pure router for `WorkerToMain` messages (store the match, tell the recorder, emit to the window)                                                | none                                                                      |
| `crashPolicy.ts`                   | Decide when a repeatedly-crashing log file gets quarantined                                                                                     | none (in memory)                                                          |
| `quitLifecycle.ts`                 | `before-quit` handler that suspends the quit, stops the recorder (4 s cap), stops the worker, kills in-flight AI, then really quits             | none                                                                      |
| `slimWorker.ts`                    | `worker_threads` entry: read → parse → `slimStoredDoc` → atomic rewrite → report round line offsets                                             | rewrites `match.json` in place                                            |
| `importLogs.ts`                    | One-shot streaming import of historical logs (4 MB chunks, manual `\n` split); dedup by match id makes re-import idempotent                     | writes through `MatchStore`                                               |
| `corpusLoader.ts`                  | Loads `reference_vectors.json` from a prioritised path list (userData override first, then bundled), with shape validation                      | reads only                                                                |
| `iconCache.ts`                     | Spell icons from `wow.zamimg.com`, cached as `<name>.jpg`, returned as data URLs; 512 fetches per session; `offline` mode for tests             | `<userData>/icons/`                                                       |
| `vodProtocol.ts`                   | Registers the privileged `vod://` scheme and serves recordings with HTTP range support                                                          | reads video files                                                         |
| `ipc.ts`                           | The whole main↔renderer contract: ~40 `ipcMain.handle` channels                                                                                 | none                                                                      |
| `ai.ts`                            | Backend selection (`resolveAiClient`), the coach system prompt, the Anthropic streaming client, `stopAllAiActivity()`                           | none                                                                      |
| `localAiBackends.ts`               | `claude` / `agy` / `codex` CLI backends: argv-only spawn (no shell), 300 s timeout, prompt spill files, version hints on failure                | temp spill dirs under `os.tmpdir()`                                       |
| `cliDetect.ts`                     | Finds the CLI binaries: PATH first, then well-known install locations; light `--version` probe with 5 s timeout                                 | none (memoised in process)                                                |
| `deepseekClient.ts`                | DeepSeek official API (OpenAI-compatible SSE); overall + stall watchdogs; scrubs API keys out of error text                                     | none                                                                      |
| `obsClient.ts`                     | Minimal OBS websocket surface so `recorder.ts` can be tested against a fake                                                                     | none                                                                      |
| `obsAutoConfig.ts`                 | Reads OBS 28+'s own websocket config JSON so the user doesn't have to copy the password by hand. **Read-only** — OBS rewrites that file on exit | none                                                                      |
| `aiDebugLog.ts`                    | In-memory ring of the last 10 AI calls (prompt + raw response) for the developer panel. Deliberately never written to disk                      | none                                                                      |
| `exportImage.ts`                   | Renders the report in an off-screen window and captures a full-page PNG                                                                         | writes the chosen PNG                                                     |
| `detectWowDir.ts`                  | Windows-only guesses at the WoW install path, plus `resolveLogsDir`                                                                             | none                                                                      |
| `e2eEnv.ts`                        | Under `GLADLOG_E2E=1`, redirects `userData` to a throwaway directory — and **throws** rather than silently using the real one                   | none                                                                      |
| `readNthLine` (in `matchStore.ts`) | Streams `raw.txt` looking for the _n_-th `\n` and stops early, instead of reading and splitting a 12–70 MB file to get one line                 | none                                                                      |

Three patterns recur and are worth internalising:

**Dependency injection at the Electron boundary.** Modules that would otherwise `import "electron"` take their Electron-specific pieces as constructor arguments: `SettingsStore` receives `safeStorage`, `RecorderService` receives a client factory, `quitLifecycle` receives three plain functions. That is why they have real unit tests — vitest cannot instantiate Electron's `app`/`BrowserWindow` cheaply.

**Services are factory functions returning an object, typed by inference.** `export type AnalysisService = ReturnType<typeof createAnalysisService>` and the same for compare / learning / recorder. `ipc.ts` depends on those inferred types, so adding a method to a service and forgetting to expose it is a compile error at the call site rather than a runtime `undefined`.

**Failures degrade, they don't propagate.** `recorder.ts` states it as an iron rule: any OBS failure sets `lastError` and stops there — parsing, storing and analysis must not be affected by the recorder. `corpusLoader` falls back through its path list. `iconCache` returns `null`. `parseDocBytes` returns `null` on a half-written file instead of throwing into the renderer.

### The AI backends

Five backends, enumerated once in `src/shared/aiModels.ts` (`AI_BACKENDS`, `AI_MODELS`, `AI_DEFAULT_MODEL`, `resolveAiModel`, `BACKEND_CLI_TOOL`), consumed by the settings store, the two AI services, and the settings panel. That file lives in `shared/` for a **build** reason, not tidiness: the renderer must never value-import from `main/*`, because Rollup then drags `fs`/`path` into the browser bundle. That failure only shows up in `electron-vite build` — local vitest and `tsc` both pass.

- `anthropic` — official API via `@anthropic-ai/sdk`, streaming.
- `claudeCli` / `agy` / `codex` — spawn a local CLI. Arguments are always passed as an array (never a shell string), so match data in a prompt can never be interpreted by a shell. On Windows, prompts over `WIN_ARGV_PROMPT_LIMIT = 30,000` characters spill to a file under `os.tmpdir()`; stale spill files older than an hour are swept once per process.
- `deepseek` — official API, OpenAI-compatible SSE. Note this one sends prompts off-machine.

`resolveAiClient` returns `null` when a hosted backend has no key, and the calling service falls back to deterministic output rather than erroring.

---

## 5. The renderer

`packages/desktop/src/renderer/src/`:

```
App.tsx                    four top-level views: Matches / Stats / Settings / Developer
bridge.ts                  window.__gladlogFixture ?? window.gladlog  (one line; the whole test seam)
fixtureBridge.ts           a fake GladlogApi over a checked-in match, for browser-only development
batch/batchAnalysis.ts     serial batch-analysis driver (queue, cancel, skip-if-cached)
batch/autoAnalyze.ts       auto-analyse newly recorded matches; only fires on live===true payloads
components/                list rows, filters, settings, stats dashboard, dev panel, batch bar
report/derive/             pure functions, doc → view model
report/components/         the report's React components
report/data/               arena floor polygons, spec names, game constants
```

### The derive layer

`report/derive/*.ts` is where a match document becomes something a component can render. The rule is that these are pure functions of a `ReportSource` (`derive/types.ts`: a `StoredMatch` or a single `StoredShuffleRound` — the same shape either way), so they can be tested without React and reused by the image exporter and by the markdown export.

Representative modules: `timeline.ts`, `meterRows.ts`, `statsTable.ts`, `deathRecap.ts`, `matchArc.ts`, `replay.ts` / `replayHighlights.ts`, `pressureLanes.ts`, `gcdCluster.ts`, `ccChainDash.ts` / `dispelDash.ts` / `kickDash.ts`, `burstLedger.ts`, `vulnWindows.ts`, `dampeningSeries.ts`, `auraUptime.ts`, `keyMoments.ts`, `videoMoments.ts`, `analysisInput.ts`, `exportReport.ts`, `inlineRich.tsx`, `findingDisplay.ts`, `jumpTarget.ts`, `slotLabel.ts`.

### `toLegacySafe` — the renderer↔analysis seam

Analysis functions expect the legacy `ICombatUnit` shape. `parser-compat` exports `toLegacyMatch(m: GladMatch)` to produce it, but the renderer must never call that directly. It calls `toLegacySafe` (`derive/legacySource.ts`), which does two things:

1. **Pads missing unit event arrays.** `parser-compat`'s converter iterates 13 per-unit arrays unconditionally. Render-test fixtures have `healIn` / `absorbsIn` / `actionsIn` / `actionsOut` stripped to keep them small, so a bare `toLegacyMatch` throws — and the surrounding `try/catch` then makes every analysis-derived panel silently disappear with no error. On a production doc the padding is a no-op.
2. **Caches with a bounded LRU of size 2.** Not a `WeakMap`: `ShuffleReport` holds strong references to all six rounds at once, so clicking through them accumulated six legacy blow-up copies (each roughly 2.5–3× the size of the round it came from). Size 2 covers "current round + the one you just left".

### Three data-flow paths, and no fourth

From `.claude/skills/desktop-dev/SKILL.md`, which you should read before touching `packages/desktop`:

1. **Renderer calls analysis directly (preferred).** `derive/*.ts` → `toLegacySafe(source)` → an analysis predicate. Precedents: `vulnWindows`, `deathRecap`, `statsTable`, `dampeningSeries`.
2. **Main service + IPC.** Anything that writes to disk, scans directories, or calls an LLM. The shape is: a service function, a handler in `ipc.ts`, and two places in preload. Progress and streaming use push channels (`gladlog:*:delta` / `:progress`).
3. **Plain data import.** Pure data exports (`SPELL_CATEGORIES`, `zoneMetadata`, icon tables) can be imported by the renderer freely.

Also from that document: the replay clock stays local to `ReplayView` (hoisting it re-renders all three views on every tick); cross-view seeking uses a `seekReq {tMs, unitNames, nonce}` prop where the nonce prevents double-consumption; and `CandidateEvent.t` plus all derive output is in **relative seconds** while the replay clock and raw event timestamps are **absolute milliseconds**, converted exactly once at the `MatchReport` boundary.

### The report tabs

`MatchReport.tsx` has five: `report` (Report), `replay` (Replay), `events` (Events), `video` (Video, shown only when a recording is associated), `ai` (AI Analysis). `ShuffleReport.tsx` wraps it with round selection.

---

## 6. Inside `@gladlog/analysis`

Seven subdirectories. This is the largest package and the one that actually knows anything about arena PvP:

| Subdirectory | Job                                          |
| ------------ | -------------------------------------------- |
| `utils/`     | derive facts about a match                   |
| `context/`   | render those facts into prompt text          |
| `data/`      | game data (plus ~17 MB of `.json` payloads)  |
| `analysis/`  | the LLM findings loop and its audits         |
| `learning/`  | cross-match pattern mining                   |
| `benchmark/` | offline corpus baseline collection           |
| `compare/`   | placing one player inside a pre-built corpus |

Two divisions are easy to confuse. **`utils/` answers "what happened"; `context/` answers "how does it appear in the prompt string, on which time grid, at what sampling radius"** — and the second is what the verification gates re-parse. Separately, **`benchmark/` _produces_ baselines offline (its only consumer is `scripts/collectBenchmarks.ts`, a CLI) while `compare/` _reads_ an already-built corpus at runtime**; neither is the other's helper.

### `src/utils/` — the analysis modules

These compute facts about a match. Almost all of them come in pairs: a `computeX`/`analyzeX` that returns structured data, and a `formatXForContext` that renders it into prompt text.

**Cooldowns and defensives**

| Module                              | What it computes                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cooldowns.ts`                      | The workhorse. HP/mana sampling at an instant, cooldown availability (`cdAvailableAt`, `isCooldownAvailableFromLastUse`), major-cooldown extraction, pressure windows, panic/overlapped defensive detection, plus the spec helpers `specToString` / `isHealerSpec` / `isMeleeSpec` and the time renderer `fmtTime` / `toRenderSecond`. |
| `counterfactual.ts`                 | "What would this defensive have saved?" — mitigation audit, unused self-defensives, missed externals.                                                                                                                                                                                                                                  |
| `enemyCDs.ts`                       | Reconstructs the enemy cooldown timeline and kill-attempt windows.                                                                                                                                                                                                                                                                     |
| `talentBehaviors.ts`                | Curated PvP-talent → behaviour catalogue (from official tooltips, not inferred from logs).                                                                                                                                                                                                                                             |
| `talents.ts` / `talentModifiers.ts` | Talent string decoding and talent-driven cooldown/charge modification.                                                                                                                                                                                                                                                                 |

**Crowd control, dispels, interrupts**

| Module                                | What it computes                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `dispelAnalysis.ts`                   | Defensive cleanse and offensive purge opportunity/miss analysis, with kill-window annotation and exemptions. |
| `ccTrinketAnalysis.ts`                | CC chains against the owner and trinket usage; classifies trinket type.                                      |
| `drAnalysis.ts`                       | Diminishing-returns state per target per category — why a CC came out short, and outgoing CC chain quality.  |
| `kickAudit.ts` / `enemyInterrupts.ts` | Interrupt audit; per-spec baseline interrupt availability.                                                   |

**Positioning and line of sight**

| Module                      | What it computes                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `positionAnalysis.ts`       | Owner engagement state from real X/Y coordinates: when to push in vs stay back.                        |
| `losAnalysis.ts`            | Position interpolation, `hasLineOfSight`, `distanceBetween`, nearest obstacle edge, LoS-break options. |
| `positionSampling.ts`       | **The shared sampling predicates** — see §9.                                                           |
| `healerExposureAnalysis.ts` | At each enemy burst window: is the healer trinket-less, CC'd, and in line of sight?                    |

**Offense and windows**

| Module                         | What it computes                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| `healerOffenseAnalysis.ts`     | Healer offensive contribution: slack segments, contested segments, window creation. |
| `offensiveWindows.ts`          | Burst sub-windows and offensive windows.                                            |
| `killWindowTargetSelection.ts` | Was the right target picked in a kill window (HP at time, trinket state)?           |
| `burstLedger.ts`               | Per-burst cast ledger and window targeting audit.                                   |
| `offensiveWasteAnalysis.ts`    | Offensive cooldowns spent outside a window.                                         |

**Outcomes, resources, situation**

| Module                                                                                            | What it computes                                                                            |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `deathOutcomeAnalysis.ts`                                                                         | For each death: what was available, what was locked out.                                    |
| `healingGaps.ts`                                                                                  | Gaps in healing coverage.                                                                   |
| `dampening.ts`                                                                                    | Dampening ramp per bracket, timeline, and danger multiplier.                                |
| `matchArchetype.ts` / `archetypeInference.ts` / `archetypeInjection.ts` / `enemyCompArchetype.ts` | Raw match measurements and the coarse enemy-composition bucket used for corpus cell lookup. |
| `combatStates.ts`                                                                                 | Spirit of Redemption / shapeshift / stasis intervals.                                       |
| `auraIntervals.ts`                                                                                | Pairs aura events into intervals — the single answer to "was this buff up at time _t_".     |
| `healerMetrics.ts` / `dpsMetrics.ts`                                                              | The metric vectors used for corpus comparison.                                              |
| `crisisEvents.ts`                                                                                 | Rotation extraction around crises.                                                          |
| `spellDanger.ts` / `spellSchools.ts`                                                              | Danger weighting and school helpers.                                                        |
| `specBaselines.ts`                                                                                | Static per-spec benchmark anchors.                                                          |

**Small shared primitives**
`stats.ts` (order statistics — anything taking a percentile by index must go through `toSortedFinite` rather than sorting for itself), `binarySearch.ts`, `memoize.ts` (a local replacement so the package doesn't pull 215 KB of lodash for four functions; it deliberately does **not** cache results computed before the background data tables finished loading), `utils.ts`.

### `src/context/` — prompt construction

This is where analysis output becomes the text a model sees. There is no single monolithic prompt builder; there are five entry points for five different LLM calls, of which three matter:

| Entry point                                          | Defined in                          | Used for                                          |
| ---------------------------------------------------- | ----------------------------------- | ------------------------------------------------- |
| `buildMatchContext(combat, friends, enemies, opts)`  | `context/buildMatchContext.ts`      | the rich match context — the bulk of every prompt |
| `buildFindingsPrompt(candidates, richContext, spec)` | `analysis/buildFindingsPrompt.ts`   | round 1 of the coach loop                         |
| `buildDeepDivePrompt(...)`                           | `analysis/deepDive.ts`              | round 2, the automatic follow-up                  |
| `buildExemplarLedPrompt(...)`                        | `compare/buildExemplarLedPrompt.ts` | cohort comparison narration                       |
| `buildDistillPrompt(...)`                            | `learning/distillRules.ts`          | cross-match habit distillation                    |

`buildMatchContext` is an orchestrator, not a calculator: it imports roughly 25 `formatXForContext` functions from `utils/`, computes the shared pieces (aligned burst windows, CC/trinket summaries) exactly once, and hands them down so sections cannot each recompute their own slightly different version.

| Module                            | Role                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `matchTimeline.ts`                | `buildMatchTimeline` — the rendered event timeline, the bulk of the prompt.                                                                 |
| `buildMatchContext.ts`            | `buildMatchContext` — the top-level prompt entry point.                                                                                     |
| `timelineHelpers.ts`              | Shared rendering helpers; exports `DMG_SPIKE_THRESHOLD`, which the renderer's pressure lanes import so lane count equals prompt line count. |
| `matchTimelineSections.ts`        | The `[STATE]` / section renderers.                                                                                                          |
| `resourceSnapshot.ts`             | Loadout, charges-ready, on-cooldown names, and the JSON situation snapshot.                                                                 |
| `matchNarrative.ts`               | The "Match Flow" narrative, segmented by burst windows rather than time slices, so causal order survives.                                   |
| `criticalWindows.ts` / `utils.ts` | Window helpers.                                                                                                                             |

### `src/analysis/` — findings, prompts, audits

| Module                                                | Role                                                                                                                                                                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `candidateFindings.ts`                                | `extractCandidateFindings` — deterministic candidates the model is allowed to talk about (CD waste, missed cleanse/purge, CC lockout, eaten kick, wasted trinket, death setup, unused defensive/external). |
| `deepDive.ts`                                         | Follow-up rounds: evidence packs around a finding or a selected window, plus their prompts and audits.                                                                                                     |
| `buildFindingsPrompt.ts`                              | The findings prompt.                                                                                                                                                                                       |
| `auditFindings.ts`                                    | Post-model audit: drop anything with bare numbers, invented events, or forbidden causal claims.                                                                                                            |
| `causalLint.ts`                                       | Regex-only lint for strong causal _language_ (the policy forbids it), in Chinese and English. It checks language, not truth.                                                                               |
| `spellNameZhLint.ts`                                  | Guards against spell names being translated into Chinese in output.                                                                                                                                        |
| `parseModelJson.ts`                                   | Tolerant JSON extraction (markdown fences and all) — the fix for the `bad-json` false-rejection class.                                                                                                     |
| `findingCategories.ts` / `types.ts` / `factFormat.ts` | Category normalisation and shared types.                                                                                                                                                                   |

### `src/compare/`, `src/benchmark/`, `src/learning/`

- **`compare/`**: looks your metrics up in a pre-built corpus cell (`cellLookup.ts`), turns them into percentiles against three stored anchors (`verifiedComparison.ts`), builds an exemplar-led prompt, and enforces placeholder discipline (`claimChecker.ts` — the placeholder syntax is defined once here because three consumers previously each had their own regex and drifted).
- **`benchmark/`**: `createBenchmarkAccumulator` / `computeBenchmarks` / `toPercentiles`, plus `stratifiedSample` (group by spec × archetype, cap each stratum deterministically — first N, no RNG). Offline only: its single consumer is the CLI `scripts/collectBenchmarks.ts`, whose output is copied to `src/data/benchmarks.json`. Nothing in the app calls it.
- **`learning/`**: the self-learning coach loop, in four stages — ledger (`types.ts`) → deterministic scan (`patternScan.ts`) → AI distillation (`distillRules.ts`) → deterministic rule application (`matchRules.ts`). `patternScan.ts` is the authority for `PATTERN_MIN_HITS`, `PATTERN_WINDOW_MATCHES`, `RULE_RETIRE_MAX_HITS` and the matching predicates; rule retirement (`main/learning.ts`) and habit badges (`matchRules.ts`) import them rather than copying values, so "the pattern that was mined" and "the finding that gets badged" are one judgement. Note the cross-match key is **`category` (plus candidate event type), not `findingKey`** — `findingKey` embeds per-match event ids that by construction never repeat. `distillRules.ts` lets the model phrase a pattern in human language, but the only two numbers it may write are `{{hits}}` and `{{windowMatches}}`, interpolated by code.

### `src/data/` — game data, generated and curated

Two layers, and the curated one always wins. `spellEffectData.ts` is the pattern: `{...SPELL_EFFECTS_GENERATED, ...SPELL_EFFECT_OVERRIDES}`.

Generated artefacts are produced by `packages/analysis/scripts/datagen/` from wago.tools DB2 dumps, and the build they came from is stamped in `src/data/datagen-manifest.json`. As of the checked-in manifest (build `12.1.0.68629`, generated 2026-08-01):

| Artefact                          | Size / count                                        |
| --------------------------------- | --------------------------------------------------- |
| `spellNames.json`                 | 413,355 entries, 12,223,778 bytes                   |
| `talentIdMap.json`                | 40 specs (3.2 MB on disk)                           |
| `spellIconsGenerated.json`        | 41,707 entries, 7,110 distinct icons, 780,473 bytes |
| `spellNamesZhGenerated.json`      | 39,668 entries, 960,177 bytes                       |
| `spellEffectGenerated.ts`         | 3,560 entries, 219,135 bytes                        |
| `mitigationGenerated.json`        | 15 entries (3 unresolved), 1,206 bytes              |
| `parser-compat/enumsGenerated.ts` | 41 specs, 14 classes                                |

Curated tables (`spellCategories.ts`, `classSpells.ts`, `drCategories.ts`, `spellTags.ts`, `spellEffectOverrides.ts`, `mitigationData.ts`, `arenaGeometry.ts`, `zoneMetadata.ts`, `spellNameStopwords.ts`, …) are hand-maintained whitelists. They rot every patch — see §9.7.

A third category is worth naming separately: **corpus-derived** data. `dispelObservedGenerated.ts` is the set of spell ids somebody actually dispelled or stole in a real match, and it exists precisely because it is a different question from the DB2 one. DB2's `dispelType` says a spell is _theoretically_ dispellable; this table says it _happened_. Missed-cleanse and missed-purge candidates are gated on the second, not the first.

### The public surface

`packages/analysis/src/index.ts` re-exports the prompt builder, most of `utils/`, the compare and findings modules, and named data tables. But note: **main deliberately bypasses this barrel.** `src/main/analysis.ts` and `compare.ts` both import from deep paths (`@gladlog/analysis/src/analysis/...`), with a comment explaining why — `index.ts` pulls in the data modules whose top-level `await` defeats tree-shaking, costing the main process ~13.6 MB of file reads and roughly 40 MB of resident heap for tables it never queries.

---

## 7. Inside `@gladlog/parser` and `@gladlog/parser-compat`

### L1 — line decoding (`src/l1/`)

Pure and stateless: one text line in, one `ParsedLine` out, `null` on anything unrecognised (the whole dispatcher body is wrapped in `try/catch → null`).

- `splitTopLevel.ts` — a tokeniser that splits on commas while respecting quotes, `[]` depth and `()` depth; `splitLine` cuts a line into `{datePart, eventName, params}` at the first double space.
- `timestamp.ts` — `parseTimestamp`. With an explicit `±offset` suffix it is arithmetic; without one it runs a three-iteration fixed-point solve against a cached `Intl.DateTimeFormat` to invert wall-clock back to UTC.
- `decoders.ts` — twelve pure decoders (`decodeBaseUnits`, `decodeSpell`, `decodeDamage`, `decodeHeal`, `decodeAdvanced`, `decodeAura`, …). Advanced-parameter position is _discovered_, not fixed: `decodeAdvanced` scans forward for the first adjacent pair of dot-containing tokens to locate `(x, y)`, so Blizzard adding a field doesn't break it.
- `combatantInfo.ts` — likewise positional-agnostic: it locates talents / PvP talents / equipment / interesting auras by scanning for the next bracketed segment.
- `types.ts` — `ParsedLine`, whose optional decoded fields are typed as `ReturnType<typeof decodeX>`, making the decoders the schema. `ParsedLine.known` is the signal-to-noise flag for unhandled events.

### L2 — segmentation (`src/l2/`)

`Segmenter` is a three-state machine (`IDLE` / `IN_MATCH` / `IN_SHUFFLE`). Solo Shuffle is detected by `bracket === "Rated Solo Shuffle"`; its rounds are delimited by successive `ARENA_MATCH_START` lines, and only the final `ARENA_MATCH_END` closes the whole lobby. Diagnostics: `DOUBLE_START`, `ORPHAN_END`, `UNCLOSED_SEGMENT`.

Two things L2 owns that matter downstream:

- **`lineIndex`** is assigned here (`line.lineIndex = currentSegment.rawLines.length`, immediately before both arrays are pushed). This is the anchor for the "jump from an event in the UI to the original raw log line" feature.
- **`onOpen` / `onClose`** fire only on real IDLE↔open transitions — one pair per shuffle lobby, not per round. They exist so the OBS recorder knows when a match starts and stops.

### L3 — collection and composition (`src/l3/`)

- `roster.ts` — builds the unit table. Unit kind is resolved by GUID prefix first, then by flags; reaction is decided by **majority vote** over all flag values seen for that GUID. Pets map to owners via the advanced `ownerGuid`, with `SPELL_SUMMON` as a strictly lower-priority fallback.
- `collect.ts` — one pass fanning each record into eight groups; the same event object is pushed to both the source and destination unit's arrays (shared reference, not a copy).
- `compose.ts` — `buildMatch` / `buildShuffle`. Two facts worth knowing: the **match id is an FNV-1a 32-bit hash of `rawLines`** rendered as eight hex characters, so ids are content-derived and stable; and a shuffle round's `endTime` is clamped to the deciding death plus a 2 s grace, because rounds have no `ARENA_MATCH_END` of their own and the naive "last record" end inflated durations by roughly 35 s (and made dead players appear to cast).
- `outcome.ts` — result codes, and "the round winner is the team opposite the first death".
- `model.ts` — all output types: `GladMatchBase`, `GladMatch` (`kind: "match"`), `GladShuffleRound` (`kind: "shuffleRound"`, plus `sequenceNumber`), `GladShuffle` (which is _not_ a `GladMatchBase` — it is `{kind, rounds, startTime, endTime, rawLines, result}`), `GladUnit` with its 16 event arrays, and the event types.

### `src/slim.ts` — why documents are small

`slimMatchParams` truncates each event's raw `params` array to `SLIM_PARAMS_KEEP = 13` entries and blanks all but indices 2, 6, 10 (unit flags and spell school, consumed by `parser-compat`) and, for non-HP events, 11 and 12 (aura type/stacks and the extra spell of dispel/interrupt events, consumed by analysis). Everything past index 13 is the advanced-logging tail, already materialised into `advancedSamples` / `hp` / `crit` — and measured at **53% of a single 442 MB shuffle document**.

Three properties: it runs at construction time in `compose.ts` (documents are born slim); it materialises `crit` from the tail before truncating, so old fat archives self-heal correctly; and it is idempotent (already-slim events are recognised by `params.length <= 13 && params[0] === ""`).

The whole-library migration recorded in `CHANGELOG.md` took total match file size from **75.2 GB to 49.0 GB (−35%)**.

### `src/api.ts` and `src/invariants.ts`

`GladLogParser` is the streaming façade: `push(rawLine)` / `end()` / `on(event, cb)` / `stats()` / `hasOpenSegment()`, with seven events. `push()` strips a trailing `\r` first — with CRLF logs the feign-death bit compared as `"1\r" !== "1"`, so every Feign Death was counted as a real death. L3 build failures are downgraded to a `BUILD_FAILED` diagnostic rather than thrown.

`checkParserInvariants(m)` returns violations under seven codes: `time-bounds`, `monotonic`, `hp-range`, `death-has-damage`, `pet-owner-resolves`, `start-before-end`, `line-resolves`. Every threshold is annotated with the corpus measurement that set it — for example `HP_OVER_MAX_RATIO = 1.75` from 3,841 samples with p99 = 1.49 and max = 1.58; `MONOTONIC_TOLERANCE_MS = 5000` against a maximum observed backward jitter of 2,084 ms. That is the measure-then-lock pattern used throughout this repo.

### `@gladlog/parser-compat`

One direction only: new document → legacy `IArenaMatch` / `IShuffleMatch` with `ICombatUnit` units. Exports `toLegacyMatch`, `toLegacyShuffle`, a `WoWCombatLogParser` drop-in shim class, the flag→enum helpers, and the enums themselves.

Non-obvious transformations: numeric ids become strings; damage amounts are **negated**; absorbs are merged into the attacker's `damageOut` and re-sorted; pet damage/healing is merged into the owner and damage _to_ pets is zeroed; player units without a `COMBATANT_INFO` are dropped entirely; `advancedActorPowers` is always `[]` because the new parser does not collect power/mana (a documented degradation).

The enums in `src/enums.ts` carry a licensing note: they were previously copied from another project under CC BY-NC-ND 4.0, which is incompatible with this repo's MIT licence, and have since been re-anchored to Blizzard public facts (spec/class enums generated from DB2 into `enumsGenerated.ts`; `LogEvent` values are the literal log tokens; flag masks are `COMBATLOG_OBJECT_*`). `data/legacy-enum-manifest.json` locks the member counts and `test/enums.test.ts` asserts them member by member. See [DATA-COMPLIANCE.md](DATA-COMPLIANCE.md).

---

## 8. Where the data lives

Everything user-generated lives under Electron's `userData` directory — `~/Library/Application Support/gladlog` on macOS, `%APPDATA%\gladlog` on Windows.

```
<userData>/
├── settings.json                 GladlogSettings; secret fields encrypted via safeStorage
├── checkpoints.json              { files: { "<log filename>": {offset, firstLineChecksum} } }
├── reference_vectors.json        optional override for the bundled comparison corpus
├── icons/                        <spellIconName>.jpg, fetched from wow.zamimg.com, never evicted
├── recordings/                   NDJSON index of OBS recordings + the video files
├── learning/
│   ├── ledger.ndjson             one line per analysis run (append-only, last-run-wins per match)
│   └── rules.json                distilled cross-match rules
└── matches/
    ├── _index.ndjson             append-only StoredMatchMeta lines; last line per id wins
    └── <matchId>/
        ├── meta.json             StoredMatchMeta (the list row: teams, rating, duration, …)
        ├── match.json            {schemaVersion, storedAt, kind, data}  ← the document
        ├── raw.txt               the exact source lines, joined by "\n"
        ├── analysis-v2.<lang>.json     AI findings, per-model slots (see below)
        ├── windowAnalysis.<lang>.json  selected-window analyses, LRU of 20
        └── compare.json                the reference-corpus comparison result
```

### Writes are atomic

A match is written into `.tmp-<dir>`, then `rename`d over the final directory. The NDJSON index is append-only for the normal path and rewritten via tmp + rename when repair is needed. `MatchStore.init()` reconciles the index against the directory names on disk — recovering matches whose directory exists but whose index line was lost to a crash, and dropping index entries whose directory is gone. The same tmp + rename discipline is used by `checkpoints.ts`, `learningLedger.compact()`, the analysis caches, and `slimWorker.ts`.

### How big this actually gets

Measured on the author's machine on 2026-08-01. **These are one machine's numbers, not a specification** — measure your own before designing around them.

| Thing                 |     Count |   Total |  Median |     p75 |      p95 |      Max |
| --------------------- | --------: | ------: | ------: | ------: | -------: | -------: |
| matches (directories) |       808 |   62 GB |       — |       — |        — |        — |
| `match.json`          |       808 | 49.2 GB | 46.3 MB | 99.6 MB | 161.2 MB | 264.1 MB |
| `raw.txt`             |       808 | 13.1 GB | 12.4 MB |       — |        — |  70.8 MB |
| `meta.json`           |       808 | ~0.5 MB |  ~700 B |       — |        — |        — |
| `icons/`              | 121 files |  484 KB |       — |       — |        — |        — |

On this machine only 2 matches carried an analysis cache and 1 carried a comparison — the AI features are opt-in and per-match, so the library is overwhelmingly parsed documents. `recordings/` and `learning/` did not exist (never used here).

The headline: **a single match document has a median of 46 MB and a tail past 260 MB.** Every design decision in §9 follows from that one number.

### The analysis cache envelope

`src/shared/analysisSlots.ts` defines a v2 envelope keyed by model:

```ts
interface AnalysisCacheDocV2<T> {
  schemaVersion: 2;
  language: string;
  slots: Record<string, AnalysisSlot<T>>; // key = slotKeyOf(backend, model) = "agy:pro"
  lastSlotKey: string; // the slot to display/consume
}
interface AnalysisSlot<T> {
  promptVersion: number;
  createdAt: number;
  result: T;
}
```

Running the same match through a second model adds a slot instead of overwriting one, which is what makes side-by-side model comparison possible. `toSlottedDoc` lazily wraps a v1 single-result file into a one-slot v2 in memory (it does not rewrite the file); `resolveActiveSlot` is the single read predicate; `upsertSlot` is the single write predicate; `slotKeyOf` / `splitSlotKey` are the only places a slot key is joined or split.

Cache invalidation is by `PROMPT_VERSION` plus language. Files are named `analysis-v2.<lang>.json`; a legacy `analysis-v2.json` (written before language keying, when output was always English) is read only when the requested language is `en`.

`windowAnalysis.<lang>.json` is an LRU of at most 20 window analyses, each stamped with its own `promptVersion` — per entry, not per file, because one file holds many unrelated windows and a version bump should not nuke all of them.

Note that the **learning ledger is deliberately independent of the analysis cache.** It records `promptVersion` but never invalidates on it: the coach's long-term memory must not be erased every time the prompt builder changes.

---

## 9. Cross-cutting constraints

These are the things that will bite you. Each one has a measured cost attached.

### 9.1 Large JSON must go through `JSON.parse`, not object literals

`spellNames.json` has 413,355 keys. Vite's default (`json.stringify: false`) compiles a JSON import into a JavaScript object literal, which V8 must parse **as source code**. Measured: that blocked first paint for about **22 seconds**. The identical data via `JSON.parse` takes **42 ms**.

The fix is `json: { stringify: true }`, and it must be set for **all three** electron-vite targets (`packages/desktop/electron.vite.config.ts`) plus the standalone browser test bed (`packages/desktop/dev/vite.config.mts`), because both main and renderer reach this data through the analysis package.

The before/after, from `docs/BACKLOG.md`:

| Metric              | Before      | After       |
| ------------------- | ----------- | ----------- |
| app cold start      | 18.7–24.0 s | 1.59–1.72 s |
| report first render | 21.9–27.0 s | 2.12–2.19 s |
| visual suite total  | 3.0 min     | 22 s        |
| E2E suite total     | 1.3 min     | 14.5 s      |

This failure mode produces **no error at all** — only "the app is slow" — so it is guarded by a budget instead of by a human noticing: `packages/desktop/qa/budgets.ts` locks `parse` / `firstPaint` / `coldStart` at 4900 / 3300 / 2600 ms (CI p-max × 1.5). Those budgets were 5100 / 41000 / 36000 before this fix. Loosening any of them requires the reason in the commit message.

Generated data modules follow the same rule: `spellIconsGenerated.ts` and `spellEffectGenerated.ts` are thin `.ts` wrappers whose payload lives in a same-named `.json`. `spellIconsGenerated.json` additionally uses dictionary encoding — 41,707 entries share only 7,110 distinct icon names, so a flat `Record` was 48% duplicate strings (1.5 MB → 780 KB); the wrapper expands it back so consumers see an unchanged API.

### 9.2 Big tables load in the background; prompt paths must wait for them

`spellNames.json` (12 MB) and `talentIdMap.json` are loaded by a fire-and-forget dynamic `import()` at module evaluation time, **not** by top-level `await` — TLA would make the whole module graph, including renderer first paint, wait for a table the match list never queries.

The contract (`packages/analysis/src/data/ensure.ts`):

- **Any entry point that builds a prompt must `await ensureAnalysisData()` first.** Spell and talent names in a prompt may not degrade, because the verification gates re-parse the rendered text. Every script that reaches a prompt builder is checked by `packages/eval/test/ensureAnalysisDataEntrypoints.test.ts` (it follows imports through library modules); on 2026-09-24 25 scripts had skipped it and silently degraded talent cooldowns in their first combats.
- **UI display paths may skip the await.** They fall back (log name, empty array) and self-heal on the next render.

There are three such entry points today: the renderer's `StructuredAnalysisPanel` (behind a `dataReady` gate), `main/analysis.ts`'s deep-dive path, and `eval`'s corpus builder. Add a fourth the same way.

Related: `memoize.ts` refuses to cache a result computed while the tables were still loading, because that would freeze the degraded answer permanently.

### 9.3 A match document is materialised exactly once

The old path parsed a document in the worker, again in main, and again in the renderer. On a 426 MB match that measured roughly **5 GB of peak heap across three processes**, and main's LRU held two full object graphs permanently (1–2 GB resident).

The current path:

- `MatchStore.get(id)` returns the **raw `Buffer`** of `match.json`. Nothing in main parses a document.
- Main's LRU caches bytes with a **total byte cap** (`LRU_MAX_BYTES = 256 MB`, `LRU_MAX_ENTRIES = 2`). A single document larger than the cap is not cached at all — the OS page cache handles it.
- `parseDocBytes` (`src/shared/parseDocBytes.ts`) runs in **preload**, the same heap as the renderer, so the one materialisation is the one the UI uses.

Corollaries you must respect:

- **Never `JSON.stringify` a whole match in the renderer, and never send one over IPC.** Structured cloning a 46 MB (median) or 264 MB (tail) object graph across the process boundary freezes both ends.
- **Never read a whole file to get one piece of it.** `readNthLine` streams `raw.txt` in 1 MB chunks and stops at the target line, because the old implementation's read-then-`split` froze the main thread on a median 12 MB file. Similarly, shuffle round line offsets are cached in `meta.roundLinesTotal` so a raw-line lookup does not have to parse the document at all.
- **Heavy work goes to a worker thread.** `rebuildIndex()` parses each `match.json` in a worker (the synchronous version was ~83 GB of reads and 6–10 minutes of frozen UI across 794 matches); `slimWorker.ts` does the read-parse-slim-rewrite for old fat archives in the background, off the open path.

### 9.4 The gate predicate is the specification

This is the repo's first rule, stated in `CLAUDE.md`. Any two consumers of the same fact — the analyser and the verification gate, main and renderer, the prompt and the UI — must import the **same constant and the same function**, anchored to the **rendered** value. Prompts render time via `fmtTime` (floor to whole seconds) and the gates re-parse that rendered text, so any judgement a gate will recompute must be made on the rendered grid, not on fractional seconds.

Live examples:

| Predicate                                          | Defined in                                | Also imported by                                                                                                                                                 |
| -------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HP_SAMPLE_RADIUS_MS = 3000`                       | `analysis/src/utils/cooldowns.ts`         | `matchTimeline.ts`, `matchTimelineSections.ts`, `candidateFindings.ts`, `killWindowTargetSelection.ts`                                                           |
| `LOS_SWEEP_SLACK_S = 2`, `LOS_SWEEP_GAP_MS = 3000` | `analysis/src/utils/positionSampling.ts`  | `analysis/src/utils/healerExposureAnalysis.ts`, and `eval/src/quality/positioningScan.ts` where they are aliased to `TIME_SLACK_SECONDS` / `POSITION_MAX_GAP_MS` |
| `INTERP_MAX_GAP_MS = 1500`                         | `analysis/src/utils/positionSampling.ts`  | position interpolation grounding — deliberately **not** equal to `LOS_SWEEP_GAP_MS`                                                                              |
| `PATTERN_MIN_HITS` and friends                     | `analysis/src/learning/patternScan.ts`    | `main/learning.ts`, `analysis/src/learning/matchRules.ts`                                                                                                        |
| `DMG_SPIKE_THRESHOLD`                              | `analysis/src/context/timelineHelpers.ts` | the renderer's pressure lanes                                                                                                                                    |
| `findingKey`                                       | `desktop/src/shared/findingKey.ts`        | main's aggregation and the renderer's mark button                                                                                                                |
| `slimStoredDoc`                                    | `desktop/src/shared/slimDoc.ts`           | `slimWorker.ts`, the library migration script, preload's parse fallback                                                                                          |
| `slotKeyOf` / `splitSlotKey`                       | `desktop/src/shared/analysisSlots.ts`     | main's deepen path and the renderer's slot label                                                                                                                 |
| `BUDGET_MS`                                        | `desktop/qa/budgets.ts`                   | the parser's parse budget test, the visual first-paint spec, the E2E cold-start spec                                                                             |

`positionSampling.ts`'s header is worth reading in full: those constants used to be declared privately in four places and coupled only by a comment saying "must stay equal to positioningScan.ts". Five independent bugs in the 2026-07 full-corpus audit were all of this shape — inconsistent HP sampling radius, bounded vs unbounded lookback, interpolated vs raw vs non-simultaneous sampling for LoS, fractional vs rendered-second scan grids. The fix is always to make the analyser consume the gate's predicate, never to loosen the gate.

The same file also warns about a same-name trap: `INTERP_MAX_GAP_MS` and `LOS_SWEEP_GAP_MS` were both once called `POSITION_MAX_GAP_MS` with values 1500 and 3000.

Two more instructive cases:

- **`context/criticalWindows.ts`.** In a 50-match evaluation, 31 + 6 defects turned out to share one root cause: `[STATE]` ticks narrowed the HP sampling radius to ±1.5 s inside critical windows, while `[DMG SPIKE]` and `[CD]` lines used ±3 s — and those lines only ever appear _inside_ critical windows. So the same rendered second could report 2% HP on one line and 88% on another. The narrower radius was deleted outright rather than reconciled.
- **The deleted `HP_SAMPLE_RADIUS_CRITICAL_MS`.** The long comment under `HP_SAMPLE_RADIUS_MS` in `cooldowns.ts` records why: the radius only decides accept/reject, since `getUnitHpAtTimestamp` picks the nearest sample first. Narrowing it can null a value but can never change one, so it fixed nothing (26/50 → 26/50) while deleting units entirely from `[STATE]` in 24/50 matches. The real cause was grid misalignment, fixed by `toRenderSecond`.

`packages/analysis/test/cdAvailablePredicateConvergence.test.ts` exists as a drift sentinel for this class of problem: it names six sites that once each had their own answer to "was this defensive available and unpressed at death", asserts they all now agree with `cdAvailableAt`, and documents the one site deliberately left out because its semantics genuinely differ.

When you cannot put a predicate in one place, write a test that asserts the two copies are equal. Do not rely on a comment.

### 9.5 The renderer must never value-import from `main/`

`electron-vite` builds the renderer for a browser target. A value import from a `main/` module drags that module's transitive Node built-ins into the browser bundle, and the failure — `"join" is not exported by "__vite-browser-external"` — appears **only** in `electron-vite build`. Local `vitest` and `tsc` both pass.

This has happened. `analysisCache.ts` has a `join` from `path` at the top for `analysisCachePath`; the renderer's `slotLabel.ts` imported `splitSlotKey` from it, and presubmit caught the broken bundle. The pure slot logic was split out into `analysisSlots.ts`, which has zero `fs`/`path` imports and is safe for both sides. `analysisCache.ts` keeps an `export *` only for backwards compatibility with existing main-side imports.

**Rule:** any pure function the renderer needs lives in `src/shared/` with no Node imports. Type-only imports (`import type`) from `main/` are fine and are used widely.

### 9.6 Secrets never cross the IPC boundary

`GladlogSettings` holds three secret fields (`anthropicApiKey`, `deepseekApiKey`, `obsWebsocketPassword`). On disk they are encrypted with Electron's `safeStorage` (with a documented no-op fallback for platforms without a keyring). Over IPC, `redactSettings` replaces each with a sentinel constant (`API_KEY_REDACTED` and friends, defined in `shared/protocol.ts`) — the renderer only ever learns whether a key is _set_. `sanitizeSettingsPatch` on the way back recognises the sentinel and keeps the stored value.

Two related choices: `aiDebugLog.ts` keeps prompts in memory only, never on disk, because prompts contain match detail; and `deepseekClient.ts` scrubs both the configured key and any `sk-…` token out of upstream error bodies before they can reach an error banner.

The `vod://` protocol handler is likewise not a general file reader: it serves a path only if that exact path appears in the recordings index.

### 9.7 Whitelists rot

Every curated set of spell ids — CC, dispels, interrupts, burst cooldowns, icons — silently decays each patch. Two failure modes are documented in this repo's history: a spell being given a new id (so a cast/aura pair diverges and the whitelist half-works), and an upstream catalogue dropping an entry so an entire downstream whitelist chain goes quiet. In corpus data, "never happened" and "cannot be emitted" look identical.

Consequently: before adding new tracking, get corpus evidence — mine `SPELL_CAST_SUCCESS` / `SPELL_DISPEL` and look at the **per-spec rate**, not the absolute count. Missing values (cooldowns, durations) come from corpus measurement (minimum inter-cast gap; median from aura applied → removed), never from guesswork. `packages/eval/scripts/rotScan.ts` mines the corpus for rot; `docs/commands/update-wow-data.md` includes the rot-regression step in the refresh procedure.

### 9.8 Claiming a fix requires before/after numbers under one criterion

Also from `CLAUDE.md`, and the reason several sections above cite specific measurements. Reading the code and writing a convincing commit message does not count as verification. The cost of learning this: a fix landed on the strength of a well-argued root cause, and later measurement showed 26/50 → 26/50 — not one number moved.

Where possible, the criterion becomes a deterministic check wired into a gate rather than a throwaway script, because a script disappears with the session and nothing blocks the regression next time.

---

## 10. Verification surfaces

| Surface                        | Lives in                                           | Guards                                                                                                                                         |
| ------------------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests                     | each package's `test/` plus co-located `*.test.ts` | predicates, derive functions, component rendering (jsdom)                                                                                      |
| Parser invariants              | `packages/parser/src/invariants.ts`                | seven structural properties of every parsed match                                                                                              |
| Differential oracle            | private repo (`oracle/`, `npm run gate`)           | old vs new parser output over 164 real match pairs                                                                                             |
| Deterministic prompt gates     | `packages/eval/src/quality/promptQualityCheck.ts`  | percentile monotonicity, same-second HP agreement, window-duration self-consistency, cooldown-ledger consistency, plus friendly-death coverage |
| Geometry gate                  | `packages/eval/src/quality/positioningScan.ts`     | six classes of geometric claim, recomputed from raw coordinates                                                                                |
| Coverage oracle                | `packages/eval/src/quality/coverageManifest.ts`    | built from raw parser events, never through the prompt builder (anti-circularity)                                                              |
| LLM judge + calibration        | `packages/eval/src/judge/`, `src/provenance/`      | scoring, planted-defect calibration, score provenance                                                                                          |
| Visual regression / a11y / E2E | `packages/desktop/qa/` (Playwright)                | rendering, axe rules, cold start, import, export, evidence links                                                                               |
| Performance budgets            | `packages/desktop/qa/budgets.ts`                   | order-of-magnitude regressions in parse / first paint / cold start                                                                             |

Two operational notes. Visual baselines are generated in CI — never run `test:visual` locally against checked-in baselines. And `packages/corpus-tools/scripts/` really downloads data from a third-party volunteer project's API; do not run those scripts casually.

The evaluation workflows themselves (`/eval-baseline`, `/eval-ab`, `/calibrate-judge`, `/pipeline-audit`) are documented in `docs/commands/`; their output goes to a private repository at `$GLADLOG_EVAL_HOME`, never into this one.

---

## 11. Where to start reading

Five concrete paths. Each is a chain of files to open in order.

**1. "How does a match become a report?"** — the spine.

```
packages/parser/src/api.ts                        the streaming façade
packages/parser/src/l3/compose.ts                 what a document actually is
packages/desktop/src/worker/pipeline.ts           how tailing feeds the parser
packages/desktop/src/main/matchStore.ts           how it lands on disk
packages/desktop/src/preload/api.ts               the contract the UI sees
packages/desktop/src/renderer/src/report/derive/timeline.ts    a representative derive module
packages/desktop/src/renderer/src/report/components/MatchReport.tsx
```

**2. "I want to add an analysis predicate."**

Read `CLAUDE.md`'s shared-predicate rule first, then:

```
packages/analysis/src/utils/positionSampling.ts   what a single-source predicate looks like
packages/analysis/src/utils/cooldowns.ts          sampling, availability, fmtTime — the shared plumbing
packages/analysis/src/analysis/candidateFindings.ts   how a fact becomes a coachable candidate
packages/analysis/src/context/buildMatchContext.ts    how it reaches the prompt
packages/eval/src/quality/promptQualityCheck.ts       how it gets re-checked against the log
```

The question to answer before writing code: _which gate will recompute this, and will it import my constant or its own copy?_ If the answer is "its own copy", stop and restructure.

**3. "I want to change the report UI."**

Read `.claude/skills/desktop-dev/SKILL.md` first — the three data-flow paths, the `seekReq` nonce pattern, and the fixture-injection testing approach are all there. Then:

```
packages/desktop/src/renderer/src/report/derive/legacySource.ts   the toLegacySafe seam
packages/desktop/src/renderer/src/report/derive/types.ts          ReportSource
packages/desktop/src/renderer/src/report/components/MatchReport.tsx
packages/desktop/test/fixtures/real-match-sample.json             the anonymised test fixture
packages/desktop/dev/README.md                                    the browser-only test bed
```

Iterate with `npm run dev:ui` inside `packages/desktop` (a pure-browser Vite bed on port 5199 — no Electron, no game client). Before pushing:
`npm test --workspace=packages/desktop && npm run typecheck && npx eslint packages/desktop/src --quiet`.

**4. "I want to touch the parser."**

```
packages/parser/src/l1/parseLine.ts       the dispatcher
packages/parser/src/l2/segmenter.ts       the state machine, and where lineIndex comes from
packages/parser/src/l3/compose.ts         id hashing, shuffle round end clamping, born-slim
packages/parser/src/invariants.ts         what must remain true afterwards
packages/parser/src/slim.ts               why params look the way they do
packages/parser/test/                     19 files, L1/L2/L3 split
```

Parser changes must pass the differential oracle in the private repo (`npm run gate`, comparing old and new output over 164 real match pairs). Note the golden tests are gated on `GLADLOG_FIXTURES` and skip themselves when real logs are absent — a green local run does not mean they ran.

**5. "I want to understand the AI path end to end."**

```
packages/desktop/src/renderer/src/report/derive/analysisInput.ts   candidates + owner resolution
packages/analysis/src/analysis/candidateFindings.ts                what the model is allowed to discuss
packages/analysis/src/context/buildMatchContext.ts                 → matchTimeline.ts, the prompt
packages/desktop/src/main/analysis.ts                              cache slots, run/deepen/window
packages/analysis/src/analysis/auditFindings.ts                    what gets thrown away
packages/analysis/src/analysis/causalLint.ts                       the causal-language policy
packages/desktop/src/main/learning.ts                              → analysis/src/learning/patternScan.ts
```

---

## Appendix: how the numbers in this document were obtained

- **File and line counts** — `find packages/*/src \( -name '*.ts' -o -name '*.tsx' \)` piped through `wc -l`, on 2026-08-01 at commit `375725b`. Co-located tests are included; separate `test/` directories are not.
- **Library size** — `find` + `stat -f '%z'` over `~/Library/Application Support/gladlog/matches` on the author's machine, 2026-08-01. One machine, one player's history.
- **Generated data-table sizes** — read from the checked-in `packages/analysis/src/data/datagen-manifest.json` (build `12.1.0.68629`).
- **Performance figures (22 s → 42 ms, the budget table, the −35% slimming)** — quoted from the in-repo records that locked them: `packages/desktop/electron.vite.config.ts`, `packages/desktop/qa/budgets.ts`, `docs/BACKLOG.md`, `CHANGELOG.md`. They were measured then, on that hardware; they are cited as orders of magnitude.
- **Not verified here** — the contents of the private eval repository (`$GLADLOG_EVAL_HOME`, including `audit/layerAAudit.mjs`) and of the parser differential oracle; behaviour on Windows; anything requiring the app to actually run. Nothing in this document was checked by launching gladlog.
