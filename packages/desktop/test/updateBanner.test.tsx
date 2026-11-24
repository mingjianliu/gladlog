// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import type { UpdateState } from "../src/main/updater";
import { UpdateBanner } from "../src/renderer/src/components/UpdateBanner";

// The batch driver is a module singleton with no public setter; mock it whole
// so "analysis in flight" is drivable from the test. Production code keeps
// importing the real module — same approach as autoAnalyze.test.ts:10-27
// (that file exposes a `__setRunning` knob inside the factory; here the state
// is hoisted into the test scope instead, which is equivalent).
const batch = vi.hoisted(() => ({
  running: false,
  subs: new Set<() => void>(),
}));
vi.mock("../src/renderer/src/batch/batchAnalysis", () => ({
  getBatchStatus: () => ({
    running: batch.running,
    total: 0,
    done: 0,
    ok: 0,
    skipped: 0,
    failed: 0,
    currentLabels: [],
    cancelled: false,
    finishedAt: null,
  }),
  subscribeBatch: (cb: () => void) => {
    batch.subs.add(cb);
    return () => batch.subs.delete(cb);
  },
}));
const setBatchRunning = (v: boolean) =>
  act(() => {
    batch.running = v;
    for (const cb of [...batch.subs]) cb();
  });

type Stub = {
  state: UpdateState;
  recording?: boolean;
  version?: string;
  lastSeenVersion?: string | null;
  /** omit the whole update surface (old stubs / fixture preview) */
  noUpdateSurface?: boolean;
};

function mockBridge(s: Stub) {
  const install = vi.fn(async () => {});
  const check = vi.fn(async () => {});
  const openExternal = vi.fn(async (_url: string) => {});
  const save = vi.fn(async (p: Record<string, unknown>) => ({ ...p }));
  let pushState: ((u: UpdateState) => void) | null = null;
  let pushRecorder: ((r: { recording: boolean }) => void) | null = null;
  (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
    ...(s.noUpdateSurface
      ? {}
      : {
          update: {
            getState: async () => s.state,
            check,
            install,
            onState: (cb: (u: UpdateState) => void) => {
              pushState = cb;
              return () => {
                pushState = null;
              };
            },
          },
        }),
    recorder: {
      getStatus: async () => ({
        enabled: true,
        connected: true,
        recording: s.recording ?? false,
        lastError: null,
      }),
      onStatus: (cb: (r: { recording: boolean }) => void) => {
        pushRecorder = cb;
        return () => {
          pushRecorder = null;
        };
      },
    },
    app: {
      getVersion: async () => s.version ?? "0.1.20",
      openExternal,
    },
    settings: {
      get: async () => ({
        // NOT `??`: the tests must be able to pass null explicitly (a fresh
        // install), and `??` would fold null back into the default.
        lastSeenVersion:
          s.lastSeenVersion === undefined ? "0.1.20" : s.lastSeenVersion,
      }),
      save,
    },
  };
  return {
    install,
    check,
    openExternal,
    save,
    emit: (u: UpdateState) => act(() => pushState?.(u)),
    emitRecording: (recording: boolean) =>
      act(() => pushRecorder?.({ recording })),
  };
}

beforeEach(() => {
  batch.running = false;
  batch.subs.clear();
});

describe("UpdateBanner:三态渲染(spec §4.5)", () => {
  it("idle / checking / error / disabled → 什么都不渲染", async () => {
    const silent: UpdateState[] = [
      { phase: "idle", lastCheckedAt: null },
      { phase: "checking" },
      { phase: "error", message: "net::ERR_TIMED_OUT" },
      { phase: "disabled", reason: "portable" },
    ];
    for (const state of silent) {
      mockBridge({ state });
      const { container, unmount } = render(<UpdateBanner />);
      await act(async () => {});
      expect(container.textContent).toBe("");
      unmount();
    }
  });

  it("downloading → 导航条一行细字,不出按钮", async () => {
    mockBridge({
      state: { phase: "downloading", version: "0.1.20", percent: 37.4 },
    });
    render(<UpdateBanner />);
    expect(await screen.findByText("正在下载 0.1.20 · 37%")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("ready → 横幅 + 立即重启调 install 一次", async () => {
    const { install } = mockBridge({
      state: { phase: "ready", version: "0.1.20" },
    });
    render(<UpdateBanner />);
    expect(await screen.findByText("新版 0.1.20 已就绪")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "立即重启" }));
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("稍后 → 横幅收起、退化成常驻小按钮;点小按钮横幅回来", async () => {
    mockBridge({ state: { phase: "ready", version: "0.1.20" } });
    render(<UpdateBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "稍后" }));
    expect(screen.queryByRole("button", { name: "立即重启" })).toBeNull();
    const chip = screen.getByRole("button", { name: "新版 0.1.20 已就绪" });
    fireEvent.click(chip);
    expect(screen.getByRole("button", { name: "立即重启" })).toBeTruthy();
  });

  it("挂载后收到推送 → 从空到横幅(重开窗口/切页面晚于事件也不丢)", async () => {
    const { emit } = mockBridge({ state: { phase: "checking" } });
    const { container } = render(<UpdateBanner />);
    await act(async () => {});
    expect(container.textContent).toBe("");
    emit({ phase: "ready", version: "0.1.21" });
    expect(screen.getByText("新版 0.1.21 已就绪")).toBeTruthy();
  });

  it("桩没有 update 面 → 不崩、不渲染", async () => {
    mockBridge({
      state: { phase: "ready", version: "0.1.20" },
      noUpdateSurface: true,
    });
    const { container } = render(<UpdateBanner />);
    await act(async () => {});
    expect(container.textContent).toBe("");
  });
});

describe("UpdateBanner:忙时禁用重启(spec §4.5,判据不新造)", () => {
  it("正在录像 → 立即重启禁用 + 换文案,点不动 install", async () => {
    const { install } = mockBridge({
      state: { phase: "ready", version: "0.1.20" },
      recording: true,
    });
    render(<UpdateBanner />);
    const btn = await screen.findByRole("button", { name: "立即重启" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("正在录制,退出时会自动更新")).toBeTruthy();
    fireEvent.click(btn);
    expect(install).not.toHaveBeenCalled();
  });

  it("录像状态推送变化 → 停录后立即重启恢复可用", async () => {
    const { emitRecording } = mockBridge({
      state: { phase: "ready", version: "0.1.20" },
      recording: true,
    });
    render(<UpdateBanner />);
    const btn = await screen.findByRole("button", { name: "立即重启" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    emitRecording(false);
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("批量分析在飞 → 立即重启禁用 + 换文案;跑完自动恢复", async () => {
    mockBridge({ state: { phase: "ready", version: "0.1.20" } });
    render(<UpdateBanner />);
    const btn = await screen.findByRole("button", { name: "立即重启" });
    setBatchRunning(true);
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("正在分析,退出时会自动更新")).toBeTruthy();
    setBatchRunning(false);
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("UpdateBanner:更新后留痕(spec §4.7,判据在 updateBridge)", () => {
  it("版本与 lastSeenVersion 不等 → 显示留痕;点开跳 release 页并写回", async () => {
    const { openExternal, save } = mockBridge({
      state: { phase: "idle", lastCheckedAt: null },
      version: "0.1.21",
      lastSeenVersion: "0.1.20",
    });
    render(<UpdateBanner />);
    const link = await screen.findByRole("button", {
      name: "已更新到 0.1.21 · 更新内容",
    });
    fireEvent.click(link);
    expect(openExternal).toHaveBeenCalledWith(
      "https://github.com/mingjianliu/gladlog/releases/tag/v0.1.21",
    );
    expect(save).toHaveBeenCalledWith({ lastSeenVersion: "0.1.21" });
    expect(
      screen.queryByRole("button", { name: "已更新到 0.1.21 · 更新内容" }),
    ).toBeNull();
  });

  it("关掉留痕也写回 lastSeenVersion", async () => {
    const { save, openExternal } = mockBridge({
      state: { phase: "idle", lastCheckedAt: null },
      version: "0.1.21",
      lastSeenVersion: "0.1.20",
    });
    render(<UpdateBanner />);
    fireEvent.click(
      await screen.findByRole("button", { name: "关闭更新提示" }),
    );
    expect(save).toHaveBeenCalledWith({ lastSeenVersion: "0.1.21" });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("lastSeenVersion 为 null(首次安装/旧版升上来)→ 静默写回,不显示留痕", async () => {
    const { save } = mockBridge({
      state: { phase: "idle", lastCheckedAt: null },
      version: "0.1.21",
      lastSeenVersion: null,
    });
    const { container } = render(<UpdateBanner />);
    await act(async () => {});
    expect(container.textContent).toBe("");
    expect(save).toHaveBeenCalledWith({ lastSeenVersion: "0.1.21" });
  });

  it("版本与 lastSeenVersion 相同 → 不渲染、不写盘", async () => {
    const { save } = mockBridge({
      state: { phase: "idle", lastCheckedAt: null },
      version: "0.1.21",
      lastSeenVersion: "0.1.21",
    });
    const { container } = render(<UpdateBanner />);
    await act(async () => {});
    expect(container.textContent).toBe("");
    expect(save).not.toHaveBeenCalled();
  });
});

describe("UpdateBanner:唯一要打扰用户的 error(安装看门狗)", () => {
  it("点过立即重启之后落 error → 顶栏显示原因", async () => {
    const { emit } = mockBridge({
      state: { phase: "ready", version: "0.1.20" },
    });
    render(<UpdateBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "立即重启" }));
    emit({
      phase: "error",
      message: "更新安装器未能接管,请手动退出 gladlog 后重新打开",
    });
    // 判据是「本次会话点过安装」,不是匹配文案:换一条 message 也照样显示
    expect(
      screen.getByText("更新安装器未能接管,请手动退出 gladlog 后重新打开"),
    ).toBeTruthy();
  });

  it("点过立即重启后状态被顶回 ready(main 侧 installing 闩锁不放开)→ 按钮仍是 disabled,不能再点一次", async () => {
    const { emit, install } = mockBridge({
      state: { phase: "ready", version: "0.1.20" },
    });
    render(<UpdateBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "立即重启" }));
    expect(install).toHaveBeenCalledTimes(1);
    // A later autoCheck cycle can push checking → ready again even though
    // main's install() will just return early on a second call (the
    // `installing` latch in src/main/updater.ts is deliberately never
    // released). The renderer must not present a live-looking button.
    emit({ phase: "checking" });
    emit({ phase: "ready", version: "0.1.20" });
    const btn = screen.getByRole("button", { name: "立即重启" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(btn);
    expect(install).toHaveBeenCalledTimes(1);
  });
});
