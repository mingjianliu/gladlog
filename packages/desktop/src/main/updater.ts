/** Auto-update, Windows NSIS installs only (design doc:
 * docs/superpowers/specs/2026-08-02-auto-update-design.md).
 *
 * This module stays free of electron and of electron-updater: the real
 * autoUpdater and everything it needs (platform, packaged flag, install
 * directory listing) are injected, so the whole gate + state machine can be
 * tested under vitest without launching electron. Same reasoning as the header
 * of quitLifecycle.ts. */

import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
} from "../shared/updateSchedule";

/** How long quitAndInstall gets to actually take the process down before we
 *  declare the handover failed. Deliberately NOT exported: the test asserts
 *  against the literal 10_000, so silently stretching this window fails CI. */
const INSTALL_WATCHDOG_MS = 10_000;

export type UpdateState =
  | { phase: "disabled"; reason: "platform" | "dev" | "portable" }
  | { phase: "idle"; lastCheckedAt: number | null }
  | { phase: "checking" }
  | { phase: "downloading"; version: string; percent: number }
  | { phase: "ready"; version: string }
  | { phase: "error"; message: string };

export interface UpdaterEnv {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  /** dirname(process.execPath) */
  execDir: string;
  /** Lists file names under execDir; readdirSync in production, an array in tests. */
  readDir: (dir: string) => string[];
  /** Value of GLADLOG_UPDATER_TEST_FEED; undefined when unset. */
  testFeed: string | undefined;
}

type GateResult =
  | { ok: true; feed: { owner: string; repo: string } | null }
  | { ok: false; reason: "platform" | "dev" | "portable" };

/** "<owner>/<repo>" and nothing else. */
const TEST_FEED_PATTERN = /^[\w.-]+\/[\w.-]+$/;

/** NSIS drops "Uninstall <productName>.exe" next to the app executable
 * (app-builder-lib 26.15.3, templates/nsis/common.nsh:17 UNINSTALL_FILENAME,
 * written into $INSTDIR by templates/nsis/include/installer.nsh:100). A zip
 * portable extraction never has one, yet it reports app.isPackaged === true
 * and ships the same app-update.yml, so electron-updater cannot tell the two
 * apart on its own -- without this guard a portable user would get a second
 * copy installed under %LOCALAPPDATA%\Programs\gladlog.
 *
 * Matched as a pattern rather than the literal "Uninstall gladlog.exe":
 * renaming productName would silently break a hard-coded name, and the
 * failure direction ("looks portable, never updates") produces no error at
 * all. updater.uninstallerName.test.ts asserts this pattern still matches what
 * app-builder-lib's template produces. */
export const UNINSTALLER_PATTERN = /^Uninstall .+\.exe$/;

export function evaluateGate(env: UpdaterEnv): GateResult {
  // Order matters. The dev gate runs first so that a stale/typo'd
  // GLADLOG_UPDATER_TEST_FEED in a developer shell can never throw during an
  // unpackaged run -- E2E inherits process.env (qa/support/launch.ts:30) and
  // would otherwise die at startup with a confusing error.
  //
  // Note what this gate is NOT for (2026-08-03 verification round corrected
  // the spec here): it is not about preventing a throw. When unpackaged,
  // electron-updater already no-ops on its own -- isUpdaterActive()
  // (AppUpdater.js:277-283) logs one info line and returns false, so
  // checkForUpdates() just resolves null (AppUpdater.js:253-256) and never
  // touches app-update.yml. We short-circuit earlier only so the state
  // machine can report reason: "dev" instead of sitting in "idle".
  if (!env.isPackaged) return { ok: false, reason: "dev" };
  if (env.testFeed !== undefined) {
    // Same rule as e2eEnv.ts: set-but-invalid throws instead of falling back.
    // Falling back to the production feed would make the dummy-release test
    // look like it passed while verifying nothing.
    if (!TEST_FEED_PATTERN.test(env.testFeed)) {
      throw new Error(
        `GLADLOG_UPDATER_TEST_FEED 需要 <owner>/<repo> 形式,收到:${env.testFeed}`,
      );
    }
    const [owner, repo] = env.testFeed.split("/");
    return { ok: true, feed: { owner, repo } };
  }
  // mac is excluded on purpose: build/afterSign.cjs signs ad-hoc, and
  // Squirrel.Mac requires the update to match the running app's designated
  // requirement, which an ad-hoc identity can never satisfy.
  if (env.platform !== "win32") return { ok: false, reason: "platform" };
  let entries: string[];
  try {
    entries = env.readDir(env.execDir);
  } catch {
    // Unreadable install directory: fall to the safe side and do not update.
    return { ok: false, reason: "portable" };
  }
  if (!entries.some((name) => UNINSTALLER_PATTERN.test(name))) {
    return { ok: false, reason: "portable" };
  }
  return { ok: true, feed: null };
}

/** The slice of electron-updater's AppUpdater this module uses. Declared
 * structurally so tests can inject a fake; the real `autoUpdater` satisfies it
 * (checked by the assignment in main/index.ts). */
export interface UpdaterBackend {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  disableWebInstaller: boolean;
  setFeedURL(options: {
    provider: "github";
    owner: string;
    repo: string;
  }): void;
  on(event: "checking-for-update", listener: () => void): void;
  on(
    event: "update-not-available",
    listener: (info: { version: string }) => void,
  ): void;
  on(
    event: "update-available",
    listener: (info: { version: string }) => void,
  ): void;
  on(
    event: "download-progress",
    listener: (info: { percent: number }) => void,
  ): void;
  on(
    event: "update-downloaded",
    listener: (info: { version: string }) => void,
  ): void;
  on(event: "error", listener: (err: Error) => void): void;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

interface UpdaterDeps {
  autoUpdater: UpdaterBackend;
  env: UpdaterEnv;
  now: () => number;
  emit: (state: UpdateState) => void;
  /** quitLifecycle.shutdown */
  shutdown: () => Promise<void>;
  isAutoCheckEnabled: () => boolean;
}

export interface UpdaterService {
  getState(): UpdateState;
  /** Manual check: ignores isAutoCheckEnabled. */
  check(): Promise<void>;
  /** Scheduled check: returns immediately when isAutoCheckEnabled() is false. */
  autoCheck(): Promise<void>;
  install(): Promise<void>;
  /** Stops the timers; called by tests and from before-quit. */
  dispose(): void;
}

export function createUpdaterService(deps: UpdaterDeps): UpdaterService {
  const gate = evaluateGate(deps.env);

  if (!gate.ok) {
    // Nothing on deps.autoUpdater is read or written on this path -- not even a
    // property assignment. Keeps mac/dev/portable runs completely inert.
    const state: UpdateState = { phase: "disabled", reason: gate.reason };
    return {
      getState: () => state,
      check: () => Promise.resolve(),
      autoCheck: () => Promise.resolve(),
      install: () => Promise.resolve(),
      dispose: () => {},
    };
  }

  const backend = deps.autoUpdater;
  let state: UpdateState = { phase: "idle", lastCheckedAt: null };
  let lastCheckedAt: number | null = null;
  let pendingVersion = "";
  let installing = false;
  let installWatchdog: ReturnType<typeof setTimeout> | null = null;

  function setState(next: UpdateState): void {
    state = next;
    deps.emit(next);
  }

  backend.autoDownload = true;
  // Backstop: if the user never clicks "restart now", the update is installed
  // on the next normal quit. It hooks electron's "quit" event
  // (BaseUpdater.js:69-90 addQuitHandler, via ElectronAppAdapter.js:37-39
  // `this.app.once("quit", ...)`), which fires AFTER before-quit -- i.e. after
  // quitLifecycle's cleanup chain is already done. Note BaseUpdater.js:83-86:
  // a non-zero exit code skips the auto install, so this really is a backstop
  // and not a guarantee.
  backend.autoInstallOnAppQuit = true;
  // Unconditional on purpose: the constructor sets
  // allowPrerelease = hasPrereleaseComponents(currentVersion)
  // (AppUpdater.js:218), so a build like 0.1.15-obs.6 would otherwise start
  // out with prereleases allowed. The user's call is: stable versions only.
  backend.allowPrerelease = false;
  // We ship a one-piece NSIS installer, not a web installer. Without this,
  // NsisUpdater.js:44-46 logs a misleading warning on every download.
  backend.disableWebInstaller = true;
  if (gate.feed) {
    backend.setFeedURL({ provider: "github", ...gate.feed });
  }

  // Every listener is attached before the first checkForUpdates(), for two
  // independent reasons:
  //   1. "error" MUST exist before anything can fail: AppUpdater extends
  //      EventEmitter, and an EventEmitter with no "error" listener rethrows
  //      as an uncaught exception -- the exact opposite of §4.2's "never
  //      disturb the user" (spec §4.2 implementation constraint 1).
  //   2. With autoDownload = true the download starts inside
  //      checkForUpdates(), and electron-updater snapshots
  //      listenerCount("download-progress") once when the download begins
  //      (AppUpdater.js:567-568) -- a progress listener added later receives
  //      nothing at all, with no error.
  backend.on("checking-for-update", () => {
    lastCheckedAt = deps.now();
    setState({ phase: "checking" });
  });
  backend.on("update-not-available", () => {
    setState({ phase: "idle", lastCheckedAt });
  });
  backend.on("update-available", (info) => {
    pendingVersion = info.version;
    setState({ phase: "downloading", version: info.version, percent: 0 });
  });
  backend.on("download-progress", (info) => {
    const percent = Math.max(0, Math.min(100, Math.round(info.percent)));
    // Progress fires per chunk; only whole-percent changes are worth an IPC
    // push to the renderer.
    if (state.phase === "downloading" && state.percent === percent) return;
    setState({ phase: "downloading", version: pendingVersion, percent });
  });
  backend.on("update-downloaded", (info) => {
    setState({ phase: "ready", version: info.version });
  });
  // Errors never throw and never open a dialog: pulling ~110 MB from GitHub
  // fails routinely, and a failed update breaks no other feature.
  backend.on("error", (err) => {
    setState({ phase: "error", message: err.message });
  });

  async function runCheck(): Promise<void> {
    // checkForUpdates() reports a failure twice: it emits "error" AND returns a
    // rejected promise (AppUpdater.js:269-272). The state comes from the event;
    // this catch exists only so the rejection is not an unhandled one.
    try {
      await backend.checkForUpdates();
    } catch {
      // Already reflected in the state by the "error" listener above.
    }
  }

  async function autoCheck(): Promise<void> {
    if (!deps.isAutoCheckEnabled()) return;
    await runCheck();
  }

  // FIRST_CHECK_DELAY_MS / CHECK_INTERVAL_MS live in shared/updateSchedule.ts
  // (see its header): the settings page needs the same two numbers for its
  // "30s after launch, then every 4h" copy. The timers built from them here
  // are still owned entirely by this module -- dispose() is the only thing
  // that clears them; the wiring in main/index.ts must not build a second
  // pair.
  const firstCheckTimer = setTimeout(() => {
    void autoCheck();
  }, FIRST_CHECK_DELAY_MS);
  const pollTimer = setInterval(() => {
    void autoCheck();
  }, CHECK_INTERVAL_MS);

  async function install(): Promise<void> {
    if (state.phase !== "ready" || installing) return;
    installing = true;
    // One cleanup chain, two entry points. quitAndInstall() spawns the NSIS
    // installer detached and only then calls app.quit()
    // (BaseUpdater.js:13-27), so the OBS/worker/AI teardown has to be finished
    // BEFORE it runs -- otherwise the installer races a recording that is
    // still being closed. deps.shutdown is quitLifecycle.shutdown, the exact
    // chain before-quit uses; there is no second copy of that logic here.
    try {
      await deps.shutdown();
    } catch {
      // Best effort, same philosophy as quitLifecycle's own internal catches:
      // a failed teardown must not strand the user on an old build. The update
      // is downloaded and sha512-verified already -- go install it.
    }
    try {
      // isSilent = true, and only then is isForceRunAfter honoured
      // (BaseUpdater.js:16 falls back to autoRunAppAfterInstall otherwise).
      backend.quitAndInstall(true, true);
      // BaseUpdater.quitAndInstall (BaseUpdater.js:16-25) skips its own
      // app.quit() when install() returned false and returns void either way --
      // we cannot read that. So watch the clock: still breathing 10s later
      // means the installer never took over, and by now the recorder / worker /
      // AI children are already gone. Say so instead of leaving a silently
      // gutted app alive. Two deliberate non-actions: the `installing` latch is
      // NOT released (a retry could run two installers over one directory), and
      // we do NOT app.quit() from here (updater holds no quit dependency, and a
      // second exit path bypassing quitLifecycle is worse than a visible error).
      installWatchdog = setTimeout(() => {
        installWatchdog = null;
        setState({
          phase: "error",
          message: "更新安装器未能接管,请手动退出 gladlog 后重新打开",
        });
      }, INSTALL_WATCHDOG_MS);
    } catch (err) {
      setState({
        phase: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    // The "installer never took over" branch is handled by the install
    // watchdog armed right above: quitAndInstall returns void and
    // swallows a failed spawn (BaseUpdater.js:16-25 -- when install() returns
    // false it just resets quitAndInstallCalled and never calls app.quit()),
    // so there is nothing to catch here. We watch the clock instead and
    // surface an error state. We deliberately do NOT force a quit from this
    // module: that would need a quit dependency the service does not have,
    // and opening a second exit path around quitLifecycle is worse than a
    // visible error state.
  }

  return {
    getState: () => state,
    check: runCheck,
    autoCheck,
    install,
    dispose: () => {
      // The install watchdog is a live 10s timer; leaving it behind keeps a
      // vitest worker (and, in production, the process) awake after dispose.
      if (installWatchdog) clearTimeout(installWatchdog);
      installWatchdog = null;
      clearTimeout(firstCheckTimer);
      clearInterval(pollTimer);
    },
  };
}
