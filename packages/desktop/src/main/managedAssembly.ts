import { MANAGED_WS_PORT } from "../shared/obsAsset";
import {
  managedObsPrefsChanged,
  type ManagedObsPrefs,
  resolveRecordingDir,
} from "../shared/managedObsPrefs";
import type { ObsAssets } from "./obsAssets";
import type { ObsConfigSpec } from "./obsConfigWriter";
import type {
  ManagedObsHandle,
  SpawnManagedObsSpec,
} from "./managedObsProcess";
import type {
  ManagedObsBackend,
  ManagedObsBackendDeps,
} from "./managedObsBackend";
import type { CaptureBackend } from "./captureBackend";
import { isManagedActive, type RecorderStatus } from "./recorder";

/**
 * Task-5b 装配层(main/index.ts 启动/退出序列的可测核心)。The brief's 7-step
 * startup sequence lives in `assembleManagedRecording` below; this module is
 * pure Node (no `electron` import) so it can be unit tested with fakes for
 * every dependency, exactly like recorder.ts/managedObsBackend.ts before it.
 *
 * `ManagedAssemblyState` is the one piece of mutable, cross-call memory this
 * module needs: index.ts owns a single instance for the app's lifetime, so
 * repeated calls (runtime settings toggle, install-then-retry) can be
 * idempotent/re-entry-safe (复核 NEW-3 — "装了就自动录" must not need an app
 * restart) without resorting to module-scope globals inside this file.
 */
export interface ManagedAssemblyState {
  running: boolean;
  handle: ManagedObsHandle | null;
  backend: ManagedObsBackend | null;
  watch: { start(): void; stop(): void } | null;
  /** 复核 C2 (review round 2): assembleManagedRecording and
   * teardownManagedRecording are each individually guarded against a second
   * call to THEMSELVES (`running`), but were NOT reentrancy-safe against
   * EACH OTHER. Two concrete traces the reviewer caught: (a) a disable
   * arriving while a PRIOR disable's `stopRecorder()` is still awaiting a
   * slow/unresponsive OBS -- the re-enable's assemble saw `running` still
   * true (the in-flight teardown hadn't cleared it yet) and no-op'd, then
   * the in-flight teardown finished and unconditionally set `running =
   * false` -- net effect: managed silently OFF for the rest of the session
   * despite the user's last action being "enable", no error anywhere. (b) a
   * disable arriving while assembly is still mid-`configureSession` (before
   * `state.watch` is even assigned) -- teardown saw `state.watch === null`,
   * killed the process anyway, and the STILL-RUNNING assembly then finished
   * its OWN sequence afterward and started a wowProcessWatch nobody holds a
   * reference to -- a 2s tasklist poll loop leaking until app exit,
   * violating "disabled = zero timers" (task-5b brief 8).
   *
   * Fix: both exported functions below serialize on this single promise
   * chain instead of relying on independent, racing guards. A toggle that
   * arrives mid-flight is DELAYED until the in-flight operation has
   * genuinely finished -- never dropped, never interleaved -- mirroring
   * recorder.ts's own `run`/`runManaged` serialized chains for the exact
   * same reason (a hung backend call must not let two operations touch
   * shared state concurrently). Each queued function still reads
   * `deps.getSettings()`/`deps.state` FRESH once it actually runs (not at
   * enqueue time), so a rapid disable→enable→disable settles on whatever
   * the LAST queued operation's own logic decides -- correct, if not
   * maximally efficient (an enable sandwiched between two disables does
   * real work only to be torn down again; correctness over cost here). */
  chain: Promise<void>;
}

/** What assembly reads from settings: the mode gate's two fields plus the
 * three managed-OBS prefs. index.ts passes the full GladlogSettings; tests
 * build the minimal shape. */
export type AssemblySettings = Parameters<typeof isManagedActive>[0] &
  ManagedObsPrefs;

export function createManagedAssemblyState(): ManagedAssemblyState {
  return {
    running: false,
    handle: null,
    backend: null,
    watch: null,
    chain: Promise.resolve(),
  };
}

/** Runs `fn` after every previously-queued operation on this state has
 * settled (success OR failure -- `fn` still runs even if the prior link
 * rejected, and this function's own returned promise reflects `fn`'s own
 * outcome, not swallowed). See `ManagedAssemblyState.chain`'s doc comment. */
function serialize(
  state: ManagedAssemblyState,
  fn: () => Promise<void>,
): Promise<void> {
  const run = state.chain.then(fn, fn);
  // Keep the chain alive regardless of whether `run` rejects -- a single
  // failed operation must not permanently wedge every future toggle behind
  // a dead promise.
  state.chain = run.then(
    () => {},
    () => {},
  );
  return run;
}

export interface AssembleManagedRecordingDeps {
  state: ManagedAssemblyState;
  /** Same settings shape isManagedActive() itself takes — the mode gate
   * (brief step 1) is done INSIDE this function via that shared predicate,
   * never hand-copied (CLAUDE.md shared-predicate rule) — plus the three
   * managed-OBS prefs (2026-09-04), read fresh at assembly time so a restart
   * after a prefs change picks up the new directory/devices. */
  getSettings: () => AssemblySettings;
  /** Brief step 2 (password provisioning: `settings.managedWsPassword ??
   * generate 32 hex random → save`) is deliberately NOT done in here — it
   * needs `settings.save` (a persistence side effect this module has no
   * business owning) and Task 6 hasn't landed the field yet. index.ts
   * resolves-or-generates-and-persists and hands the result through this
   * getter, called at the correct point in the sequence (after the
   * installed-check, before writeObsConfig) but not before the mode gate —
   * see the `④ managedActive=false → 全程零调用` test. */
  getWsPassword: () => string;
  /** The app-default recording directory (userData/recordings). The
   * EFFECTIVE directory is `resolveRecordingDir(defaultRecDir, settings)` —
   * the user's `recordingDirectory` pref when set — computed once per
   * assembly and handed to BOTH the config writer (basic.ini RecFilePath)
   * and the backend (its first-chunk fallback scan), so they can never
   * disagree. */
  defaultRecDir: string;
  assets: Pick<ObsAssets, "root" | "installed">;
  writeObsConfig: (spec: ObsConfigSpec) => void;
  clearSentinels: (obsRoot: string) => void;
  spawnManagedObs: (spec: SpawnManagedObsSpec) => ManagedObsHandle;
  createManagedObsBackend: (deps: ManagedObsBackendDeps) => ManagedObsBackend;
  createWowProcessWatch: (deps: { onUp: () => void; onDown: () => void }) => {
    start(): void;
    stop(): void;
  };
  /** Wires the freshly-built backend into the recorder. recorder.ts reads
   * `deps.managedBackend` fresh on every access (never caches it in a local
   * variable), so mutating the SAME deps object createRecorderService closed
   * over is visible immediately — index.ts implements this by holding a
   * named reference to that object and assigning `.managedBackend` on it. */
  setRecorderManagedBackend: (b: CaptureBackend | null) => void;
  /** Same mutation trick, for recorder.stop()'s managed exit sequence (task-
   * 5b point 1: backend.shutdown() → handle.stop()). */
  setRecorderManagedProcessStop: (fn: (() => Promise<void>) | null) => void;
  onWowUp: () => void;
  onWowDown: () => void;
  /** Pushes a RecorderStatus-shaped snapshot on the SAME channel
   * recorder.ts's own pushStatus uses (gladlog:recorder:status) — no new IPC
   * surface needed for the settings-page status row to see "待安装" / an
   * assembly-time error. Bypasses recorder.getStatus() on purpose: "not
   * installed" is state this module owns, not recorder.ts's. */
  emitStatus: (status: RecorderStatus) => void;
}

function errStatus(enabled: boolean, e: unknown): RecorderStatus {
  return {
    enabled,
    connected: false,
    recording: false,
    lastError: String(e),
    sourceActive: null,
  };
}

/**
 * Task-5b brief's 7-step startup sequence (steps 1/3-7; step 2 is delegated,
 * see `getWsPassword`'s doc comment). Idempotent/re-entry-safe: the
 * `state.running` guard is set synchronously, before the first `await`, so
 * two back-to-back calls (e.g. a rapid settings:save while the first
 * assembly is still mid-flight) can never spawn a second OBS process or
 * start a second watch.
 *
 * Assembly-order invariant (task-5's note to 5b, recorder.ts's own comment
 * ~line 499): `backend.configureSession()` MUST complete — success OR
 * failure — before the watch starts. `probe().ready` is `connected &&
 * sessionConfigured`, and `startContinuous()` never calls configureSession
 * itself; if the watch fired `onWowUp` first, `health.ready` would stay
 * false forever and the bounded retry loop would spin with no way to tell
 * "assembly forgot a step" apart from "OBS genuinely isn't ready yet".
 */
export function assembleManagedRecording(
  deps: AssembleManagedRecordingDeps,
): Promise<void> {
  return serialize(deps.state, () => doAssemble(deps));
}

async function doAssemble(deps: AssembleManagedRecordingDeps): Promise<void> {
  const s = deps.getSettings();
  // Step 1 + the `④ managedActive=false → 全程零调用` test: this must be the
  // very first thing checked, before even `assets.installed()`, so a
  // non-managed call touches zero dependencies.
  if (!isManagedActive(s)) return;
  if (deps.state.running) return; // idempotent re-entry guard (复核 NEW-3)

  // Step 3: download is NOT automatic (user-approved deviation from the
  // design doc's "首次运行下载" — 179MB must be a visible user action, not a
  // silent background one). Report 待安装 and stop; only the renderer's
  // "下载并启用" action (recorder:installObs IPC → assets.ensureInstalled)
  // ever downloads, and it re-runs this same function on success.
  if (!deps.assets.installed()) {
    deps.emitStatus({
      enabled: s.recordingEnabled,
      connected: false,
      recording: false,
      lastError: "OBS 未安装 —— 请在设置页点击「下载并启用」",
      sourceActive: null,
    });
    return;
  }

  deps.state.running = true; // before ANY await — see the re-entry-safety doc comment above

  let handle: ManagedObsHandle;
  const recDir = resolveRecordingDir(deps.defaultRecDir, s);
  try {
    const wsPassword = deps.getWsPassword();
    // Step 4
    deps.writeObsConfig({
      obsRoot: deps.assets.root,
      recDir,
      wsPort: MANAGED_WS_PORT,
      wsPassword,
      bitrateKbps: 8000,
      desktopAudioDeviceId: s.managedDesktopAudioDevice,
      micDeviceId: s.managedMicDevice,
    });
    deps.clearSentinels(deps.assets.root);
    handle = deps.spawnManagedObs({
      obsRoot: deps.assets.root,
      wsPort: MANAGED_WS_PORT,
    });
    deps.state.handle = handle;
    deps.setRecorderManagedProcessStop(() => handle.stop());

    // Step 5
    const backend = deps.createManagedObsBackend({
      ensureProcess: async () => {
        const ready = await handle.ready;
        return { wsUrl: ready.wsUrl, wsPassword };
      },
      recDir,
      // Same settings snapshot the config writer just consumed — the backend
      // re-checks at runtime that OBS actually came up with these channels
      // wired and repairs them if not (ensureAudioWired). Passing them from
      // here rather than re-reading settings keeps writer and backend on one
      // snapshot, so a save landing mid-assembly cannot split them.
      desktopAudioDeviceId: s.managedDesktopAudioDevice,
      micDeviceId: s.managedMicDevice,
    });
    deps.state.backend = backend;
    deps.setRecorderManagedBackend(backend);

    // Step 6 — failures degrade to lastError only; the app must stay alive
    // and the sequence must still proceed to step 7 (see the assembly-order
    // doc comment above the function).
    try {
      await backend.configureSession();
    } catch (e) {
      // Belt-and-suspenders only: the REAL managedObsBackend.ts contract is
      // to never throw out of configureSession() (see the I3 comment right
      // below) -- this only ever fires for a throwing test double or a
      // future contract violation.
      deps.emitStatus(errStatus(s.recordingEnabled, e));
    }
    // 复核 I3 (review round 2): the real configureSession() returns
    // SILENTLY on failure -- ensureConnected() failing (spawn timeout,
    // connect refused, wrong password) or CreateInput/GetInputSettings both
    // failing degrades to the backend's own internal `lastError`, never a
    // thrown exception (managedObsBackend.ts's "recording failures never
    // throw into the caller" contract). The try/catch above is therefore
    // dead code for the DOMINANT real failure mode -- without this, a
    // managed session that failed to come up would report a plain 未连接
    // status with lastError: null, no diagnostic at all. probe() is the
    // only trustworthy post-configureSession signal (same reasoning as
    // recorder.ts's attemptManagedStart using probe() instead of trusting a
    // non-throwing call's mere completion).
    const health = await backend.probe();
    if (!health.ready) {
      deps.emitStatus({
        enabled: s.recordingEnabled,
        connected: false,
        recording: false,
        lastError: health.lastError ?? "managed backend 未就绪",
        sourceActive: health.sourceActive,
      });
    }
  } catch (e) {
    // writeObsConfig/clearSentinels are synchronous fs calls that CAN throw
    // (permission errors, disk full) before anything durable (a spawned
    // process) exists yet — safe to reset `running` so a later call (next
    // toggle, next app start) retries from scratch instead of being
    // permanently no-op'd by the re-entry guard above.
    deps.state.running = false;
    deps.emitStatus(errStatus(s.recordingEnabled, e));
    return;
  }

  // Step 7
  const watch = deps.createWowProcessWatch({
    onUp: deps.onWowUp,
    onDown: deps.onWowDown,
  });
  deps.state.watch = watch;
  watch.start();
}

export interface TeardownManagedRecordingDeps {
  state: ManagedAssemblyState;
  /** Usually `() => recorder?.stop() ?? Promise.resolve()`. recorder.stop()
   * itself (task-5b exit sequence) already runs the managed
   * backend.stopContinuous() → backend.shutdown() → handle.stop() sequence
   * internally whenever a managedBackend is present — this wrapper's only
   * remaining job is to also stop the watch and reset assembly state so a
   * later re-toggle back to "managed" can call assembleManagedRecording
   * again cleanly. Used for the RUNTIME toggle-off path only; app quit goes
   * through recorder.stop() directly via quitLifecycle (brief: "现有
   * before-quit 链的 stopRecorder 闭包... 自动覆盖托管"). */
  stopRecorder: () => Promise<void>;
  setRecorderManagedBackend: (b: CaptureBackend | null) => void;
  setRecorderManagedProcessStop: (fn: (() => Promise<void>) | null) => void;
  /** Current `recordingEnabled` setting, read fresh by the caller at call
   * time (not cached) — used only to shape the clean status pushed below. */
  recordingEnabled: boolean;
  /** 复核 I6 (review round 2): recorder.stop() (usually `stopRecorder`
   * above) DOES push its own status now (see recorder.ts's managed stop()
   * branch), but that push happens BEFORE this function clears
   * managedBackend/managedProcessStop -- belt-and-suspenders: an explicit,
   * unambiguous "torn down, idle" push here means the settings row is never
   * left showing a stale 正在录制/托管中 state after a runtime disable, even
   * if the recorder-level push above were ever skipped (e.g. `stopRecorder`
   * throws before reaching its own pushStatus). */
  emitStatus: (status: RecorderStatus) => void;
}

export function teardownManagedRecording(
  deps: TeardownManagedRecordingDeps,
): Promise<void> {
  return serialize(deps.state, () => doTeardown(deps));
}

/**
 * index.ts's settings:save hook (复核 NEW-3) used to `await` the false→true
 * branch directly, which meant a managed-enable toggle blocked the IPC reply
 * on the FULL 7-step assembly — spawn OBS, connect the websocket,
 * configureSession, `backend.probe()` — up to its ~30s readiness timeout, so
 * the renderer's save button hung with no feedback (task 8 review finding).
 * Startup already fires assembly with `void ensureManagedAssembly()` (see
 * main/index.ts's app-launch call site) — this makes the runtime toggle match
 * that precedent: kick assembly off and let it run in the background, driven
 * purely by the `gladlog:recorder:status` / install-progress pushes assembly
 * already emits, never by the settings:save reply.
 *
 * The true→false branch stays awaited: teardown only stops a process and
 * clears refs (no network/process readiness wait), so a synchronous-feeling
 * disable is fine, and awaiting it lets settings:save reliably report "torn
 * down" without adding another push-only status leg for the rarer direction.
 *
 * Ordering is unaffected either way: `assemble`/`teardown` are expected to be
 * `assembleManagedRecording`/`teardownManagedRecording` (or thin wrappers
 * around them) closed over the SAME `ManagedAssemblyState` — their mutual
 * exclusion lives on `state.chain` inside `serialize()` above, not on whether
 * the caller here awaits the returned promise.
 */
export function reactToManagedToggle(
  before: boolean,
  after: boolean,
  deps: { assemble: () => Promise<void>; teardown: () => Promise<void> },
): Promise<void> {
  if (!before && after) {
    void deps.assemble();
    return Promise.resolve();
  }
  if (before && !after) {
    return deps.teardown();
  }
  return Promise.resolve();
}

// -- Managed-OBS prefs restart (2026-09-04) ---------------------------------

export interface ManagedRestartCoordinatorDeps {
  /** Live recorder status: `recorder.getStatus().recording`. */
  isRecording: () => boolean;
  /** `ensureManagedTeardown` / `ensureManagedAssembly` from index.ts — the
   * SAME wrappers the runtime toggle uses, closed over the same
   * ManagedAssemblyState, so a restart serializes on `state.chain` with
   * any in-flight toggle exactly like the toggle itself does. */
  teardown: () => Promise<void>;
  assemble: () => Promise<void>;
}

export interface ManagedRestartCoordinator {
  /** settings:save hook (called BEFORE reactToManagedToggle for the same
   * patch, so a disable cancels a pending restart before the teardown's
   * status push could trigger it). Restarts the managed instance when any
   * managed-OBS pref changed while managed was active before AND after the
   * save; defers the restart to the end of the current recording when one
   * is in progress. */
  onSettingsSaved(
    prev: AssemblySettings,
    next: AssemblySettings,
  ): Promise<void>;
  /** Feed every `gladlog:recorder:status` push here: a deferred restart
   * fires on the first push that says recording=false. */
  onRecorderStatus(status: Pick<RecorderStatus, "recording">): void;
  /** A restart is waiting for the current recording to end. */
  restartPending(): boolean;
}

/**
 * The user ruling (2026-09-04): "保存即生效,正在录制则等这场录完再重启". The
 * three prefs are read by OBS at process start (RecFilePath from basic.ini,
 * the audio devices from the scene collection JSON), so applying them means
 * tearing the managed instance down and assembling it again — which
 * rewrites the config from fresh settings (assembly step 4) and spawns a
 * new process. Restarting mid-match would cut the recording, hence the
 * deferral.
 *
 * Shape mirrors reactToManagedToggle: teardown is awaited (fast, no
 * readiness wait), assembly is fire-and-forget (its ~30s readiness timeout
 * must not block the settings:save IPC reply). Mutual exclusion with a
 * concurrent toggle lives on `state.chain` inside the wrappers, not here.
 *
 * Cases where this deliberately does NOTHING:
 * - prefs unchanged → nothing to apply;
 * - managed not active after the save → nothing is (or should be) running;
 *   the next assembly reads the new prefs anyway;
 * - managed not active before the save → reactToManagedToggle's enable
 *   branch is assembling right now from the same fresh settings.
 */
export function createManagedRestartCoordinator(
  deps: ManagedRestartCoordinatorDeps,
): ManagedRestartCoordinator {
  let pending = false;

  async function restart(): Promise<void> {
    await deps.teardown();
    void deps.assemble();
  }

  return {
    async onSettingsSaved(prev, next) {
      // Managed going (or staying) inactive cancels any deferred restart
      // BEFORE the prefs check — agy review 2026-09-04 #3: a plain disable
      // with a restart pending used to leave `pending` set, and the
      // teardown's own recording=false status push then fired a phantom
      // teardown+assemble (both no-ops, but queued on state.chain behind
      // the disable). index.ts calls this ahead of reactToManagedToggle for
      // the same reason.
      if (!isManagedActive(next)) {
        pending = false;
        return;
      }
      if (!managedObsPrefsChanged(prev, next)) return;
      if (!isManagedActive(prev)) {
        pending = false; // the enable toggle assembles from fresh settings
        return;
      }
      if (deps.isRecording()) {
        pending = true;
        return;
      }
      pending = false;
      await restart();
    },
    onRecorderStatus(status) {
      if (!pending || status.recording) return;
      pending = false;
      void restart();
    },
    restartPending: () => pending,
  };
}

async function doTeardown(deps: TeardownManagedRecordingDeps): Promise<void> {
  if (!deps.state.running) return; // idempotent
  deps.state.watch?.stop();
  deps.state.watch = null;
  await deps.stopRecorder();
  deps.setRecorderManagedBackend(null);
  deps.setRecorderManagedProcessStop(null);
  deps.state.handle = null;
  deps.state.backend = null;
  deps.state.running = false;
  deps.emitStatus({
    enabled: deps.recordingEnabled,
    connected: false,
    recording: false,
    lastError: null,
    sourceActive: null,
  });
}
