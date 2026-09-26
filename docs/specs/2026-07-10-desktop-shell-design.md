# Subproject 2: Desktop Shell (Electron + Vite) Design

Date: 2026-07-10
Status: Pending User Review
Upstream Documents: `docs/specs/2026-07-10-clean-rewrite-roadmap-design.md` (Roadmap), `HANDOFF-2026-07-10.md` (now `docs/archive/HANDOFF-2026-07-10.md`)

## Goals and Scope

v1 Desktop Shell = Electron + Vite + React skeleton, connecting the end-to-end data flow of "log directory monitoring → parsing → persisting to disk → UI presentation", and can be packaged for installation.

**In Scope**:

- Monitor WoW retail log directory (`WoWCombatLog*.txt` under `_retail_/Logs`, including rotation/multi-file)
- Parsing (`@gladlog/parser`, utilityProcess worker)
- Match persistence to disk (parsed JSON results + raw log segments)
- Typed `window.gladlog` IPC bridge
- Debug-level real-time UI: monitoring status + match list (time/map/win-loss) + JSON details
- Settings persistence (WoW directory; Anthropic key/model field placeholders for Subproject 4)
- electron-builder packaging: Windows (NSIS) + macOS (dmg, unsigned)

**Out of Scope** (decided): Formal battle report UI (Subproject 3), AI analysis (Subproject 4), replay, auto-update (independent small task before release), everything cloud, WoW classic support (parser is currently retail-only).

## Confirmed User Decisions

| Decision | Choice |
| -------- | ------ |
| Acceptance UI | Debug-level real-time list (not an empty shell) |
| Packaging Platform | Windows + macOS |
| Auto Update | Not doing for v1 |
| Persistence | Shell-level disk persistence: dual persistence of parsed JSON + raw log segments |
| Architecture | Plan A: Single package + utilityProcess worker parsing |

**Plan A vs Alternatives**: B (dual-package structure, parsing in main process) is an over-engineered structure for a v1 with only one debug page, and the initial scan of hundreds of MBs of logs would freeze the main process; C (renderer parsing) ties the data foundation to the window lifecycle, making the background monitoring pattern unviable. With Vite, the cost of decoupling packages later is low, so we start with a single package.

## Package Structure

```
packages/desktop          # @gladlog/desktop, electron-vite 3-stage build
  src/main/               # Main process: lifecycle, window, worker management, storage, settings, IPC
    workerHost.ts         # utilityProcess startup/configuration/crash recovery/quarantine
    matchStore.ts         # Match disk persistence/indexing/deduplication
    settingsStore.ts      # settings.json (ported from own settingsModule logic)
    detectWowDir.ts       # WoW directory detection (ported from own pipeline-app/detect.ts)
    ipc.ts                # ipcMain handlers, sole registration point for the bridge surface
  src/worker/             # utilityProcess: full chain of monitor+read+parse (see debate revision)
    watcher.ts            # Directory monitoring (ported from own windows-agent/watcher.ts semantics)
    tailReader.ts         # Incremental byte→line reading, rotation/truncation detection
    checkpoints.ts        # Safe boundary checkpoint (registry pattern from state.ts)
    pipeline.ts           # Feeds GladLogParser, sends match/diagnostic/status events to main
  src/preload/            # contextBridge: window.gladlog, exports GladlogApi type
  src/renderer/           # React debug page (Vite)
```

Dependencies: `@gladlog/parser` (workspace), electron, electron-vite, electron-builder, react, react-dom, electron-log. Zero upstream code; `@gladlog/parser-compat` does not enter the shell (it is for legacy code consumption in Subproject 4).

Loading method: dev = Vite dev server + HMR; prod = `loadFile` static bundle. **No local HTTP server** (the old fork's Next standalone + waiting for port 3088 approach is completely obsolete).

## Core Components

> Revised via agy debate (see debate records): **Monitoring + reading + parsing are all within the utilityProcess worker**. The main process does not handle log bytes — this avoids hundreds of MBs of strings freezing the main process event loop via IPC structured cloning, and the entire ack/backpressure protocol was deleted.

### 1. LogWatcher (worker process)

Ported semantics from own `windows-agent/watcher.ts`: `fs.watch(logsDir)`, filter `WoWCombatLog*.txt`, drop `rename` events (to avoid new file race conditions); dirty file set + flush interval (default 2s) + one extra flush in quiet period; stop the clock when idle. The flush callback is handed to TailReader.

### 2. TailReader + checkpoint (worker process)

- Per-file checkpoint: `{ offset, firstLineChecksum }` (registry pattern from own `state.ts`, atomic write tmp+rename, stored in userData).
- Rotation/truncation detection: `size < offset` or first line checksum change → treated as a new file, read from 0, parser instance rebuilt.
- Incremental read: read from offset to EOF, split lines by `\n` (strip `\r`), cache cross-chunk partial lines for the next time.
- **Checkpoint only advances at safe boundaries**: When a segment is closed (match/shuffle produced or segment judged as discarded) and the parser has no ongoing segment, advance to the end of the consumed complete line. If the shell is restarted during a match → after restart, replay from the boundary before the match started, completely rebuilding the ongoing match, with `matchId` (content hash) idempotent deduplication absorbing duplicate events produced by the replay. **No lost matches across restarts**.
- Relies on a minor parser tweak: `GladLogParser` exposes a read-only query "is there currently an open segment/shuffle sequence" (e.g. `hasOpenSegment(): boolean`), zero behavioral change; exact name to be decided during implementation planning.

### 3. Worker pipeline + WorkerHost

- Inside worker, one `GladLogParser` instance per-file (rotation = new instance), lines are fed directly via `push()`; match/shuffle events (payload contains `rawLines`, a few hundred KB/match, low frequency) are sent to the main process.
- worker→main: `{ type: 'match' | 'shuffle', fileKey, payload }`, `{ type: 'diagnostic', fileKey, payload }`, `{ type: 'status', ... }` (monitoring/file list/progress/quarantine status)
- main→worker: `{ type: 'configure', logsDir }` (startup and directory change)
- Main process `workerHost.ts`: spawn/configure/crash restart. Crash recovery = resume reading from each file's checkpoint (safe boundary) after restart; **Per-file quarantine**: 3 consecutive crashes caused by the same file → isolate the file (other files continue), diagnostic logs file+offset for offline reproduction, automatically un-quarantined after the file rotates.
- Crash attribution: worker's status events continuously carry "currently processing fileKey+offset", main caches the latest value; attributes crashes using this value, 3 consecutive times with same file + similar offset → adjudged a poison pill, quarantine the file.
- Event handling written as pure functions + injectable transport/fs, facilitating unit testing without spinning up Electron.

### 4. MatchStore

- Directory: `userData/matches/<matchId>/`, containing:
  - `match.json`: Parsed results + envelope `{ schemaVersion, parserVersion, storedAt }`
  - `raw.txt`: Raw log line segment for the match (a few hundred KB/match; enables offline replay reconstruction after parser upgrades, no fear of logs being rotated/deleted by WoW)
- Raw segment source: `GladMatch`/`GladShuffle` already includes `rawLines: string[]` (verified in l3/model.ts), zero parser changes; upon disk persistence, extracted from payload to write `raw.txt`, stripped from `match.json` to avoid duplicate storage.
- Scans directory on startup to build memory index (id, time, map, mode, win/loss, duration); index pushed to renderer.
- Atomic writes (tmp+rename); if `matchId` already exists → skip (idempotent).

### 5. SettingsStore

Ported from own `settingsModule.ts` logic: `userData/settings.json`; fields: `wowDirectory`, `anthropicApiKey`, `anthropicModel` (the latter two are just get/set in v1, no consumers).

### 6. WoW Directory Detection

Ported from own `detect.ts`: On Windows, detects standard paths like `C:\Program Files (x86)\World of Warcraft\_retail_` and checks if `Logs` exists; on macOS or if detection fails → guides user to manually pick via `selectDirectory()`. Selected value saved to settings.

## IPC bridge (window.gladlog)

Hand-written typed contextBridge (will not reproduce the old fork's auto-generation mechanism — audit confirms own code's consumption surface of the old bridge is close to zero, and the new UI is written from scratch in Subproject 3):

```ts
window.gladlog = {
  logs: { getStatus(), onStatusChanged(cb), onMatchStored(cb), onDiagnostic(cb) },
  matches: { list(), get(id) },        // list=index metadata; get=read match.json
  settings: { get(), save(partial) },
  app: { getVersion(), selectDirectory(), openExternal(url) },
}
```

`GladlogApi` type defined in preload, renderer consumes it via `declare global`. Events wrapped with `ipcRenderer.on`, providing unsubscribe.

## Data Flow

```
Startup (main) → settings.wowDirectory (None → Detect → Still none → renderer guides manual selection)
  → spawn worker + configure(logsDir)
  → worker: initial scan (resume reading from checkpoint for each WoWCombatLog*.txt) → fs.watch incremental
    → split lines → GladLogParser → match/shuffle events sent to main
  → main: MatchStore disk persistence → IPC push to renderer → list update
```

## Error Handling

- Worker crash: Auto-restart, resume reading from safe boundary checkpoint for each file + idempotent matchId; same file causing crash 3 consecutive times → quarantine the file (other files continue, app doesn't stall), diagnostic logs file+offset, automatically un-quarantined after rotation.
- Log directory non-existent/no-permission/deleted: watcher errors but doesn't exit, status pushed to renderer, can go to settings to change directory; directory change = main sends configure, worker stops old watcher + starts new watcher (checkpoint keyed by file path, naturally isolated).
- Parser diagnostic: Pass-through to renderer debug page + `electron-log` writes to log file.
- Main process uncaughtException/unhandledRejection: log but do not exit (own pipeline-app convention).
- Storage directory write failure (disk full, etc.): report diagnostic, do not crash.

## Testing Strategy

Continuing Subproject 1's workflow: **Claude writes test contracts, agy exec implements, Claude independently verifies green lights**; TDD, per-task commit.

- **Unit Testing (without Electron)**: watcher semantics (inject watchFn, own windows-agent test style), tailReader (incremental/cross-chunk partials/rotation/truncation/CRLF), checkpoint safe boundary advancement (no advancement during an ongoing match), matchStore (atomic write/deduplication/index rebuild/rawLines stripping), worker event pure function layer, settingsStore, detectWowDir (inject FsProbe).
- **Worker Integration**: Instantiate worker pipeline directly in node environment + feed fixture log segments to real `GladLogParser` (including simulated append, rotation, restart resume read), assert match event sequence and checkpoint behavior; utilityProcess itself is just a thin wrapper.
- **End-to-End Acceptance (run independently by Claude)**: mac dev mode pointing to local corpus sample directory, simulating append writes (script copies real logs chunk by chunk), asserting: matches appear in real-time, persisted files are intact, index recovers after restart, rotation scenarios are correct; Windows packaged installer manually verified on user's Windows machine (user involvement).
- Fixtures: Use self-collected corpus (continuing the `GLADLOG_FIXTURES` convention).

## Packaging

electron-builder: Windows NSIS + macOS dmg (unsigned, unnotarized, for v1 personal use); artifact includes renderer static bundle + worker bundle. CI is not in the scope of this subproject (handled centrally before release).

## Compliance Boundaries (Execution Constraints)

- Implementer (agy/subagent) **must not read** the old fork's upstream source code (`packages/app/src/` (except for the following owned files), `packages/parser/src/`, etc.); especially the auto-generation mechanisms of `logsModule` / `logWatcher` / `nativeBridge` must not be read or referenced at all.
- **Permitted porting** (audited CLEAN, self-owned): `windows-agent/src/watcher.ts`, `state.ts`, `initialScan.ts`, `pipeline-app/src/detect.ts`, `pipeline-app` main/preload idioms, `app/src/nativeBridge/modules/settingsModule.ts`, and their accompanying tests.
- **Permitted logic extraction to a new home** (self-owned hunk): the user's own diff in files like `app/src/main.ts` (`git diff 7842b644 main -- <path>`), without carrying over the upstream file body.
- When ported files enter this repository, rearrange naming/structure according to this repository, do not keep old package paths.

## Design Decision Debate Record (agy debate ritual)

2026-07-10, Gemini 3.1 Pro (High), conversation `81ed737d`. Initial **OPPOSE** → **CONCEDE** after one round of replies ("The revised architecture is structurally sound, performant, and correctly scopes fault tolerance for a v1 release").

**Concession 1 (design changed)**: The original plan had TailReader in the main process, sending batches of lines via IPC to the worker — the opponent pointed out that structured clone serialization of hundreds of MBs of strings would freeze the main process event loop during the initial scan, perfectly reproducing the problem the plan aimed to avoid. Adopted their steelman: moving fs.watch + tail reading entirely into the worker, the main process only receives lightweight match/diagnostic/status events; additionally, the ack/backpressure protocol was deleted.

**Concession 2 (design changed)**: The original plan accepted "losing ongoing matches on restart" as a known limitation — the opponent considered it a trust breaker. Revision: checkpoint only advances at safe boundaries (no ongoing segments), restart replays from the boundary before the match, paired with matchId content hash idempotence, matches are no longer lost.

**Defense Successful (opponent retracted)**: The accusation of a "poison pill line crash loop" applied equally to their steelman (byte-level checkpoint resume reading would still ingest the poison pill line); line-skipping mechanism would be speculative engineering for a failure mode never observed in 386 million lines of zero-failure. Landed on proportionate mitigation: per-file quarantine (single file failure doesn't drag down the whole app) + crash site file+offset diagnostics.

## Unresolved Items

- Should the debug page show round-by-round details for shuffle (inclination: only show match level, leave round details for Subproject 3).
