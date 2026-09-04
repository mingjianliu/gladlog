// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./SettingsPanel";
import { bridge } from "../bridge";

vi.mock("../bridge");

type Settings = Record<string, unknown>;
type InstallState = { installed: boolean; platformSupported: boolean };
type InstallProgress = {
  phase: "downloading" | "verifying" | "extracting" | "done";
  loaded?: number;
  total?: number;
};

const baseSettings: Settings = {
  wowDirectory: null,
  anthropicApiKey: null,
  deepseekApiKey: null,
  aiModels: {},
  aiBackend: "anthropic",
  aiBackendCommand: null,
  aiLanguage: "zh",
  autoAnalyzeNew: false,
  recordingEnabled: false,
  obsWebsocketUrl: null,
  obsWebsocketPassword: null,
  recordingKeepCount: 50,
  recordingMaxBytes: 80 * 1024 ** 3,
  recordingMode: "managed",
  managedWsPassword: null,
  recordingDirectory: null,
  managedDesktopAudioDevice: "default",
  managedMicDevice: null,
};

type AudioDevices = {
  output: Array<{ id: string; name: string }>;
  input: Array<{ id: string; name: string }>;
};

function mountWith(opts: {
  settings?: Settings;
  installState?: InstallState;
  installObs?: () => Promise<{ ok: boolean; error?: string }>;
  onInstallProgress?: (cb: (p: InstallProgress) => void) => () => void;
  audioDevices?: AudioDevices;
  importObsPrefs?: () => Promise<{
    found: boolean;
    applied?: Record<string, unknown>;
  }>;
}) {
  const settings: Settings = { ...baseSettings, ...opts.settings };
  const save = vi.fn(async (partial: Settings) => {
    Object.assign(settings, partial);
    return { ...settings };
  });
  let progressCb: ((p: InstallProgress) => void) | undefined;
  const onInstallProgress =
    opts.onInstallProgress ??
    vi.fn((cb: (p: InstallProgress) => void) => {
      progressCb = cb;
      return () => {};
    });
  const installObs = opts.installObs ?? vi.fn(async () => ({ ok: true }));
  const importObsPrefs =
    opts.importObsPrefs ?? vi.fn(async () => ({ found: false }));
  const selectRecordingDirectory = vi.fn(async () => null);
  (bridge as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    settings: {
      // Reads the live object: the import flow re-fetches after main wrote.
      get: vi.fn(async () => ({ ...settings })),
      save,
    },
    recorder: {
      getStatus: vi.fn().mockResolvedValue({
        enabled: false,
        connected: false,
        recording: false,
        lastError: null,
        sourceActive: null,
      }),
      onStatus: vi.fn().mockReturnValue(() => {}),
      testConnection: vi.fn(),
      autoConfig: vi.fn(),
      getForMatch: vi.fn(),
      getObsInstallState: vi
        .fn()
        .mockResolvedValue(
          opts.installState ?? { installed: false, platformSupported: true },
        ),
      onInstallProgress,
      installObs,
      listAudioDevices: vi
        .fn()
        .mockResolvedValue(opts.audioDevices ?? { output: [], input: [] }),
      importObsPrefs,
      selectRecordingDirectory,
    },
    app: { openExternal: vi.fn() },
  });
  const { container } = render(<SettingsPanel />);
  return {
    save,
    installObs,
    importObsPrefs,
    settings,
    getProgressCb: () => progressCb,
    container,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("SettingsPanel 录像模式(task-6)", () => {
  it("managed + 未安装 → 显示下载按钮(含 MB 数),隐藏一期 WebSocket 表单", async () => {
    const { container } = mountWith({
      installState: { installed: false, platformSupported: true },
    });
    await screen.findByRole("button", { name: /下载并启用/ });
    expect(container.textContent).toMatch(/\d+MB/);
    expect(screen.queryByLabelText("OBS WebSocket 地址")).toBeNull();
  });

  it("managed + 已安装 → 不显示下载按钮,显示已安装说明", async () => {
    mountWith({ installState: { installed: true, platformSupported: true } });
    await screen.findByText(/已安装并自动管理/);
    expect(screen.queryByRole("button", { name: /下载并启用/ })).toBeNull();
  });

  it("external 模式 → 显示一期 WebSocket 表单,隐藏下载相关 UI", async () => {
    mountWith({
      settings: { recordingMode: "external" },
      installState: { installed: false, platformSupported: true },
    });
    await screen.findByLabelText("OBS WebSocket 地址");
    expect(screen.queryByRole("button", { name: /下载并启用/ })).toBeNull();
  });

  it("下载中:onInstallProgress 推送的进度按百分比渲染", async () => {
    const { getProgressCb } = mountWith({
      installState: { installed: false, platformSupported: true },
      installObs: vi.fn(
        () =>
          new Promise<{ ok: boolean; error?: string }>(() => {
            /* never resolves within this test -- we only care about the
             * progress push while "downloading" */
          }),
      ),
    });
    const dl = await screen.findByRole("button", { name: /下载并启用/ });
    fireEvent.click(dl);
    await waitFor(() => expect(getProgressCb()).toBeTruthy());
    act(() => {
      getProgressCb()!({ phase: "downloading", loaded: 50, total: 100 });
    });
    // Anchored on the "下载中" label: a bare /50%/ also matches the UI-zoom
    // group's "150%" button that main added while this branch was open.
    await waitFor(() => expect(screen.getByText(/下载中\s*50%/)).toBeTruthy());
  });

  it("下载失败 → 显示错误原文,按钮文案变重试", async () => {
    mountWith({
      installState: { installed: false, platformSupported: true },
      installObs: vi
        .fn()
        .mockResolvedValue({ ok: false, error: "网络错误 ECONNRESET" }),
    });
    const dl = await screen.findByRole("button", { name: /下载并启用/ });
    fireEvent.click(dl);
    await waitFor(() => expect(screen.getByText(/ECONNRESET/)).toBeTruthy());
    expect(screen.getByRole("button", { name: "重试" }).textContent).toBe(
      "重试",
    );
  });

  it("managed + 已安装 → 三行 prefs:设备下拉列出枚举到的设备 + 不录;目录行默认文案;external 模式不渲染", async () => {
    mountWith({
      installState: { installed: true, platformSupported: true },
      audioDevices: {
        output: [
          { id: "default", name: "默认" },
          { id: "{out}", name: "Speakers" },
        ],
        input: [{ id: "{mic}", name: "Blue Yeti" }],
      },
    });
    const desktop = (await screen.findByLabelText(
      "桌面声音设备",
    )) as HTMLSelectElement;
    await waitFor(() =>
      expect(Array.from(desktop.options).map((o) => o.textContent)).toEqual([
        "系统默认设备",
        "Speakers",
        "不录",
      ]),
    );
    expect(desktop.value).toBe("default");
    const mic = screen.getByLabelText("麦克风设备") as HTMLSelectElement;
    await waitFor(() =>
      expect(Array.from(mic.options).map((o) => o.textContent)).toEqual([
        "系统默认设备",
        "Blue Yeti",
        "不录",
      ]),
    );
    expect(mic.value).toBe("__none__");
    expect(
      screen.getByText(/默认\(应用数据目录下的 recordings 文件夹\)/),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "恢复默认" })).toBeNull();
  });

  it("external 模式 → prefs 行不渲染", async () => {
    mountWith({
      settings: { recordingMode: "external" },
      installState: { installed: true, platformSupported: true },
    });
    await screen.findByLabelText("OBS WebSocket 地址");
    expect(screen.queryByLabelText("桌面声音设备")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /从本机 OBS 导入/ }),
    ).toBeNull();
  });

  it("改麦克风为具体设备 → save({managedMicDevice: id});改桌面声音为不录 → save(null);提示文案说明重启时机", async () => {
    const { save } = mountWith({
      installState: { installed: true, platformSupported: true },
      audioDevices: { output: [], input: [{ id: "{mic}", name: "Blue Yeti" }] },
    });
    const mic = (await screen.findByLabelText(
      "麦克风设备",
    )) as HTMLSelectElement;
    await waitFor(() => expect(mic.options.length).toBe(3));
    fireEvent.change(mic, { target: { value: "{mic}" } });
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({ managedMicDevice: "{mic}" }),
    );
    const desktop = screen.getByLabelText("桌面声音设备") as HTMLSelectElement;
    fireEvent.change(desktop, { target: { value: "__none__" } });
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({ managedDesktopAudioDevice: null }),
    );
    await screen.findByText(/托管 OBS 重启后生效/);
  });

  it("已保存的设备不在枚举列表里(托管 OBS 没在跑 / 设备拔了)→ 仍作为一项显示并保持选中", async () => {
    mountWith({
      settings: { managedDesktopAudioDevice: "{gone}" },
      installState: { installed: true, platformSupported: true },
      audioDevices: { output: [{ id: "{out}", name: "Speakers" }], input: [] },
    });
    const desktop = (await screen.findByLabelText(
      "桌面声音设备",
    )) as HTMLSelectElement;
    await waitFor(() => expect(desktop.options.length).toBe(4));
    expect(desktop.value).toBe("{gone}");
    expect(desktop.selectedOptions[0]!.textContent).toMatch(/已保存的设备/);
  });

  it("目录已设置 → 显示路径 + 恢复默认;点恢复默认 → save({recordingDirectory: null})", async () => {
    const { save } = mountWith({
      settings: { recordingDirectory: "D:\\rec" },
      installState: { installed: true, platformSupported: true },
    });
    await screen.findByText("D:\\rec");
    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({ recordingDirectory: null }),
    );
  });

  it("从本机 OBS 导入:found → 重新读设置并列出导入项;未找到 → 提示", async () => {
    const { settings, importObsPrefs } = mountWith({
      installState: { installed: true, platformSupported: true },
      importObsPrefs: vi.fn(async () => {
        Object.assign(settings, {
          recordingDirectory: "E:/obs",
          managedMicDevice: "{mic}",
        });
        return {
          found: true,
          applied: { recordingDirectory: "E:/obs", managedMicDevice: "{mic}" },
        };
      }),
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /从本机 OBS 导入/ }),
    );
    await screen.findByText(/已导入 录像目录、麦克风/);
    expect(importObsPrefs).toHaveBeenCalledTimes(1);
    await screen.findByText("E:/obs");

    mountWith({
      installState: { installed: true, platformSupported: true },
      importObsPrefs: vi.fn(async () => ({ found: false })),
    });
    const buttons = await screen.findAllByRole("button", {
      name: /从本机 OBS 导入/,
    });
    fireEvent.click(buttons[buttons.length - 1]!);
    await screen.findByText(/未找到本机 OBS 配置/);
  });

  it("非 win32:managed 选项禁用 + 说明文案;选中态落在 external,即便存储的默认值仍是 managed(复核 NEW-7)", async () => {
    mountWith({
      settings: { recordingMode: "managed" }, // stored default, untouched
      installState: { installed: false, platformSupported: false },
    });
    await screen.findByText("托管录像仅支持 Windows");
    const managedBtn = screen.getByRole("radio", {
      name: "自动下载并管理 OBS,无需安装",
    });
    const externalBtn = screen.getByRole("radio", {
      name: "使用我自己的 OBS",
    });
    expect((managedBtn as HTMLButtonElement).disabled).toBe(true);
    expect(managedBtn.className).not.toContain("active");
    expect(externalBtn.className).toContain("active");
    // And the external-only form is what actually renders (effective mode).
    await screen.findByLabelText("OBS WebSocket 地址");
  });
});
