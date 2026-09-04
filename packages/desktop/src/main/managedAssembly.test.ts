import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MANAGED_OBS_PREF_DEFAULTS,
  type ManagedObsPrefs,
} from "../shared/managedObsPrefs";
import type { CaptureBackend, CaptureChunk } from "./captureBackend";
import type { ManagedObsBackend } from "./managedObsBackend";
import type { ObsConfigSpec } from "./obsConfigWriter";
import type { RecorderStatus } from "./recorder";
import {
  assembleManagedRecording,
  createManagedRestartCoordinator,
  createManagedAssemblyState,
  reactToManagedToggle,
  teardownManagedRecording,
  type AssembleManagedRecordingDeps,
} from "./managedAssembly";

/** Resolves/rejects on demand -- lets a test hold `assemble`/`teardown` open
 * to observe reactToManagedToggle's timing without a real setTimeout race. */
function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
} {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const originalPlatform = process.platform;

function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: p });
}

/** One mutable bag of counters/refs the fake deps below all write into --
 * simpler for these tests than per-field getters, and easy to read at the
 * assertion site. */
class Harness {
  order: string[] = [];
  statuses: RecorderStatus[] = [];
  installed: boolean;
  recorderManagedBackend: CaptureBackend | null = null;
  recorderManagedProcessStop: (() => Promise<void>) | null = null;
  watchStartCalls = 0;
  watchStopCalls = 0;
  onWowUpCalls = 0;
  onWowDownCalls = 0;
  handleStopCalls = 0;
  state = createManagedAssemblyState();
  writtenSpec: ObsConfigSpec | null = null;
  deps: AssembleManagedRecordingDeps;

  constructor(opts?: {
    enabled?: boolean;
    mode?: "managed" | "external";
    installed?: boolean;
    prefs?: Partial<ManagedObsPrefs>;
    configureSession?: () => Promise<void>;
    probe?: () => Promise<{
      ready: boolean;
      encoder: string | null;
      sourceActive: boolean;
      lastError: string | null;
    }>;
  }) {
    this.installed = opts?.installed ?? true;
    const backend: ManagedObsBackend = {
      startContinuous: async () => {},
      stopContinuous: async () => null,
      splitChunk: async () => null,
      onChunkOpened: (_cb: (c: CaptureChunk) => void) => () => {},
      markChapter: async () => {},
      probe:
        opts?.probe ??
        (async () => {
          this.order.push("probe");
          return {
            ready: true,
            encoder: "obs_x264",
            sourceActive: true,
            lastError: null,
          };
        }),
      shutdown: async () => {},
      configureSession:
        opts?.configureSession ??
        (async () => {
          this.order.push("configureSession");
        }),
      captureProbe: async () => ({ shotPath: "", black: false }),
      listAudioDevices: async () => ({ output: [], input: [] }),
    };

    this.deps = {
      state: this.state,
      getSettings: () => ({
        recordingEnabled: opts?.enabled ?? true,
        recordingMode: opts?.mode ?? "managed",
        ...MANAGED_OBS_PREF_DEFAULTS,
        ...opts?.prefs,
      }),
      getWsPassword: () => {
        this.order.push("getWsPassword");
        return "deadbeef";
      },
      defaultRecDir: "/tmp/gladlog-recdir",
      assets: {
        root: "/tmp/gladlog-obs-root",
        installed: () => {
          this.order.push("assets.installed");
          return this.installed;
        },
      },
      writeObsConfig: (spec) => {
        this.order.push("writeObsConfig");
        this.writtenSpec = spec;
      },
      clearSentinels: () => {
        this.order.push("clearSentinels");
      },
      spawnManagedObs: () => {
        this.order.push("spawnManagedObs");
        return {
          ready: Promise.resolve({ wsUrl: "ws://127.0.0.1:4466" }),
          onLogLine: () => () => {},
          stop: async () => {
            this.handleStopCalls++;
            this.order.push("handle.stop");
          },
          killSync: () => {
            this.order.push("handle.killSync");
          },
          exited: () => null,
          pid: () => 4321,
        };
      },
      createManagedObsBackend: () => {
        this.order.push("createManagedObsBackend");
        return backend;
      },
      createWowProcessWatch: () => {
        this.order.push("createWowProcessWatch");
        return {
          start: () => {
            this.order.push("watch.start");
            this.watchStartCalls++;
          },
          stop: () => {
            this.order.push("watch.stop");
            this.watchStopCalls++;
          },
        };
      },
      setRecorderManagedBackend: (b) => {
        this.recorderManagedBackend = b;
      },
      setRecorderManagedProcessStop: (fn) => {
        this.recorderManagedProcessStop = fn;
      },
      onWowUp: () => {
        this.onWowUpCalls++;
      },
      onWowDown: () => {
        this.onWowDownCalls++;
      },
      emitStatus: (status) => {
        this.statuses.push(status);
      },
    };
  }
}

describe("assembleManagedRecording (task-5b Step 1 测试矩阵)", () => {
  // isManagedActive()'s third term requires win32 — same convention as
  // recorder.test.ts's "recorderService 托管循环" describe block.
  beforeEach(() => {
    setPlatform("win32");
  });
  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it("① 未安装 → 不 spawn、不下载,status 报「待安装」,不标记 running", async () => {
    const h = new Harness({ installed: false });
    await assembleManagedRecording(h.deps);
    expect(h.order).toEqual(["assets.installed"]);
    expect(h.state.running).toBe(false);
    expect(h.statuses).toHaveLength(1);
    expect(h.statuses[0]!.lastError).toContain("未安装");
    expect(h.statuses[0]!.connected).toBe(false);
  });

  it("② 已安装 → 配置写入→spawn→configureSession→watch 启动的顺序;watcher 恰好启动一次", async () => {
    const h = new Harness({ installed: true });
    await assembleManagedRecording(h.deps);
    expect(h.order).toEqual([
      "assets.installed",
      "getWsPassword",
      "writeObsConfig",
      "clearSentinels",
      "spawnManagedObs",
      "createManagedObsBackend",
      "configureSession",
      "probe", // 复核 I3: post-configureSession health check (see doAssemble)
      "createWowProcessWatch",
      "watch.start",
    ]);
    expect(h.state.running).toBe(true);
    expect(h.watchStartCalls).toBe(1);
    expect(h.recorderManagedBackend).not.toBeNull();
    expect(h.recorderManagedProcessStop).not.toBeNull();
  });

  it("③ configureSession 抛错 → app 不崩(函数正常返回)、lastError 置位,顺序不变(configureSession 仍先于 watch 启动)", async () => {
    const h = new Harness({
      installed: true,
      configureSession: async () => {
        h.order.push("configureSession:throw");
        throw new Error("CreateInput 超时");
      },
    });
    await expect(assembleManagedRecording(h.deps)).resolves.toBeUndefined();
    expect(h.order.indexOf("configureSession:throw")).toBeLessThan(
      h.order.indexOf("createWowProcessWatch"),
    );
    expect(h.order).toContain("watch.start"); // assembly still completes (degraded mode)
    expect(h.state.running).toBe(true);
    const lastStatus = h.statuses.at(-1);
    expect(lastStatus?.lastError).toContain("CreateInput 超时");
  });

  it("I3(review round 2): configureSession 静默失败(真实 backend 契约,不抛)→ 事后 probe() 不 ready → emitStatus 携带 probe().lastError,而非报虚假『未连接、无错误』", async () => {
    const h = new Harness({
      installed: true,
      // The REAL managedObsBackend.ts contract: ensureConnected()/CreateInput
      // failing degrades to the backend's own internal lastError, configureSession
      // itself resolves normally (never throws) -- so the try/catch around it
      // in doAssemble is dead code for this, the DOMINANT real failure mode.
      configureSession: async () => {
        h.order.push("configureSession:silent-fail");
      },
      probe: async () => {
        h.order.push("probe");
        return {
          ready: false,
          encoder: null,
          sourceActive: false,
          lastError: "connect 失败: ECONNREFUSED",
        };
      },
    });
    await expect(assembleManagedRecording(h.deps)).resolves.toBeUndefined();
    expect(h.order.indexOf("configureSession:silent-fail")).toBeLessThan(
      h.order.indexOf("probe"),
    );
    expect(h.order.indexOf("probe")).toBeLessThan(
      h.order.indexOf("createWowProcessWatch"),
    );
    expect(h.order).toContain("watch.start"); // still completes (degraded mode)
    expect(h.state.running).toBe(true);
    expect(h.statuses).toHaveLength(1); // the ONLY status pushed comes from the probe check
    expect(h.statuses[0]?.lastError).toContain("ECONNREFUSED");
    expect(h.statuses[0]?.connected).toBe(false);
  });

  it("④ managedActive=false(三种子情形:未启用/external/非win32)→ 全程零调用", async () => {
    for (const opts of [
      { enabled: false, mode: "managed" as const },
      { enabled: true, mode: "external" as const },
    ]) {
      const h = new Harness(opts);
      await assembleManagedRecording(h.deps);
      expect(h.order).toEqual([]);
      expect(h.statuses).toEqual([]);
      expect(h.state.running).toBe(false);
    }
    setPlatform("darwin");
    try {
      const h = new Harness({ enabled: true, mode: "managed" });
      await assembleManagedRecording(h.deps);
      expect(h.order).toEqual([]);
    } finally {
      setPlatform(originalPlatform);
    }
  });

  it("幂等:并发/重复调用不二次 spawn(state.running 在首个 await 之前同步置位)", async () => {
    const h = new Harness({ installed: true });
    const p1 = assembleManagedRecording(h.deps);
    const p2 = assembleManagedRecording(h.deps); // fired before p1 has settled
    await Promise.all([p1, p2]);
    expect(h.order.filter((c) => c === "spawnManagedObs")).toHaveLength(1);
    expect(h.watchStartCalls).toBe(1);
  });

  it("配置写入抛错(同步 fs 错误):running 回退为 false,可重试", async () => {
    const h = new Harness({ installed: true });
    h.deps.writeObsConfig = () => {
      throw new Error("EACCES");
    };
    await assembleManagedRecording(h.deps);
    expect(h.state.running).toBe(false);
    expect(h.statuses.at(-1)?.lastError).toContain("EACCES");
    expect(h.order).not.toContain("spawnManagedObs");
  });
});

describe("teardownManagedRecording + toggle 序列 (复核 NEW-3)", () => {
  beforeEach(() => {
    setPlatform("win32");
  });
  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it("running=false 时 no-op", async () => {
    const state = createManagedAssemblyState();
    let stopCalls = 0;
    await teardownManagedRecording({
      state,
      stopRecorder: async () => {
        stopCalls++;
      },
      setRecorderManagedBackend: () => {},
      setRecorderManagedProcessStop: () => {},
      recordingEnabled: true,
      emitStatus: () => {},
    });
    expect(stopCalls).toBe(0);
  });

  it("toggle false→true→false→true:每轮 assemble 都重新 spawn,teardown 都停 watch + 调 stopRecorder + 清空 backend 引用", async () => {
    const h = new Harness({ installed: true });
    await assembleManagedRecording(h.deps);
    expect(h.state.running).toBe(true);
    expect(h.watchStartCalls).toBe(1);

    let stopRecorderCalls = 0;
    const teardownStatuses: RecorderStatus[] = [];
    await teardownManagedRecording({
      state: h.state,
      stopRecorder: async () => {
        stopRecorderCalls++;
      },
      setRecorderManagedBackend: h.deps.setRecorderManagedBackend,
      setRecorderManagedProcessStop: h.deps.setRecorderManagedProcessStop,
      recordingEnabled: true,
      emitStatus: (s) => teardownStatuses.push(s),
    });
    expect(h.state.running).toBe(false);
    expect(h.watchStopCalls).toBe(1);
    expect(stopRecorderCalls).toBe(1);
    expect(h.recorderManagedBackend).toBeNull();
    expect(h.recorderManagedProcessStop).toBeNull();
    // 复核 I6: teardown pushes its own clean status (defense-in-depth beyond
    // recorder.stop()'s own pushStatus, which recorder.test.ts covers
    // separately).
    expect(teardownStatuses).toHaveLength(1);
    expect(teardownStatuses[0]).toMatchObject({
      connected: false,
      recording: false,
      lastError: null,
    });

    // Second assemble after teardown must re-run the full sequence, not no-op.
    h.order.length = 0;
    await assembleManagedRecording(h.deps);
    expect(h.order).toContain("spawnManagedObs");
    expect(h.watchStartCalls).toBe(2);
    expect(h.state.running).toBe(true);
  });
});

describe("managed-OBS prefs → ObsConfigSpec (2026-09-04)", () => {
  beforeEach(() => setPlatform("win32"));
  afterEach(() => setPlatform(originalPlatform));

  it("默认 prefs:recDir = 应用默认目录,桌面声音 default,麦克风 null", async () => {
    const h = new Harness({ installed: true });
    await assembleManagedRecording(h.deps);
    expect(h.writtenSpec).toMatchObject({
      recDir: "/tmp/gladlog-recdir",
      desktopAudioDeviceId: "default",
      micDeviceId: null,
    });
  });

  it("用户 prefs:目录/两路设备原样进入 spec,并且 backend 拿到同一个 recDir(共享谓词)", async () => {
    let backendRecDir: string | null = null;
    const h = new Harness({
      installed: true,
      prefs: {
        recordingDirectory: "D:\\rec",
        managedDesktopAudioDevice: null,
        managedMicDevice: "{mic}",
      },
    });
    const inner = h.deps.createManagedObsBackend;
    h.deps.createManagedObsBackend = (d) => {
      backendRecDir = d.recDir;
      return inner(d);
    };
    await assembleManagedRecording(h.deps);
    expect(h.writtenSpec).toMatchObject({
      recDir: "D:\\rec",
      desktopAudioDeviceId: null,
      micDeviceId: "{mic}",
    });
    expect(backendRecDir).toBe("D:\\rec");
  });
});

describe("createManagedRestartCoordinator (2026-09-04 用户裁决:保存即生效,录制中等录完)", () => {
  beforeEach(() => setPlatform("win32"));
  afterEach(() => setPlatform(originalPlatform));

  const active = {
    recordingEnabled: true,
    recordingMode: "managed" as const,
    ...MANAGED_OBS_PREF_DEFAULTS,
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));

  function build(recording = false) {
    const calls: string[] = [];
    const rec = { recording };
    const c = createManagedRestartCoordinator({
      isRecording: () => rec.recording,
      teardown: async () => {
        calls.push("teardown");
      },
      assemble: async () => {
        calls.push("assemble");
      },
    });
    return { c, calls, rec };
  }

  it("prefs 未变 → 不动;变了且空闲 → teardown 后 assemble(顺序)", async () => {
    const { c, calls } = build(false);
    await c.onSettingsSaved(active, { ...active });
    expect(calls).toEqual([]);
    await c.onSettingsSaved(active, { ...active, managedMicDevice: "{mic}" });
    await settle();
    expect(calls).toEqual(["teardown", "assemble"]);
    expect(c.restartPending()).toBe(false);
  });

  it("录制中 → 标记待重启,不打断;收到 recording=false 的状态推送后才重启,且只重启一次", async () => {
    const { c, calls, rec } = build(true);
    await c.onSettingsSaved(active, {
      ...active,
      recordingDirectory: "D:\\rec",
    });
    expect(calls).toEqual([]);
    expect(c.restartPending()).toBe(true);
    c.onRecorderStatus({ recording: true }); // still recording: nothing
    expect(calls).toEqual([]);
    rec.recording = false;
    c.onRecorderStatus({ recording: false });
    await settle();
    expect(calls).toEqual(["teardown", "assemble"]);
    expect(c.restartPending()).toBe(false);
    c.onRecorderStatus({ recording: false }); // no second restart
    await settle();
    expect(calls).toEqual(["teardown", "assemble"]);
  });

  it("托管未激活(前或后)→ 不重启:开关本身的 reactToManagedToggle 负责,且清掉挂起的待重启", async () => {
    const { c, calls, rec } = build(true);
    await c.onSettingsSaved(active, { ...active, managedMicDevice: "{mic}" });
    expect(c.restartPending()).toBe(true);
    // user disables managed while a restart is pending
    await c.onSettingsSaved(
      { ...active, managedMicDevice: "{mic}" },
      { ...active, managedMicDevice: "{mic}", recordingEnabled: false },
    );
    expect(calls).toEqual([]);
    // (agy review #3) a plain disable — prefs untouched — must ALSO clear
    // the pending restart, or the teardown's recording=false push would
    // fire a phantom teardown+assemble behind the disable.
    expect(c.restartPending()).toBe(false);
    // prefs changed together with the disable → still nothing
    await c.onSettingsSaved(
      { ...active, managedMicDevice: "{mic}" },
      { ...active, recordingEnabled: false, managedMicDevice: null },
    );
    expect(c.restartPending()).toBe(false);
    rec.recording = false;
    c.onRecorderStatus({ recording: false });
    await settle();
    expect(calls).toEqual([]);
    // enabling + prefs in one patch: assembly from the toggle reads fresh
    // settings, no extra restart
    await c.onSettingsSaved(
      { ...active, recordingEnabled: false },
      { ...active, managedMicDevice: "{mic}" },
    );
    expect(calls).toEqual([]);
  });
});

describe("reactToManagedToggle (task 8 review fix: settings:save 不再卡在整个 assembly 上)", () => {
  it("false→true(enable): 立即 resolve,即便 assemble 挂着未完成 —— 但 assemble 确实已经被调用,后台仍在跑", async () => {
    const d = deferred<void>();
    let assembleCalls = 0;
    let assembleSettled = false;
    const teardown = async () => {
      throw new Error("teardown must not run on an enable transition");
    };

    const reactPromise = reactToManagedToggle(false, true, {
      assemble: () => {
        assembleCalls++;
        return d.promise.then(() => {
          assembleSettled = true;
        });
      },
      teardown,
    });

    // The whole point of the fix: this resolves WITHOUT waiting for
    // `assemble`'s promise (mirrors settings:save no longer blocking on the
    // ~30s assembly readiness timeout). assemble() is still called
    // synchronously though -- kicked off, just not awaited.
    await reactPromise;
    expect(assembleCalls).toBe(1);
    expect(assembleSettled).toBe(false);

    // ...and it keeps running in the background until released.
    d.resolve();
    await d.promise;
    expect(assembleSettled).toBe(true);
  });

  it("true→false(disable): 真正 await teardown —— 在 teardown resolve 之前不返回", async () => {
    const d = deferred<void>();
    let teardownCalls = 0;
    const assemble = async () => {
      throw new Error("assemble must not run on a disable transition");
    };

    let reactSettled = false;
    const reactPromise = reactToManagedToggle(true, false, {
      assemble,
      teardown: () => {
        teardownCalls++;
        return d.promise;
      },
    }).then(() => {
      reactSettled = true;
    });

    // Give any stray microtasks a chance to run -- reactPromise must NOT
    // have settled yet, unlike the enable case above.
    await Promise.resolve();
    await Promise.resolve();
    expect(teardownCalls).toBe(1);
    expect(reactSettled).toBe(false);

    d.resolve();
    await reactPromise;
    expect(reactSettled).toBe(true);
  });

  it("无变化(true→true / false→false): 两边都不调用,直接 resolve", async () => {
    let assembleCalls = 0;
    let teardownCalls = 0;
    const deps = {
      assemble: async () => {
        assembleCalls++;
      },
      teardown: async () => {
        teardownCalls++;
      },
    };

    await reactToManagedToggle(true, true, deps);
    await reactToManagedToggle(false, false, deps);
    expect(assembleCalls).toBe(0);
    expect(teardownCalls).toBe(0);
  });

  it("集成:与真实 assembleManagedRecording/teardownManagedRecording 串联时,enable 分支不阻塞返回,但 assembly 仍然真的跑完并让 state.running 变 true", async () => {
    setPlatform("win32");
    try {
      const h = new Harness({ installed: true });
      let reactSettled = false;
      const reactPromise = reactToManagedToggle(false, true, {
        assemble: () => assembleManagedRecording(h.deps),
        teardown: () =>
          teardownManagedRecording({
            state: h.state,
            stopRecorder: async () => {},
            setRecorderManagedBackend: h.deps.setRecorderManagedBackend,
            setRecorderManagedProcessStop: h.deps.setRecorderManagedProcessStop,
            recordingEnabled: true,
            emitStatus: () => {},
          }),
      }).then(() => {
        reactSettled = true;
      });

      await reactPromise; // must resolve promptly
      expect(reactSettled).toBe(true);

      // Assembly itself is async (spawnManagedObs/backend.probe are awaited
      // inside doAssemble) -- give its microtask chain room to finish, then
      // confirm it genuinely ran, observable via the real state object.
      await new Promise((r) => setTimeout(r, 10));
      expect(h.state.running).toBe(true);
      expect(h.watchStartCalls).toBe(1);
    } finally {
      setPlatform(originalPlatform);
    }
  });
});
