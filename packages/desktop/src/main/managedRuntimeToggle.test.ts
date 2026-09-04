import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRecorderService, type RecorderService } from "./recorder";
import {
  assembleManagedRecording,
  createManagedAssemblyState,
  teardownManagedRecording,
  type AssembleManagedRecordingDeps,
  type ManagedAssemblyState,
  type TeardownManagedRecordingDeps,
} from "./managedAssembly";
import { MANAGED_OBS_PREF_DEFAULTS } from "../shared/managedObsPrefs";
import { RecordingsStore } from "./recordingsStore";
import type { CaptureBackend, CaptureChunk } from "./captureBackend";
import type { ManagedObsBackend } from "./managedObsBackend";
import type { ManagedObsHandle } from "./managedObsProcess";

/**
 * Task-5b review round 2 (C1/C2): the reviewer's core finding was that
 * managedAssembly.test.ts's toggle test used a bare call-counter fake for
 * the recorder side, which structurally cannot see either bug -- C1 lives
 * entirely inside recorder.ts's OWN `chunkOpenedUnsub` closure variable
 * (never exposed to managedAssembly.ts), and C2 is a race between the REAL
 * recorder.stop() (awaiting a real managed backend's shutdown) and the
 * assembly layer's OWN state machine. Both require the real
 * createRecorderService wired to the real assembleManagedRecording/
 * teardownManagedRecording, exactly as main/index.ts wires them -- only the
 * leaf-level OBS process/backend/watch are faked (spawnManagedObs/
 * createManagedObsBackend/createWowProcessWatch), same seam index.ts itself
 * sits on.
 */

const originalPlatform = process.platform;
function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: p });
}
const settle = () => new Promise((r) => setTimeout(r, 10));

function makeFakeHandle(): ManagedObsHandle {
  return {
    ready: Promise.resolve({ wsUrl: "ws://127.0.0.1:4466" }),
    onLogLine: () => () => {},
    stop: async () => {},
    killSync: () => {},
    exited: () => null,
    pid: () => 1,
  };
}

/** One fake managed backend instance -- deliberately NOT shared/reused
 * across toggles by the harness below, matching production reality: an
 * off→on toggle spawns a genuinely new OBS process and a new websocket
 * session (managedAssembly.ts steps 4/5). A shared/singleton fake would
 * hide C1 entirely (recorder.ts's `ensureChunkOpenedSubscription` would
 * happily keep talking to the SAME object it already subscribed to). */
function makeFakeBackend(): {
  backend: ManagedObsBackend;
  hasSubscriber: () => boolean;
  triggerChunkOpened: (c: CaptureChunk) => void;
} {
  let openedCb: ((c: CaptureChunk) => void) | null = null;
  const backend: ManagedObsBackend = {
    startContinuous: async () => {},
    stopContinuous: async () => null,
    splitChunk: async () => null,
    onChunkOpened: (cb) => {
      openedCb = cb;
      return () => {
        openedCb = null;
      };
    },
    markChapter: async () => {},
    probe: async () => ({
      ready: true,
      encoder: "obs_x264",
      sourceActive: true,
      lastError: null,
    }),
    shutdown: async () => {},
    configureSession: async () => {},
    captureProbe: async () => ({ shotPath: "", black: false }),
    listAudioDevices: async () => ({ output: [], input: [] }),
  };
  return {
    backend,
    hasSubscriber: () => openedCb !== null,
    triggerChunkOpened: (c) => openedCb?.(c),
  };
}

interface FakeWatch {
  start(): void;
  stop(): void;
  startCalls: number;
  stopCalls: number;
  onUp: () => void;
  onDown: () => void;
}

function buildIntegration(dir: string) {
  const recordings = new RecordingsStore(dir);
  const settings = {
    recordingEnabled: true,
    obsWebsocketUrl: null,
    obsWebsocketPassword: null,
    recordingKeepCount: 0,
    recordingMaxBytes: Number.POSITIVE_INFINITY,
    recordingMode: "managed" as const,
    ...MANAGED_OBS_PREF_DEFAULTS,
  };
  const managedRefs: {
    backend?: CaptureBackend;
    processStop?: () => Promise<void>;
  } = {};

  const recorder: RecorderService = createRecorderService({
    getSettings: () => settings,
    recordings,
    clientFactory: () => {
      throw new Error(
        "bypass ObsClientLike should never be constructed in this managed-only integration test",
      );
    },
    emit: () => {},
    get managedBackend() {
      return managedRefs.backend;
    },
    get managedProcessStop() {
      return managedRefs.processStop;
    },
  });

  const state: ManagedAssemblyState = createManagedAssemblyState();
  const fakeBackends: ReturnType<typeof makeFakeBackend>[] = [];
  const watches: FakeWatch[] = [];
  let nextConfigureSession: (() => Promise<void>) | null = null;

  const assembleDeps: AssembleManagedRecordingDeps = {
    state,
    getSettings: () => settings,
    getWsPassword: () => "deadbeef",
    defaultRecDir: dir,
    assets: { root: "/tmp/gladlog-obs-root", installed: () => true },
    writeObsConfig: () => {},
    clearSentinels: () => {},
    spawnManagedObs: () => makeFakeHandle(),
    createManagedObsBackend: () => {
      const fb = makeFakeBackend();
      if (nextConfigureSession) {
        fb.backend.configureSession = nextConfigureSession;
        nextConfigureSession = null;
      }
      fakeBackends.push(fb);
      return fb.backend;
    },
    createWowProcessWatch: (watchDeps) => {
      const w: FakeWatch = {
        startCalls: 0,
        stopCalls: 0,
        onUp: watchDeps.onUp,
        onDown: watchDeps.onDown,
        start() {
          this.startCalls++;
        },
        stop() {
          this.stopCalls++;
        },
      };
      watches.push(w);
      return w;
    },
    setRecorderManagedBackend: (b) => {
      managedRefs.backend = b ?? undefined;
    },
    setRecorderManagedProcessStop: (fn) => {
      managedRefs.processStop = fn ?? undefined;
    },
    onWowUp: () => recorder.onWowUp(),
    onWowDown: () => recorder.onWowDown(),
    emitStatus: () => {},
  };

  const teardownDeps: TeardownManagedRecordingDeps = {
    state,
    stopRecorder: () => recorder.stop(),
    setRecorderManagedBackend: (b) => {
      managedRefs.backend = b ?? undefined;
    },
    setRecorderManagedProcessStop: (fn) => {
      managedRefs.processStop = fn ?? undefined;
    },
    recordingEnabled: true,
    emitStatus: () => {},
  };

  return {
    recorder,
    recordings,
    state,
    fakeBackends,
    watches,
    assembleDeps,
    teardownDeps,
    setNextConfigureSession: (fn: () => Promise<void>) => {
      nextConfigureSession = fn;
    },
  };
}

describe("托管运行时切换集成测试 (task-5b review round 2, 真实 recorder + 真实 assembly)", () => {
  beforeEach(() => {
    setPlatform("win32");
  });
  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it("C1: off→on 切换后新 backend 的 onChunkOpened 订阅真正生效,不被上一轮的 chunkOpenedUnsub 挡住", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gladlog-toggle-c1-"));
    const h = buildIntegration(dir);

    // Round 1: enable, WoW up, a chunk opens -- must be indexed.
    await assembleManagedRecording(h.assembleDeps);
    expect(h.watches).toHaveLength(1);
    h.watches[0]!.onUp();
    await settle();
    expect(h.fakeBackends[0]!.hasSubscriber()).toBe(true);
    h.fakeBackends[0]!.triggerChunkOpened({
      videoPath: "/tmp/round1.mp4",
      startedAt: 1000,
      stoppedAt: null,
    });
    expect(
      h.recordings.list().some((r) => r.videoPath === "/tmp/round1.mp4"),
    ).toBe(true);

    // Round 2: disable, then re-enable -- a BRAND NEW backend is spawned.
    await teardownManagedRecording(h.teardownDeps);
    await assembleManagedRecording(h.assembleDeps);
    expect(h.watches).toHaveLength(2);
    expect(h.fakeBackends).toHaveLength(2);

    h.watches[1]!.onUp();
    await settle();
    // The bug (pre-fix): chunkOpenedUnsub was still non-null from round 1's
    // subscription, so ensureChunkOpenedSubscription()'s `if
    // (chunkOpenedUnsub || ...) return` no-op'd and round 2's backend never
    // got a subscriber at all.
    expect(h.fakeBackends[1]!.hasSubscriber()).toBe(true);
    h.fakeBackends[1]!.triggerChunkOpened({
      videoPath: "/tmp/round2.mp4",
      startedAt: 2000,
      stoppedAt: null,
    });
    expect(
      h.recordings.list().some((r) => r.videoPath === "/tmp/round2.mp4"),
    ).toBe(true);
  });

  it("C2(a): disable 的 stopRecorder 卡在 backend.shutdown() 未完成时,并发的 re-enable 不会被静默丢弃 —— 收敛到「已启用」而非永久关闭且无错误", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gladlog-toggle-c2a-"));
    const h = buildIntegration(dir);

    await assembleManagedRecording(h.assembleDeps);
    expect(h.state.running).toBe(true);
    expect(h.fakeBackends).toHaveLength(1);

    let releaseShutdown!: () => void;
    h.fakeBackends[0]!.backend.shutdown = () =>
      new Promise<void>((res) => {
        releaseShutdown = res;
      });

    // Disable: teardownManagedRecording -> recorder.stop() -> hangs inside
    // backend.shutdown(). NOT awaited yet.
    const teardownPromise = teardownManagedRecording(h.teardownDeps);
    // Re-enable arrives while the disable is still in flight. With the C2
    // fix (serialized chain), this call is QUEUED behind the in-flight
    // teardown -- it must not see `state.running` as already-true-forever
    // and no-op.
    const assemblePromise = assembleManagedRecording(h.assembleDeps);

    // `releaseShutdown` is only assigned once doTeardown's chain actually
    // runs far enough to call backend.shutdown() -- that's several
    // microtask hops away (state.chain.then -> doTeardown ->
    // deps.stopRecorder() -> recorder.stop() -> its own runManaged chain ->
    // the shutdown() call itself), so a bare synchronous call here would hit
    // it before it exists. settle() (a real setTimeout) gives the pending
    // chains room to actually reach the hung await point.
    await settle();
    releaseShutdown(); // let the hung shutdown() resolve so teardown can finish
    await Promise.all([teardownPromise, assemblePromise]);

    expect(h.state.running).toBe(true); // final state = the LAST requested toggle
    expect(h.fakeBackends).toHaveLength(2); // the re-enable really did spawn a fresh backend
    expect(h.watches).toHaveLength(2);
    expect(h.watches[1]!.startCalls).toBe(1);
  });

  it("C2(b): disable 在 assembly 卡在 configureSession()(watch 尚未创建)时到达 —— teardown 排在 assembly 完成之后执行,不留下没人管的 watcher", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gladlog-toggle-c2b-"));
    const h = buildIntegration(dir);

    let releaseConfigureSession!: () => void;
    h.setNextConfigureSession(
      () =>
        new Promise<void>((res) => {
          releaseConfigureSession = res;
        }),
    );

    // Assembly starts, will hang mid-configureSession -- state.watch is
    // still null at this point (watch creation is step 7, after
    // configureSession). NOT awaited yet.
    const assemblePromise = assembleManagedRecording(h.assembleDeps);
    // Disable arrives concurrently. With the C2 fix, this is queued behind
    // the in-flight assembly instead of running immediately against a
    // watch===null snapshot.
    const teardownPromise = teardownManagedRecording(h.teardownDeps);

    // Same reasoning as C2(a): give doAssemble's chain room to actually
    // reach the hung configureSession() call before releasing it.
    await settle();
    releaseConfigureSession();
    await Promise.all([assemblePromise, teardownPromise]);

    // Exactly one watch was ever created -- no dangling second watcher
    // started by a resumed assembly after teardown already "finished".
    expect(h.watches).toHaveLength(1);
    expect(h.watches[0]!.startCalls).toBe(1);
    expect(h.watches[0]!.stopCalls).toBe(1); // teardown, running AFTER assembly, correctly stopped it
    expect(h.state.running).toBe(false); // final state = the LAST requested toggle (disable)
  });
});
