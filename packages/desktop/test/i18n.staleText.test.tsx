// @vitest-environment jsdom
// Outcome text kept in React state must follow a language switch (codex B3
// fix 2): components store the outcome (kind + numbers, or main's raw error)
// and word it with `t` at render time. Each case renders in zh, produces the
// outcome, switches to en through the provider, and expects the en wording.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DevPanel } from "../src/renderer/src/components/DevPanel";
import { ImportButton } from "../src/renderer/src/components/ImportButton";
import { ManagedObsPrefsRows } from "../src/renderer/src/components/ManagedObsPrefsRows";
import { SettingsPanel } from "../src/renderer/src/components/SettingsPanel";
import { LangProvider, useT } from "../src/renderer/src/i18n/LangProvider";

/** Switches the UI language through the provider, like the settings row. */
function ToEnglish() {
  const { setLang } = useT();
  return (
    <button data-testid="to-en" onClick={() => void setLang("en")}>
      en
    </button>
  );
}

async function switchToEnglish() {
  await act(async () => {
    fireEvent.click(screen.getByTestId("to-en"));
  });
}

const baseSettings: Record<string, unknown> = {
  wowDirectory: "/wow",
  anthropicApiKey: null,
  deepseekApiKey: null,
  aiModels: {},
  aiBackend: "anthropic",
  aiBackendCommand: null,
  language: "zh",
  autoAnalyzeNew: false,
  aiSelfReview: false,
  autoCheckUpdates: true,
  uiZoom: 1,
  recordingEnabled: true,
  obsWebsocketUrl: null,
  obsWebsocketPassword: null,
  recordingKeepCount: 50,
  recordingMode: "external",
  recordingDirectory: null,
  managedDesktopAudioDevice: null,
  managedMicDevice: null,
};

function install(extra: Record<string, unknown> = {}) {
  const state = { ...baseSettings };
  (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
    settings: {
      get: vi.fn(async () => ({ ...state })),
      save: vi.fn(async (p: Record<string, unknown>) => {
        Object.assign(state, p);
        return { ...state };
      }),
    },
    app: {
      selectDirectory: async () => null,
      getVersion: async () => "9.9.9",
      openExternal: async () => {},
    },
    ai: { detectCli: async () => ({ path: null }) },
    ...extra,
  };
}

const recorderBase = {
  getStatus: async () => ({
    enabled: true,
    connected: false,
    recording: false,
    lastError: null,
  }),
  onStatus: () => () => {},
  getObsInstallState: async () => ({
    installed: true,
    platformSupported: true,
  }),
  onInstallProgress: () => () => {},
  listAudioDevices: async () => ({ output: [], input: [] }),
};

afterEach(() => {
  cleanup();
  delete (window as unknown as { __gladlogFixture?: unknown }).__gladlogFixture;
});

describe("切换语言后,state 里的结果文案跟着换", () => {
  it("导入按钮:完成小结", async () => {
    install({
      logs: {
        onMatchStored: () => () => {},
        onImportProgress: () => () => {},
        importFiles: async () => ({ files: 1, stored: 0, dup: 0, failed: 0 }),
      },
    });
    const { container } = render(
      <LangProvider>
        <ToEnglish />
        <ImportButton />
      </LangProvider>,
    );
    fireEvent.click(await screen.findByText("导入历史日志…"));
    await waitFor(() =>
      expect(container.querySelector(".import-progress")?.textContent).toBe(
        "完成:1 个文件,新入库 0 场,重复跳过 0",
      ),
    );
    await switchToEnglish();
    expect(container.querySelector(".import-progress")?.textContent).toBe(
      "Done: 1 file, 0 matches added, 0 duplicates skipped",
    );
  });

  it("导入按钮:main 抛出的原始错误照原样保留", async () => {
    install({
      logs: {
        onMatchStored: () => () => {},
        onImportProgress: () => () => {},
        importFiles: async () => {
          throw new Error("disk gone");
        },
      },
    });
    const { container } = render(
      <LangProvider>
        <ToEnglish />
        <ImportButton />
      </LangProvider>,
    );
    fireEvent.click(await screen.findByText("导入历史日志…"));
    await waitFor(() =>
      expect(container.querySelector(".import-progress")?.textContent).toBe(
        "导入失败:disk gone",
      ),
    );
    await switchToEnglish();
    expect(container.querySelector(".import-progress")?.textContent).toBe(
      "Import failed: disk gone",
    );
  });

  it("设置页:自有 OBS 测试连接成功", async () => {
    install({
      recorder: {
        ...recorderBase,
        testConnection: async () => ({ ok: true }),
      },
    });
    render(
      <LangProvider>
        <ToEnglish />
        <SettingsPanel />
      </LangProvider>,
    );
    fireEvent.click(await screen.findByText("测试连接"));
    await screen.findByText("✓ 连接成功");
    await switchToEnglish();
    await screen.findByText("✓ Connected");
    expect(screen.queryByText("✓ 连接成功")).toBeNull();
  });

  it("设置页:自动检测未找到配置;连接失败的原始错误照原样", async () => {
    install({
      recorder: {
        ...recorderBase,
        autoConfig: async () => ({ found: false, enabled: false, ok: false }),
        testConnection: async () => ({ ok: false, error: "ECONNREFUSED" }),
      },
    });
    render(
      <LangProvider>
        <ToEnglish />
        <SettingsPanel />
      </LangProvider>,
    );
    fireEvent.click(await screen.findByText("自动检测 OBS"));
    await screen.findByText("✗ 未找到本机 OBS 配置(装了 OBS 28+ 吗?)");
    await switchToEnglish();
    await screen.findByText(
      "✗ No OBS config found on this machine (is OBS 28+ installed?)",
    );
    fireEvent.click(screen.getByText("Test connection"));
    await screen.findByText("✗ ECONNREFUSED");
  });

  it("设置页:自动检测连接失败 + 鉴权未知:原始错误照原样,提示按当前语言渲染(codex B3fix#2)", async () => {
    install({
      recorder: {
        ...recorderBase,
        autoConfig: async () => ({
          found: true,
          enabled: true,
          ok: false,
          error: "ECONNREFUSED",
          authUnknown: true,
        }),
      },
    });
    render(
      <LangProvider>
        <ToEnglish />
        <SettingsPanel />
      </LangProvider>,
    );
    fireEvent.click(await screen.findByText("自动检测 OBS"));
    await screen.findByText(
      "✗ ECONNREFUSED;OBS 鉴权状态未知(配置字段缺失或格式有变),可能需要密码;已尝试携带读到的密码连接",
    );
    await switchToEnglish();
    await screen.findByText(
      "✗ ECONNREFUSED;OBS authentication state unknown (a config field is missing or its format changed), so a password may be needed; tried connecting with the password that was found",
    );
  });

  it("设置页:托管 OBS 安装失败(没有原始错误时的通用文案)", async () => {
    install({
      recorder: {
        ...recorderBase,
        getObsInstallState: async () => ({
          installed: false,
          platformSupported: true,
        }),
        installObs: async () => ({ ok: false }),
      },
    });
    const state = (
      window as unknown as {
        __gladlogFixture: { settings: { get: () => Promise<unknown> } };
      }
    ).__gladlogFixture;
    const get = state.settings.get;
    state.settings.get = async () => ({
      ...((await get()) as object),
      recordingMode: "managed",
    });
    const { container } = render(
      <LangProvider>
        <ToEnglish />
        <SettingsPanel />
      </LangProvider>,
    );
    fireEvent.click(await screen.findByText("下载并启用"));
    await waitFor(() =>
      expect(container.querySelector(".set-rec-error")?.textContent).toBe(
        "安装失败",
      ),
    );
    await switchToEnglish();
    expect(container.querySelector(".set-rec-error")?.textContent).toBe(
      "Install failed",
    );
  });

  it("托管 OBS:从本机 OBS 导入的结果", async () => {
    install({
      recorder: {
        ...recorderBase,
        importObsPrefs: async () => ({
          found: true,
          applied: { recordingDirectory: "/v", managedMicDevice: "m" },
        }),
      },
    });
    render(
      <LangProvider>
        <ToEnglish />
        <ManagedObsPrefsRows
          settings={{
            recordingDirectory: null,
            managedDesktopAudioDevice: null,
            managedMicDevice: null,
          }}
          save={async () => {}}
          reload={async () => {}}
        />
      </LangProvider>,
    );
    fireEvent.click(await screen.findByText("从本机 OBS 导入"));
    await screen.findByText(
      "✓ 已导入 录像目录、麦克风;已保存,托管 OBS 重启后生效(正在录制则本场结束后自动重启)",
    );
    await switchToEnglish();
    await screen.findByText(
      "✓ Imported recording folder, microphone; Saved; takes effect when the managed OBS restarts (if it is recording, it restarts automatically after this match)",
    );
  });

  it("开发者面板:重新解析的结果提示", async () => {
    install({
      matches: {
        list: async () => [
          {
            id: "m1",
            kind: "match",
            bracket: "3v3",
            zoneId: "1505",
            startTime: 1_700_000_000_000,
            endTime: 1_700_000_300_000,
            result: "win",
            storedAt: 1,
          },
        ],
        page: async () => [],
        get: async () => ({ data: { a: 1 } }),
        reparse: async () => ({ ok: true }),
        openDir: async () => true,
      },
    });
    render(
      <LangProvider>
        <ToEnglish />
        <DevPanel initialZone="inspect" />
      </LangProvider>,
    );
    fireEvent.click((await screen.findAllByTestId("dev-match-row"))[0]!);
    fireEvent.click(await screen.findByTestId("dev-reparse"));
    await waitFor(() =>
      expect(screen.getByTestId("dev-action-note").textContent).toBe(
        "已重新解析并回填 meta",
      ),
    );
    await switchToEnglish();
    expect(screen.getByTestId("dev-action-note").textContent).toBe(
      "Re-parsed; meta backfilled",
    );
  });
});
