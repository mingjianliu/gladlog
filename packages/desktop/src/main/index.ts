import { app, BrowserWindow, safeStorage, screen } from "electron";
import log from "electron-log/main";
import { randomBytes } from "node:crypto";
import { dirname, join } from "path";
import type { WorkerConfig } from "../shared/protocol";
import type { LogsStatusSnapshot } from "../preload/api";
import {
  detectWowDirCandidates,
  realFsProbe,
  resolveLogsDir,
} from "./detectWowDir";
import { exportReportImage } from "./exportImage";
import { registerIpc } from "./ipc";
import { MatchStore } from "./matchStore";
import {
  SettingsStore,
  type GladlogSettings,
  type SettingsStoreWarning,
} from "./settingsStore";
import { WorkerHost } from "./workerHost";
import { createWorkerMessageHandler } from "./workerMessageHandler";
import { realClientFactory, stopAllAiActivity } from "./ai";
import { createIconCache } from "./iconCache";
import { createCompareService } from "./compare";
import { createAnalysisService } from "./analysis";
import { createCoachChatService } from "./coachChat";
import { createLearningService } from "./learning";
import {
  createRecorderService,
  isManagedActive,
  type RecorderService,
  type RecorderStatus,
} from "./recorder";
import { realObsClient } from "./obsClient";
import { RecordingsStore } from "./recordingsStore";
import { createQuitLifecycleHandler } from "./quitLifecycle";
import { handleVodProtocol, registerVodScheme } from "./vodProtocol";
import { loadWindowState, MIN_WINDOW, saveWindowState } from "./windowState";
import { loadBundledCorpus, gameBuildFromManifest } from "./corpusLoader";
import datagenManifest from "@gladlog/analysis/src/data/datagen-manifest.json";
import { e2eUserDataDir } from "./e2eEnv";
import { readdirSync } from "fs";
import { createObsAssets, type ObsInstallProgress } from "./obsAssets";
import { clearSentinels, writeObsConfig } from "./obsConfigWriter";
import { spawnManagedObs } from "./managedObsProcess";
import { createManagedObsBackend } from "./managedObsBackend";
import { createWowProcessWatch } from "./wowProcessWatch";
import {
  assembleManagedRecording,
  createManagedAssemblyState,
  createManagedRestartCoordinator,
  reactToManagedToggle,
  teardownManagedRecording,
} from "./managedAssembly";
import { resolveRecordingDir } from "../shared/managedObsPrefs";
import type { CaptureBackend } from "./captureBackend";
import {
  createUpdaterService,
  evaluateGate,
  type UpdaterEnv,
  type UpdaterService,
  type UpdateState,
} from "./updater";

app.setName("gladlog");
// The privileged vod:// scheme must be registered before app ready
registerVodScheme();
// E2E: must come before any app.getPath('userData') call (settings below is one)
const e2eDir = e2eUserDataDir(process.env);
if (e2eDir) app.setPath("userData", e2eDir);

log.initialize();
process.on("uncaughtException", (e) => log.error("[main] uncaught:", e));
process.on("unhandledRejection", (e) =>
  log.error("[main] unhandled rejection:", e),
);

let win: BrowserWindow | null = null;
let lastStatus: LogsStatusSnapshot | null = null;
let quitting = false;
const quarantined: string[] = [];

const userData = () => app.getPath("userData");
// #21 item7: encrypt secrets at rest — safeStorage is an electron-specific
// dependency, so it is injected rather than letting settingsStore.ts import
// "electron" directly (keeping it electron-free and unit-testable under plain node).
const onSettingsWarn = (w: SettingsStoreWarning) =>
  log.warn(`[settings] ${w.kind}${w.field ? `(${w.field})` : ""}: ${w.detail}`);
const settings = new SettingsStore(
  join(app.getPath("userData"), "settings.json"),
  safeStorage,
  onSettingsWarn,
);
let store: MatchStore;
let host: WorkerHost | null = null;
let recorder: RecorderService | null = null;

// Task-5b: mutable box recorder.ts's `managedBackend`/`managedProcessStop`
// deps read from on every access (getters below, never cached) -- lets the
// assembly layer (managedAssembly.ts) inject/clear them across repeated
// runtime toggles without recorder.ts needing to know assembly exists.
const managedRefs: {
  backend?: CaptureBackend;
  processStop?: () => Promise<void>;
} = {};
// Task-5b: the one piece of cross-call assembly state (handle/backend/watch/
// running) that survives app-lifetime settings toggles; see
// managedAssembly.ts's own doc comment.
const managedAssemblyState = createManagedAssemblyState();

/** The app-default recording directory. The EFFECTIVE directory is
 * `resolveRecordingDir(defaultRecordingsDir(), settings)` (managed-OBS prefs,
 * 2026-09-04) — computed through that one shared function at every consumer
 * (assembly → basic.ini RecFilePath + backend scan; RecordingsStore's
 * video-dir scan), never re-derived by hand. */
const defaultRecordingsDir = () => join(userData(), "recordings");

// C2 fix: on exit we must wait for recorder.stop() (StopRecord's async round
// trip) to finish before actually calling app.quit(), or OBS will very likely
// keep recording forever after the process dies. See the semantics comment in
// quitLifecycle.ts; here we only wire in the three electron-specific dependencies.
const quitLifecycle = createQuitLifecycleHandler({
  stopRecorder: () => recorder?.stop() ?? Promise.resolve(),
  stopHost: () => host?.stop(),
  // #21 item9: for completeness, also shut down in-flight AI analysis (CLI
  // subprocesses / DeepSeek fetches); not a pre-existing bug (they would die
  // naturally once the host exits anyway).
  stopAiActivity: () => stopAllAiActivity(),
  quit: () => app.quit(),
  // Task-5b exit sequence point 2: the deps object above is constructed once,
  // at module scope, well before whenReady decides which mode is active --
  // a static number could never reflect that. Managed teardown stacks
  // stopContinuous + backend.shutdown + the OBS process's own graceful
  // stop()/GRACE_STOP_MS, so it needs more headroom (8s) than bypass's plain
  // StopRecord/disconnect round trip (4s, the existing default).
  //
  // 复核 I5 (review round 2, shared-predicate rule): this used to read
  // `isManagedActive(settings.get())`, but recorder.stop()'s managed branch
  // is gated on `deps.managedBackend` presence ALONE (deliberately, so a
  // settings flicker right before quit still tears down a live process --
  // see that branch's own comment). Those two predicates can disagree: a
  // settings flicker between "still managed" and "no longer managed" while
  // a managedBackend is still injected would make this getter pick the 4s
  // bypass cap while stop() still runs the (longer) managed teardown --
  // `app.quit()` could then fire mid-StopRecord, and will-quit's killSync
  // would kill OBS with the tail mp4 unfinalized. Reading `managedRefs.backend`
  // directly is the SAME fact `deps.managedBackend` resolves to (via the
  // getter below), not a second, independently-derived approximation of it.
  timeoutMs: () => (managedRefs.backend ? 8000 : 4000),
});
app.on("before-quit", (event) => quitLifecycle.onBeforeQuit(event));
// Task-5b exit sequence point 3: will-quit and process.on("exit") are the
// last-resort SYNCHRONOUS fallback if the graceful before-quit chain above
// never ran to completion (e.g. the process is being torn down by the OS
// rather than a normal app.quit()) -- handle.killSync() only, no async work,
// matching managedObsProcess.ts's own killSync() contract.
app.on("will-quit", () => managedAssemblyState.handle?.killSync());
process.on("exit", () => managedAssemblyState.handle?.killSync());

// managedAssets.installed()/ensureInstalled() need only userDataDir --
// app.getPath("userData") is already called at module scope above (the
// SettingsStore construction), so this is equally safe pre-whenReady.
const managedAssets = createObsAssets({ userDataDir: userData() });

/** Task-5b brief step 2: `settings.managedWsPassword ?? generate 32 hex
 * random → save`. Task 6 landed `managedWsPassword` as a real (secret,
 * three-piece-protected) `GladlogSettings` field, so this reads/writes it
 * directly -- no more structural cast. */
function resolveManagedWsPassword(): string {
  const s = settings.get();
  if (s.managedWsPassword) return s.managedWsPassword;
  const generated = randomBytes(16).toString("hex"); // 32 hex chars
  settings.save({ managedWsPassword: generated });
  return generated;
}

/** Runs (or no-ops if already running / not managed-active) the task-5b
 * startup sequence. Called once at app launch and again on every
 * false→true runtime settings toggle (复核 NEW-3) and after a successful
 * install — assembleManagedRecording itself re-checks isManagedActive() and
 * state.running, so calling this liberally is always safe. */
async function ensureManagedAssembly(): Promise<void> {
  await assembleManagedRecording({
    state: managedAssemblyState,
    getSettings: () => settings.get(),
    getWsPassword: resolveManagedWsPassword,
    defaultRecDir: defaultRecordingsDir(),
    assets: managedAssets,
    writeObsConfig,
    clearSentinels,
    spawnManagedObs,
    createManagedObsBackend,
    createWowProcessWatch,
    setRecorderManagedBackend: (b) => {
      managedRefs.backend = b ?? undefined;
    },
    setRecorderManagedProcessStop: (fn) => {
      managedRefs.processStop = fn ?? undefined;
    },
    onWowUp: () => recorder?.onWowUp(),
    onWowDown: () => recorder?.onWowDown(),
    emitStatus: (status) =>
      win?.webContents.send("gladlog:recorder:status", status),
  });
}

/** true→false runtime settings toggle counterpart (复核 NEW-3). No-ops if
 * assembly was never running. */
async function ensureManagedTeardown(): Promise<void> {
  await teardownManagedRecording({
    state: managedAssemblyState,
    stopRecorder: () => recorder?.stop() ?? Promise.resolve(),
    setRecorderManagedBackend: (b) => {
      managedRefs.backend = b ?? undefined;
    },
    setRecorderManagedProcessStop: (fn) => {
      managedRefs.processStop = fn ?? undefined;
    },
    recordingEnabled: settings.get().recordingEnabled,
    emitStatus: (status) =>
      win?.webContents.send("gladlog:recorder:status", status),
  });
}

/** IPC surface (recorder:installObs): the renderer's "下载并启用" action is
 * the ONLY thing that ever calls assets.ensureInstalled() -- task-5b
 * user-approved deviation, 179MB must be a visible user action, never a
 * silent background download. Re-runs the same runtime-toggle assembly path
 * on success so recording starts without an app restart. */
async function installObs(
  onProgress: (p: ObsInstallProgress) => void,
): Promise<void> {
  await managedAssets.ensureInstalled(onProgress);
  await ensureManagedAssembly();
}

/** 复核 I4 (review round 2): "not installed" only ever got announced via a
 * one-shot `emitStatus` push at whatever moment `ensureManagedAssembly()`
 * happened to run (app launch, before the renderer's status subscription
 * even mounts) -- a managed-enabled + OBS-not-installed + fresh-launch user
 * would see 未启用/未连接 forever, never 待安装, since the durable
 * `recorder:getStatus` query (which the settings row DOES call on mount)
 * knows nothing about install state at all. This is a synchronous,
 * pollable fact (unlike recording status, no in-flight session to
 * describe), so it gets its own tiny durable query rather than trying to
 * retrofit it into RecorderStatus's push-only shape. Renders it is Task 6's
 * job; this is the data plumbing Task 6 needs.
 *
 * `platformSupported` (task-6 addition, NEW-7): managed recording is
 * win32-only (isManagedActive's third term) -- the settings page needs this
 * to render the managed radio disabled-with-explanation on mac/linux rather
 * than re-deriving `process.platform === "win32"` itself in the renderer
 * (which has no direct access to `process.platform` in the first place). */
function getObsInstallState(): {
  installed: boolean;
  platformSupported: boolean;
} {
  return {
    installed: managedAssets.installed(),
    platformSupported: process.platform === "win32",
  };
}

/** settings:save hook (复核 NEW-3): compares isManagedActive() before/after
 * the save and runs assembly or teardown accordingly, so a managed toggle
 * takes effect immediately instead of needing an app restart.
 *
 * Task 8 review fix: delegates the actual await-or-not decision to
 * `reactToManagedToggle` (managedAssembly.ts) -- the false→true (enable)
 * branch is fire-and-forget (matches startup's `void ensureManagedAssembly()`
 * below), so this settings:save hook -- and therefore the IPC reply -- no
 * longer blocks on the full assembly sequence's ~30s readiness timeout. The
 * true→false (disable) branch stays awaited; see that function's doc comment
 * for the full rationale. */
async function onManagedActiveMaybeChanged(
  prev: GladlogSettings,
  next: GladlogSettings,
): Promise<void> {
  const before = isManagedActive(prev);
  const after = isManagedActive(next);
  // Managed-OBS prefs (2026-09-04): a directory/audio-device change while
  // managed stays active restarts the instance (deferred past a recording
  // in progress). Ordered BEFORE the toggle: a disable must cancel a
  // deferred restart before the teardown's own recording=false status push
  // reaches the coordinator (agy review #3).
  await managedRestart.onSettingsSaved(prev, next);
  await reactToManagedToggle(before, after, {
    assemble: ensureManagedAssembly,
    teardown: ensureManagedTeardown,
  });
}

/** Restart-on-prefs-change coordinator. Fed every recorder status push
 * (see the `emit` wrapper at createRecorderService below) so a restart
 * deferred by an in-progress recording fires the moment recording ends. */
const managedRestart = createManagedRestartCoordinator({
  isRecording: () => recorder?.getStatus().recording ?? false,
  teardown: ensureManagedTeardown,
  assemble: ensureManagedAssembly,
});

// Auto-update wiring (design doc §4.2/§4.4). The gate is evaluated
// synchronously right here so getState() can answer correctly from the very
// first IPC call, but electron-updater itself is imported only after the gate
// passes: it pulls in js-yaml + fs-extra + semver + lodash on EVERY start
// otherwise, and cold start is budgeted at 2600ms (qa/budgets.ts:44).
const updaterEnv: UpdaterEnv = {
  platform: process.platform,
  isPackaged: app.isPackaged,
  execDir: dirname(process.execPath),
  readDir: (dir) => readdirSync(dir),
  // Passed straight through, with no GLADLOG_E2E special-casing: evaluateGate
  // checks `!isPackaged → dev` BEFORE it validates the test feed, so a dev or
  // E2E run can never throw on a stale value left in a developer's shell.
  // Zeroing it out under E2E would instead break §6.2 — the dummy-release
  // client is a PACKAGED build launched with both GLADLOG_E2E=1 (userData
  // isolation) and GLADLOG_UPDATER_TEST_FEED.
  testFeed: process.env["GLADLOG_UPDATER_TEST_FEED"],
};
// The same predicate on both sides: evaluateGate is exported precisely so this
// call site cannot drift from the one inside createUpdaterService (CLAUDE.md —
// one predicate, two importers).
//
// Settling an open question from an earlier handoff note ("make sure this
// can't become an uncaught startup crash"): when packaged and
// GLADLOG_UPDATER_TEST_FEED is set but malformed, evaluateGate throws
// synchronously (see its own comment: "set-but-invalid throws instead of
// falling back"), and nothing here catches it -- Electron shows its default
// uncaught-exception dialog and the app fails to start. That IS the intended
// behavior, per spec §4.2.1 "throw, don't silently fall back": a bad test
// feed must never look like a passing dummy-release verification. This path
// can only be hit by a malformed GLADLOG_UPDATER_TEST_FEED on a packaged
// build (an internal test knob), never by an ordinary user, so a loud startup
// failure is the correct trade-off, not a bug to fix.
const updaterGate = evaluateGate(updaterEnv);
let updaterService: UpdaterService | null = null;

function pushUpdateState(state: UpdateState): void {
  win?.webContents.send("gladlog:update:state", state);
}

/** IPC-facing facade: valid before initUpdater() has finished loading
 *  electron-updater, and delegating forever after. */
const updaterFacade = {
  getState: (): UpdateState =>
    updaterService?.getState() ??
    (updaterGate.ok
      ? { phase: "idle", lastCheckedAt: null }
      : { phase: "disabled", reason: updaterGate.reason }),
  check: async (): Promise<void> => {
    await updaterService?.check();
  },
  install: async (): Promise<void> => {
    await updaterService?.install();
  },
};

async function initUpdater(): Promise<void> {
  if (!updaterGate.ok) {
    log.info(`[updater] disabled: ${updaterGate.reason}`);
    pushUpdateState(updaterFacade.getState());
    return;
  }
  // electron-updater is CommonJS and exposes `autoUpdater` as an
  // Object.defineProperty getter, which cjs-module-lexer does NOT detect:
  // under node ESM `(await import("electron-updater")).autoUpdater` is
  // undefined (verified 2026-08-02 — the namespace keys are AppUpdater,
  // NsisUpdater, …, default). The value has to be read off module.exports,
  // which node exposes as `default`.
  const mod = await import("electron-updater");
  const autoUpdater = (mod as unknown as { default: typeof mod }).default
    .autoUpdater;
  // §4.2: route electron-updater's own logs into electron-log. Without this
  // the AppUpdater keeps its default `console` logger (AppUpdater.js:179) and
  // the "Checking for update" / "Found version X" lines never reach
  // ~/Library/Logs/gladlog/main.log — the evidence channel the §6.2
  // dummy-release verification reads. `log` is already imported at :2.
  autoUpdater.logger = log;
  updaterService = createUpdaterService({
    autoUpdater,
    env: updaterEnv,
    now: () => Date.now(),
    emit: pushUpdateState,
    // §4.3: exactly one cleanup chain — install() awaits this before the NSIS
    // installer is spawned.
    shutdown: () => quitLifecycle.shutdown(),
    isAutoCheckEnabled: () => settings.get().autoCheckUpdates,
  });
  log.info(
    `[updater] armed${
      updaterGate.feed
        ? ` (test feed ${updaterGate.feed.owner}/${updaterGate.feed.repo})`
        : ""
    }`,
  );
  // The first check and the periodic poll are started by createUpdaterService
  // itself, from the single schedule owned by shared/updateSchedule.ts. Do
  // NOT add timers here: a second set would double every check and fork the
  // schedule into two literals that drift silently.
  pushUpdateState(updaterService.getState());
}

// A second before-quit listener rather than a new quitLifecycle dependency:
// its dependency shape is fixed, and preventDefault from the first listener
// does not stop the remaining ones from running. dispose() stops the service's
// own scheduled timers (without it, the periodic poll keeps the process alive)
// and cancels any armed install watchdog — on the success path the process is
// going away anyway; the failure path (BaseUpdater.install() returned false,
// so quitAndInstall never called app.quit()) never reaches before-quit at
// all, which is exactly why the watchdog still fires there.
app.on("before-quit", () => {
  updaterService?.dispose();
  quitting = true; // 让 sidecar 回填在两场之间收手
});

function createWindow(): BrowserWindow {
  // UI redesign 2026-08-01: the two-column layout only kicks in at ≥1440px, so
  // the old 1200 default could never show it — the default is raised to
  // 1600×1000 (clamped to the work area on small screens) and the last bounds
  // are remembered.
  const statePath = join(userData(), "window-state.json");
  const saved = loadWindowState(statePath);
  const work = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(saved?.width ?? 1600, work.width);
  const height = Math.min(saved?.height ?? 1000, work.height);
  // The saved position must leave a minimum visible area on some display (agy
  // review #4: checking only the top-left corner meant a window flush against
  // the right screen edge could restore with just a few draggable pixels left,
  // effectively invisible) — the intersection with some work area must be
  // ≥ 200×100; otherwise drop the position and let the OS place the window.
  const posValid =
    saved?.x !== undefined &&
    saved?.y !== undefined &&
    screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      const visW =
        Math.min(saved.x! + width, a.x + a.width) - Math.max(saved.x!, a.x);
      const visH =
        Math.min(saved.y! + height, a.y + a.height) - Math.max(saved.y!, a.y);
      return visW >= 200 && visH >= 100;
    });
  const w = new BrowserWindow({
    width,
    height,
    ...(posValid ? { x: saved!.x, y: saved!.y } : {}),
    minWidth: MIN_WINDOW.width,
    minHeight: MIN_WINDOW.height,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (saved?.maximized) w.maximize();
  // getNormalBounds is still reliable at close time (it is not after destroy);
  // when maximized we store the restored size plus the maximized flag, so next
  // launch opens maximized with the correct restored size.
  w.on("close", () => {
    const b = w.getNormalBounds();
    saveWindowState(statePath, {
      width: b.width,
      height: b.height,
      x: b.x,
      y: b.y,
      maximized: w.isMaximized(),
    });
  });
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  if (process.env["ELECTRON_RENDERER_URL"])
    w.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  else w.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  return w;
}

function workerConfig(wowDirectory: string): WorkerConfig {
  return {
    logsDir: resolveLogsDir(wowDirectory),
    checkpointsPath: join(userData(), "checkpoints.json"),
    quarantined,
    flushIntervalMs: 2000,
    quietPeriodMs: 5000,
  };
}

// The message routing itself lives in workerMessageHandler.ts (pure and
// testable); here we only wire in electron-specific dependencies (store /
// recorder / win are module-level `let`s captured by closure at handler
// construction, and calls only happen after whenReady has assigned them all —
// equivalent to the old direct closure references).
const onWorkerMessage = createWorkerMessageHandler({
  store: { store: (item) => store.store(item) },
  recorder: {
    associate: (m) => recorder?.associate(m),
    onSegmentOpen: (o) => recorder?.onSegmentOpen(o),
    onSegmentClose: (o) => recorder?.onSegmentClose(o),
  },
  emit: (ch, payload) => win?.webContents.send(ch, payload),
  setStatus: (s) => {
    lastStatus = s;
  },
  logWarn: (m) => log.warn(m),
});

function startMonitoring(s: GladlogSettings): void {
  let dir = s.wowDirectory;
  if (!dir) {
    dir =
      detectWowDirCandidates({
        platform: process.platform,
        probe: realFsProbe(),
      })[0] ?? null;
    if (dir) settings.save({ wowDirectory: dir });
  }
  if (!dir) return; // wait for the user to pick one manually
  const config = workerConfig(dir);
  if (host) host.reconfigure(config);
  else {
    host = new WorkerHost({
      workerModulePath: join(import.meta.dirname, "worker.js"),
      onMessage: onWorkerMessage,
      onQuarantine: (fileKey) => {
        quarantined.push(fileKey);
        log.error(`quarantined ${fileKey}`);
      },
      log: { info: (m) => log.info(m), error: (m) => log.error(m) },
    });
    host.start(config);
  }
}

const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  app.whenReady().then(() => {
    store = new MatchStore(join(userData(), "matches"));
    const initialMetas = store.init();
    win = createWindow();
    // perf-2 startup warm-up: the most recent match is the likeliest first
    // click — ensure its per-round sidecar exists and its pages are warm.
    // Delayed so it never competes with window startup IO.
    setTimeout(() => {
      const latest = initialMetas.reduce(
        (a, b) => (b.startTime > (a?.startTime ?? -Infinity) ? b : a),
        null as (typeof initialMetas)[number] | null,
      );
      if (latest) void store?.prefetch(latest.id);
    }, 3000);
    // perf-1 sidecar backfill: one worker at a time over shuffles that lack a
    // valid rounds.idx.json (one-time per library; later startups stat-check
    // and skip in milliseconds). Starts after the warm-up window, stops at
    // quit between matches.
    setTimeout(() => {
      void store
        ?.backfillRoundsIdx(() => quitting)
        .then((r) => {
          if (r.built > 0)
            log.info(`[roundsIdx] backfilled ${r.built} sidecars`);
        });
    }, 10_000);
    // SP-B2.1: the userData override path takes priority over the bundled corpus
    // — shipping a new reference_vectors.json needs no new installer, just drop
    // the file into the user data directory and restart the app. If the override
    // file is missing, corrupt, or the wrong shape, it transparently falls back
    // to the bundled version (see corpusLoader.loadBundledCorpus).
    const corpusPaths = () => [
      join(userData(), "reference_vectors.json"),
      app.isPackaged
        ? join(process.resourcesPath, "reference_vectors.json")
        : join(
            import.meta.dirname,
            "../../../corpus-tools/data/reference_vectors.json",
          ),
    ];

    const compare = createCompareService({
      getSettings: () => settings.get(),
      matchesDir: join(userData(), "matches"),
      loadCorpus: loadBundledCorpus(
        corpusPaths,
        (info) =>
          log.info(
            `[corpus] loaded ${info.path} (wowPatchVersion=${info.wowPatchVersion}, builtAt=${info.builtAt})`,
          ),
        (info) => log.warn(`[corpus] skipped ${info.path}: ${info.reason}`),
      ),
      gameBuild: () =>
        gameBuildFromManifest(datagenManifest as { build?: string }),
      emit: (ch, payload) => win?.webContents.send(ch, payload),
    });
    const learning = createLearningService({
      getSettings: () => settings.get(),
      matchesDir: join(userData(), "matches"),
      learningDir: join(userData(), "learning"),
      clientFactory: realClientFactory,
      emit: (ch, payload) => win?.webContents.send(ch, payload),
    });
    const analysis = createAnalysisService({
      getSettings: () => settings.get(),
      matchesDir: join(userData(), "matches"),
      clientFactory: realClientFactory,
      emit: (ch, payload) => win?.webContents.send(ch, payload),
      onFindings: (e) => learning.recordAnalysis(e),
    });
    const coachChat = createCoachChatService({
      getSettings: () => settings.get(),
      matchesDir: join(userData(), "matches"),
    });
    const icons = createIconCache({
      cacheDir: join(app.getPath("userData"), "icons"),
      // No network under E2E (visual regression): see iconCache's offline comment.
      offline: process.env["GLADLOG_E2E"] === "1",
    });
    const recordings = new RecordingsStore(
      defaultRecordingsDir(), // the index always lives here
      (m) => log.info(m),
      () => resolveRecordingDir(defaultRecordingsDir(), settings.get()),
    );
    recorder = createRecorderService({
      getSettings: () => settings.get(),
      recordings,
      clientFactory: realObsClient,
      emit: (ch, payload) => {
        if (ch === "gladlog:recorder:status")
          managedRestart.onRecorderStatus(payload as RecorderStatus);
        win?.webContents.send(ch, payload);
      },
      // Task-5b: read fresh from managedRefs on every access (never cached)
      // -- the assembly layer mutates managedRefs across repeated runtime
      // toggles, and recorder.ts's own doc comment on this field already
      // documents that every read is a live property access, never a
      // captured local, so a getter here is exactly what it expects.
      get managedBackend() {
        return managedRefs.backend;
      },
      get managedProcessStop() {
        return managedRefs.processStop;
      },
    });
    recorder.pruneNow();
    // Review Important #2: connect once at startup so a healthy setup does
    // not show "未连接" until the first match opens. Fire-and-forget -- it
    // never throws (degrades to lastError + pushStatus internally) and window
    // creation must not wait on OBS being reachable.
    void recorder.connectAtStartup();
    // Task-5b startup sequence: gated end-to-end by isManagedActive() inside
    // assembleManagedRecording itself -- on non-win32/external/disabled this
    // is a zero-cost no-op (no downloads, no spawns, no timers; this is what
    // the ubuntu E2E suite enforces by running the real main process).
    void ensureManagedAssembly();
    handleVodProtocol((p) => recordings.list().some((r) => r.videoPath === p));
    registerIpc({
      recorder,
      updater: updaterFacade,
      store,
      settings,
      getStatus: () => lastStatus,
      getWindow: () => win,
      onWowDirectoryChanged: (s) => startMonitoring(s),
      onSettingsSaved: (prev, next) => onManagedActiveMaybeChanged(prev, next),
      installObs,
      getObsInstallState,
      listAudioDevices: () =>
        managedAssemblyState.backend?.listAudioDevices() ??
        Promise.resolve({ output: [], input: [] }),
      compare,
      analysis,
      learning,
      chat: coachChat,
      icons,
      exportImage: (opts) =>
        exportReportImage({
          ...opts,
          parent: win,
          preloadPath: join(import.meta.dirname, "../preload/index.cjs"),
          rendererUrl: process.env["ELECTRON_RENDERER_URL"] ?? null,
          rendererFile: join(import.meta.dirname, "../renderer/index.html"),
        }),
    });
    // Must come after registerIpc: pushUpdateState writes to win.webContents,
    // and win is created above in this same block.
    void initUpdater().catch((e) => log.error("[updater] init failed:", e));
    learning.init();
    startMonitoring(settings.get());
  });
  app.on("window-all-closed", () => {
    // Recording and worker teardown are handled uniformly by the before-quit
    // hook above (quitLifecycle) — app.quit() triggers it and only exits once
    // recorder.stop() has actually finished (with a capped timeout).
    app.quit();
  });
}
