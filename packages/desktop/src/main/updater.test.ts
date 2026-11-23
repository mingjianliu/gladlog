import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
} from "../shared/updateSchedule";
import {
  createUpdaterService,
  evaluateGate,
  type UpdaterBackend,
  type UpdaterEnv,
  type UpdateState,
} from "./updater";

function winEnv(over: Partial<UpdaterEnv> = {}): UpdaterEnv {
  return {
    platform: "win32",
    isPackaged: true,
    execDir: "C:\\Users\\x\\AppData\\Local\\Programs\\gladlog",
    readDir: () => ["gladlog.exe", "Uninstall gladlog.exe", "resources"],
    testFeed: undefined,
    ...over,
  };
}

/** Records every touch of the backend so "the gate never talks to
 * electron-updater" can be asserted, property assignments included. */
class FakeBackend implements UpdaterBackend {
  calls: string[] = [];
  checkResult: Promise<unknown> = Promise.resolve(null);
  private listeners = new Map<string, ((payload: unknown) => void)[]>();
  private _autoDownload = false;
  private _autoInstallOnAppQuit = false;
  private _allowPrerelease = true;
  private _disableWebInstaller = false;

  get autoDownload(): boolean {
    return this._autoDownload;
  }
  set autoDownload(v: boolean) {
    this.calls.push(`set:autoDownload=${v}`);
    this._autoDownload = v;
  }
  get autoInstallOnAppQuit(): boolean {
    return this._autoInstallOnAppQuit;
  }
  set autoInstallOnAppQuit(v: boolean) {
    this.calls.push(`set:autoInstallOnAppQuit=${v}`);
    this._autoInstallOnAppQuit = v;
  }
  get allowPrerelease(): boolean {
    return this._allowPrerelease;
  }
  set allowPrerelease(v: boolean) {
    this.calls.push(`set:allowPrerelease=${v}`);
    this._allowPrerelease = v;
  }
  get disableWebInstaller(): boolean {
    return this._disableWebInstaller;
  }
  set disableWebInstaller(v: boolean) {
    this.calls.push(`set:disableWebInstaller=${v}`);
    this._disableWebInstaller = v;
  }
  setFeedURL(options: { provider: "github"; owner: string; repo: string }) {
    this.calls.push(`setFeedURL:${options.owner}/${options.repo}`);
  }
  on(event: string, listener: (payload: never) => void): void {
    // Tracked in `calls` too: registration order relative to checkForUpdates
    // is a real spec §4.2 constraint (an EventEmitter with no "error" listener
    // at the time of emission throws it as uncaught), and it must be provable
    // from a call log, not just "the source reads top to bottom".
    this.calls.push(`on:${event}`);
    const arr = this.listeners.get(event) ?? [];
    arr.push(listener as (payload: unknown) => void);
    this.listeners.set(event, arr);
  }
  checkForUpdates(): Promise<unknown> {
    this.calls.push("checkForUpdates");
    return this.checkResult;
  }
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.calls.push(`quitAndInstall:${isSilent}:${isForceRunAfter}`);
  }
  /** Test driver: emit an electron-updater event. */
  fire(event: string, payload?: unknown): void {
    for (const l of this.listeners.get(event) ?? []) l(payload);
  }
}

describe("evaluateGate", () => {
  it("非 packaged → dev,且优先于其它门(非法 testFeed 也不抛)", () => {
    expect(
      evaluateGate(
        winEnv({
          isPackaged: false,
          platform: "darwin",
          testFeed: "garbage",
        }),
      ),
    ).toEqual({ ok: false, reason: "dev" });
  });

  it("packaged + win32 + 有卸载器 → 放行,生产 feed", () => {
    expect(evaluateGate(winEnv())).toEqual({ ok: true, feed: null });
  });

  it("非 win32 → platform(mac ad-hoc 签名过不了 Squirrel 校验)", () => {
    expect(evaluateGate(winEnv({ platform: "darwin" }))).toEqual({
      ok: false,
      reason: "platform",
    });
  });

  it("win32 但目录里没有卸载器(zip 绿色版)→ portable", () => {
    expect(
      evaluateGate(winEnv({ readDir: () => ["gladlog.exe", "resources"] })),
    ).toEqual({ ok: false, reason: "portable" });
  });

  it("卸载器判据是扫模式:改了 productName 依然认得", () => {
    expect(
      evaluateGate(winEnv({ readDir: () => ["Uninstall gladlog-next.exe"] })),
    ).toEqual({ ok: true, feed: null });
    // 相近但不是 NSIS 卸载器的文件名不许误判为安装版
    expect(
      evaluateGate(
        winEnv({ readDir: () => ["Uninstaller.exe", "unins000.exe"] }),
      ),
    ).toEqual({ ok: false, reason: "portable" });
  });

  it("目录读不出来 → 按 portable 处理,不抛", () => {
    expect(
      evaluateGate(
        winEnv({
          readDir: () => {
            throw new Error("ENOENT");
          },
        }),
      ),
    ).toEqual({ ok: false, reason: "portable" });
  });

  it("testFeed 合法 → 跳过 platform 与 portable 两道门,返回 feed", () => {
    expect(
      evaluateGate(
        winEnv({
          platform: "darwin",
          readDir: () => [],
          testFeed: "mingjianliu/gladlog-update-test",
        }),
      ),
    ).toEqual({
      ok: true,
      feed: { owner: "mingjianliu", repo: "gladlog-update-test" },
    });
  });

  it("testFeed 非法 → 抛错,绝不静默回落到生产 feed", () => {
    for (const bad of ["", "garbage", "owner/", "/repo", "a/b/c"]) {
      expect(() => evaluateGate(winEnv({ testFeed: bad }))).toThrow(
        /GLADLOG_UPDATER_TEST_FEED/,
      );
    }
  });
});

describe("createUpdaterService:门不通过", () => {
  it("disabled 状态带 reason,且从不碰 autoUpdater 的任何成员", () => {
    const backend = new FakeBackend();
    const emitted: UpdateState[] = [];
    const svc = createUpdaterService({
      autoUpdater: backend,
      env: winEnv({ platform: "darwin" }),
      now: () => 1000,
      emit: (s) => emitted.push(s),
      shutdown: () => Promise.resolve(),
      isAutoCheckEnabled: () => true,
    });
    expect(svc.getState()).toEqual({ phase: "disabled", reason: "platform" });
    expect(backend.calls).toEqual([]);
    expect(emitted).toEqual([]);
    svc.dispose();
  });

  it("disabled 下 check/autoCheck/install 都是空操作", async () => {
    const backend = new FakeBackend();
    const shutdown = vi.fn(() => Promise.resolve());
    const svc = createUpdaterService({
      autoUpdater: backend,
      env: winEnv({ isPackaged: false }),
      now: () => 1000,
      emit: () => {},
      shutdown,
      isAutoCheckEnabled: () => true,
    });
    await svc.check();
    await svc.autoCheck();
    await svc.install();
    expect(backend.calls).toEqual([]);
    expect(shutdown).not.toHaveBeenCalled();
    expect(svc.getState()).toEqual({ phase: "disabled", reason: "dev" });
    svc.dispose();
  });
});

describe("createUpdaterService:状态机", () => {
  let backend: FakeBackend;
  let emitted: UpdateState[];
  let shutdown: ReturnType<typeof vi.fn>;
  let svc: ReturnType<typeof createUpdaterService>;
  let autoCheckEnabled: boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    backend = new FakeBackend();
    emitted = [];
    autoCheckEnabled = true;
    shutdown = vi.fn(() => Promise.resolve());
    svc = createUpdaterService({
      autoUpdater: backend,
      env: winEnv(),
      now: () => 1_700_000_000_000,
      emit: (s) => emitted.push(s),
      shutdown: shutdown as unknown as () => Promise<void>,
      isAutoCheckEnabled: () => autoCheckEnabled,
    });
  });
  afterEach(() => {
    svc.dispose();
    vi.useRealTimers();
  });

  it("初始 idle,且配置按设计写死", () => {
    expect(svc.getState()).toEqual({ phase: "idle", lastCheckedAt: null });
    expect(backend.calls).toEqual([
      "set:autoDownload=true",
      "set:autoInstallOnAppQuit=true",
      "set:allowPrerelease=false",
      "set:disableWebInstaller=true",
      "on:checking-for-update",
      "on:update-not-available",
      "on:update-available",
      "on:download-progress",
      "on:update-downloaded",
      "on:error",
    ]);
  });

  it("所有事件监听器(尤其 error)都在两个定时器建立之前注册齐(spec §4.2:EventEmitter 没有 error 监听器时会把失败抛成 uncaught)", () => {
    // Anchored on the FIRST_CHECK_DELAY_MS timer rather than on a later
    // checkForUpdates() call: every path that can reach checkForUpdates
    // (the two timers below, or a manual check() called by whoever holds the
    // returned service) only exists AFTER createUpdaterService() has already
    // returned, so a call-order assertion against checkForUpdates can never
    // fail no matter where inside the constructor the six backend.on(...)
    // calls are placed -- checkForUpdates is always later regardless. The
    // timer construction below is the one synchronous, in-constructor
    // landmark the listeners must precede, so we spy on setTimeout to pin it.
    const localBackend = new FakeBackend();
    const realSetTimeout = globalThis.setTimeout;
    const setTimeoutSpy = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((...args: Parameters<typeof setTimeout>) => {
        localBackend.calls.push("setTimeout");
        return realSetTimeout(...args);
      });
    try {
      const local = createUpdaterService({
        autoUpdater: localBackend,
        env: winEnv(),
        now: () => 1,
        emit: () => {},
        shutdown: () => Promise.resolve(),
        isAutoCheckEnabled: () => true,
      });
      const onEvents = [
        "on:checking-for-update",
        "on:update-not-available",
        "on:update-available",
        "on:download-progress",
        "on:update-downloaded",
        "on:error",
      ];
      const onIndexes = onEvents.map((event) =>
        localBackend.calls.indexOf(event),
      );
      expect(onIndexes.every((i) => i >= 0)).toBe(true);
      const timerIndex = localBackend.calls.indexOf("setTimeout");
      expect(timerIndex).toBeGreaterThan(-1);
      expect(Math.max(...onIndexes)).toBeLessThan(timerIndex);
      local.dispose();
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it("事件序列 → 状态快照", () => {
    backend.fire("checking-for-update");
    backend.fire("update-available", { version: "0.1.20" });
    backend.fire("download-progress", { percent: 37.4 });
    backend.fire("update-downloaded", { version: "0.1.20" });
    expect(emitted).toEqual([
      { phase: "checking" },
      { phase: "downloading", version: "0.1.20", percent: 0 },
      { phase: "downloading", version: "0.1.20", percent: 37 },
      { phase: "ready", version: "0.1.20" },
    ]);
    expect(svc.getState()).toEqual({ phase: "ready", version: "0.1.20" });
  });

  it("update-not-available → idle 带上次检查时间", () => {
    backend.fire("checking-for-update");
    backend.fire("update-not-available", { version: "0.1.19" });
    expect(svc.getState()).toEqual({
      phase: "idle",
      lastCheckedAt: 1_700_000_000_000,
    });
  });

  it("同一整数百分比不重复推送", () => {
    backend.fire("update-available", { version: "0.1.20" });
    emitted.length = 0;
    backend.fire("download-progress", { percent: 12.1 });
    backend.fire("download-progress", { percent: 12.4 });
    backend.fire("download-progress", { percent: 13.0 });
    expect(emitted).toEqual([
      { phase: "downloading", version: "0.1.20", percent: 12 },
      { phase: "downloading", version: "0.1.20", percent: 13 },
    ]);
  });

  it("error 事件只落状态,不抛、不弹窗", () => {
    expect(() =>
      backend.fire("error", new Error("net::ERR_CONNECTION_RESET")),
    ).not.toThrow();
    expect(svc.getState()).toEqual({
      phase: "error",
      message: "net::ERR_CONNECTION_RESET",
    });
  });

  it("check() 手动:不看自动检查开关", async () => {
    autoCheckEnabled = false;
    await svc.check();
    expect(backend.calls).toContain("checkForUpdates");
  });

  it("autoCheck() 定时:开关关掉就不查", async () => {
    autoCheckEnabled = false;
    await svc.autoCheck();
    expect(backend.calls).not.toContain("checkForUpdates");
  });

  it("checkForUpdates reject 不冒泡(双通道里 promise 那半由 catch 吞掉)", async () => {
    backend.checkResult = Promise.reject(new Error("ENOTFOUND"));
    await expect(svc.check()).resolves.toBeUndefined();
  });

  it("启动后 30s 首检,之后每 4h 一次;dispose 后不再检查", async () => {
    expect(backend.calls).not.toContain("checkForUpdates");
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    expect(backend.calls.filter((c) => c === "checkForUpdates")).toHaveLength(
      1,
    );
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(backend.calls.filter((c) => c === "checkForUpdates")).toHaveLength(
      2,
    );
    svc.dispose();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 3);
    expect(backend.calls.filter((c) => c === "checkForUpdates")).toHaveLength(
      2,
    );
  });

  it("install():未 ready 时什么都不做", async () => {
    await svc.install();
    expect(shutdown).not.toHaveBeenCalled();
    expect(backend.calls.some((c) => c.startsWith("quitAndInstall"))).toBe(
      false,
    );
  });

  it("install():shutdown 必须 resolve 之后才起安装器(顺序断言)", async () => {
    const order: string[] = [];
    let releaseShutdown!: () => void;
    const gated = createUpdaterService({
      autoUpdater: backend,
      env: winEnv(),
      now: () => 1,
      emit: () => {},
      shutdown: () =>
        new Promise<void>((res) => {
          order.push("shutdown-start");
          releaseShutdown = res;
        }),
      isAutoCheckEnabled: () => true,
    });
    backend.fire("update-downloaded", { version: "0.1.20" });
    const p = gated.install();
    await Promise.resolve();
    expect(order).toEqual(["shutdown-start"]);
    expect(backend.calls.some((c) => c.startsWith("quitAndInstall"))).toBe(
      false,
    );
    releaseShutdown();
    await p;
    expect(backend.calls).toContain("quitAndInstall:true:true");
    gated.dispose();
  });

  it("install():重复调用只跑一条链", async () => {
    backend.fire("update-downloaded", { version: "0.1.20" });
    await Promise.all([svc.install(), svc.install()]);
    await svc.install();
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(
      backend.calls.filter((c) => c.startsWith("quitAndInstall")),
    ).toHaveLength(1);
  });

  /**
   * §4.3: a failed teardown must not strand the user on an old build. The
   * update is already downloaded and sha512-verified at this point; refusing
   * to install it because OBS would not close cleanly trades a small risk for
   * a permanent one.
   */
  it("install():shutdown 抛错也照装,且 install() 自己不 reject", async () => {
    shutdown.mockImplementationOnce(() =>
      Promise.reject(new Error("obs teardown failed")),
    );
    backend.fire("update-downloaded", { version: "0.1.20" });
    await expect(svc.install()).resolves.toBeUndefined();
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(backend.calls).toContain("quitAndInstall:true:true");
  });

  /**
   * BaseUpdater.js:16-25 — when install() returns false (nothing downloaded,
   * spawn failed) quitAndInstall skips its own app.quit() and just resets the
   * flag, returning void either way, so we cannot read the failure. By then
   * shutdown() has already stopped the recorder / worker / AI children and
   * quitLifecycle's phase is "finishing", meaning the next before-quit is let
   * straight through with no cleanup: the app is alive but gutted. Watch the
   * clock instead.
   */
  it("install():安装器没接管(10s 后进程还活着)→ 落 error,且不会 spawn 第二个", async () => {
    backend.fire("update-downloaded", { version: "0.1.20" });
    await svc.install();
    expect(backend.calls).toContain("quitAndInstall:true:true");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(svc.getState()).toEqual({
      phase: "error",
      message: "更新安装器未能接管,请手动退出 gladlog 后重新打开",
    });
    expect(emitted.at(-1)).toEqual(svc.getState());

    // The latch stays shut on purpose: if the installer DID spawn and only the
    // quit got blocked, a retry would run two installers over one directory.
    await svc.install();
    expect(
      backend.calls.filter((c) => c.startsWith("quitAndInstall")),
    ).toHaveLength(1);
  });

  /**
   * Review round 1 gap (mutation testing, not caught by the test above): the
   * watchdog test only ever calls install() again while phase is still
   * "error", so state.phase !== "ready" alone is enough to short-circuit the
   * retry -- `installing` never actually gets exercised as the guard. The
   * real threat is a later autoCheck() landing (the two timers were never
   * disposed here, because no before-quit ever fired) and pushing phase back
   * to "ready" out from under the watchdog's error. Only the latch stands
   * between that and a second installer over the same directory.
   */
  it("install():界面语言为 en 时看门狗的报错是英文", async () => {
    svc.dispose();
    svc = createUpdaterService({
      autoUpdater: backend,
      env: winEnv(),
      now: () => 1_700_000_000_000,
      emit: (s) => emitted.push(s),
      shutdown: shutdown as unknown as () => Promise<void>,
      isAutoCheckEnabled: () => autoCheckEnabled,
      getLanguage: () => "en",
    });
    backend.fire("update-downloaded", { version: "0.1.20" });
    await svc.install();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(svc.getState()).toEqual({
      phase: "error",
      message:
        "The update installer did not take over. Quit gladlog manually, then open it again.",
    });
  });

  it("install():看门狗落 error 后即使 phase 被顶回 ready,闩锁依旧不放开", async () => {
    backend.fire("update-downloaded", { version: "0.1.20" });
    await svc.install();
    expect(backend.calls).toContain("quitAndInstall:true:true");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(svc.getState()).toEqual({
      phase: "error",
      message: "更新安装器未能接管,请手动退出 gladlog 后重新打开",
    });

    // A later check (autoCheck's poll timer, in production) lands and pushes
    // phase back to "ready" -- the watchdog itself is long gone by now.
    backend.fire("update-downloaded", { version: "0.1.21" });
    expect(svc.getState()).toEqual({ phase: "ready", version: "0.1.21" });

    await svc.install();
    expect(
      backend.calls.filter((c) => c.startsWith("quitAndInstall")),
    ).toHaveLength(1);
  });

  /**
   * Review round 1 gap (mutation testing): deleting the two dispose() lines
   * that clear installWatchdog left all 25 tests green, because afterEach's
   * vi.useRealTimers() discards any pending fake-timer callback regardless of
   * whether it was ever clearTimeout'd. Advancing the fake clock INSIDE the
   * test body (before afterEach touches real timers) is the only way to prove
   * dispose() actually disarms it.
   */
  it("dispose() 清掉未触发的看门狗,之后推时钟不会再落 error", async () => {
    backend.fire("update-downloaded", { version: "0.1.20" });
    await svc.install();
    expect(backend.calls).toContain("quitAndInstall:true:true");
    emitted.length = 0;

    svc.dispose();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(emitted).toEqual([]);
    expect(svc.getState()).toEqual({ phase: "ready", version: "0.1.20" });
  });
});
