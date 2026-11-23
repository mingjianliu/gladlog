// @vitest-environment jsdom
// Task 5 (§6.9 check 5): the app shell, match list and settings page render
// no CJK in English mode. Player-facing data in the fixtures is ASCII, so any
// CJK left in the DOM is UI copy that missed the dictionary.
import { CJK_LEAK } from "@gladlog/analysis/src/utils/localizedText";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StoredMatchMeta } from "../src/main/matchStore";
import type { UpdateState } from "../src/main/updater";
import App from "../src/renderer/src/App";
import { BatchAnalyzeBar } from "../src/renderer/src/components/BatchAnalyzeBar";
import { ImportButton } from "../src/renderer/src/components/ImportButton";
import { SettingsPanel } from "../src/renderer/src/components/SettingsPanel";
import { UpdateBanner } from "../src/renderer/src/components/UpdateBanner";
import { LangProvider } from "../src/renderer/src/i18n/LangProvider";

const NOW = Date.now();

const metas: StoredMatchMeta[] = [
  {
    id: "m-today",
    kind: "match",
    bracket: "3v3",
    zoneId: "1505",
    startTime: NOW - 60_000,
    endTime: NOW,
    result: "win",
    storedAt: 1,
    durationS: 145,
    avgRating: 2500,
    teams: [
      [
        { specId: 105, classId: 11 },
        { specId: 71, classId: 1 },
      ],
      [{ specId: 64, classId: 8 }],
    ],
  },
  {
    id: "m-old",
    kind: "shuffle",
    bracket: "Rated Solo Shuffle",
    zoneId: "1505",
    startTime: NOW - 20 * 86_400_000,
    endTime: NOW - 20 * 86_400_000 + 600_000,
    result: "loss",
    storedAt: 2,
  },
];

const baseSettings: Record<string, unknown> = {
  wowDirectory: "/wow",
  anthropicApiKey: null,
  deepseekApiKey: null,
  aiModels: {},
  aiBackend: "anthropic",
  aiBackendCommand: null,
  language: "en",
  autoAnalyzeNew: false,
  aiSelfReview: false,
  autoCheckUpdates: true,
  uiZoom: 1,
  recordingEnabled: true,
  obsWebsocketUrl: null,
  obsWebsocketPassword: null,
  recordingKeepCount: 50,
  recordingMode: "managed",
  recordingDirectory: null,
  managedDesktopAudioDevice: "default",
  managedMicDevice: "gone-device",
};

function install(
  over: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) {
  const state = { ...baseSettings, ...over };
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
    matches: {
      page: vi.fn(async () => metas),
      get: vi.fn(async () => null),
      list: vi.fn(),
    },
    logs: {
      onMatchStored: () => () => {},
      onImportProgress: () => () => {},
    },
    analysis: { listAnalyzed: async () => [] },
    ai: { detectCli: async () => ({ path: null }) },
    recorder: {
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
      listAudioDevices: async () => ({
        output: [{ id: "spk", name: "Speakers" }],
        input: [],
      }),
    },
    ...extra,
  };
}

/** Visible text plus the attribute copy a user can still read or hear. */
function leaks(root: Element): string[] {
  const out: string[] = [];
  const clone = root.cloneNode(true) as Element;
  // The language row is bilingual by design (§6.11b): "语言 / Language" and
  // each option's endonym.
  clone.querySelector('[data-testid="settings-language"]')?.remove();
  if (CJK_LEAK.test(clone.textContent ?? ""))
    out.push(`text: ${clone.textContent}`);
  for (const el of clone.querySelectorAll("*")) {
    for (const a of ["title", "aria-label", "placeholder", "alt"]) {
      const v = el.getAttribute(a);
      if (v && CJK_LEAK.test(v)) out.push(`${a}: ${v}`);
    }
  }
  return out;
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { __gladlogFixture?: unknown }).__gladlogFixture;
});

describe("英文模式:应用外壳与对局列表不漏中文", () => {
  it("对局列表 + 筛选 + 批量栏 + 顶栏", async () => {
    install();
    const { container } = render(
      <LangProvider>
        <App />
      </LangProvider>,
    );
    await screen.findByText("Select a match");
    await waitFor(() =>
      expect(container.querySelectorAll(".mlr").length).toBe(2),
    );
    const text = container.textContent ?? "";
    for (const s of [
      "Matches",
      "Statistics",
      "Settings",
      "Batch AI analysis",
      "Skip analyzed",
      "Today",
      "1 match · 1-0",
      "All brackets",
    ])
      expect(text).toContain(s);
    expect(leaks(container)).toEqual([]);
  });

  it("首启引导", async () => {
    install(
      { wowDirectory: null },
      {
        matches: {
          page: vi.fn(async () => []),
          get: vi.fn(async () => null),
          list: vi.fn(),
        },
      },
    );
    const { container } = render(
      <LangProvider>
        <App />
      </LangProvider>,
    );
    await screen.findByText("Welcome to gladlog");
    expect(screen.getByText("Import historical logs…")).toBeTruthy();
    expect(leaks(container)).toEqual([]);
  });

  it("批量栏:勾选模式", async () => {
    install();
    const { container } = render(
      <LangProvider>
        <BatchAnalyzeBar metas={metas} selected={new Set(["m-today"])} />
      </LangProvider>,
    );
    await screen.findByText("Analyze 1 checked match");
    expect(container.textContent).toContain("1 match checked");
    expect(leaks(container)).toEqual([]);
  });

  it("导入按钮:进度与小结", async () => {
    let progress: ((p: unknown) => void) | null = null;
    install(
      {},
      {
        logs: {
          onMatchStored: () => () => {},
          onImportProgress: (cb: (p: unknown) => void) => {
            progress = cb;
            return () => {};
          },
        },
      },
    );
    const { container } = render(
      <LangProvider>
        <ImportButton />
      </LangProvider>,
    );
    await screen.findByText("Import historical logs…");
    act(() =>
      progress?.({ i: 2, n: 5, file: "WoWCombatLog.txt", stored: 3, dup: 1 }),
    );
    expect(container.textContent).toContain(
      "Parsing 2/5: WoWCombatLog.txt (3 new, 1 duplicate)",
    );
    expect(leaks(container)).toEqual([]);
  });
});

describe("英文模式:设置页不漏中文(语言行除外)", () => {
  const variants: Array<[string, Record<string, unknown>]> = [
    ["托管 OBS 已安装 + Anthropic", {}],
    [
      "自有 OBS + Claude CLI(未检测到)",
      { recordingMode: "external", aiBackend: "claudeCli" },
    ],
    ["DeepSeek", { aiBackend: "deepseek" }],
    ["agy", { aiBackend: "agy" }],
  ];
  for (const [name, over] of variants) {
    it(name, async () => {
      install(over, {
        update: {
          getState: async (): Promise<UpdateState> => ({
            phase: "idle",
            lastCheckedAt: NOW - 3 * 3_600_000,
          }),
          check: async () => {},
          install: async () => {},
          onState: () => () => {},
        },
      });
      const { container } = render(
        <LangProvider>
          <SettingsPanel />
        </LangProvider>,
      );
      await screen.findByText("Settings");
      await screen.findByText("Not connected");
      await waitFor(() =>
        expect(container.textContent).toContain("Last checked: 3 hours ago"),
      );
      expect(leaks(container)).toEqual([]);
    });
  }

  it("模型下拉的标注走词典(DeepSeek)", async () => {
    install({ aiBackend: "deepseek" });
    render(
      <LangProvider>
        <SettingsPanel />
      </LangProvider>,
    );
    const select = (await screen.findByRole("combobox", {
      name: "Model",
    })) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "DeepSeek V3 (chat, fast)",
      "DeepSeek R1 (reasoner, slow)",
    ]);
  });

  it("托管 OBS 未安装:下载说明", async () => {
    install(
      {},
      {
        recorder: {
          getStatus: async () => ({
            enabled: false,
            connected: false,
            recording: false,
            lastError: null,
          }),
          onStatus: () => () => {},
          getObsInstallState: async () => ({
            installed: false,
            platformSupported: true,
          }),
          onInstallProgress: () => () => {},
        },
      },
    );
    const { container } = render(
      <LangProvider>
        <SettingsPanel />
      </LangProvider>,
    );
    await screen.findByText("Download and enable");
    expect(container.textContent).toMatch(
      /downloads OBS Studio \(about \d+ MB, from the official obsproject release page, GPL-2\.0\)\./,
    );
    expect(leaks(container)).toEqual([]);
  });
});

describe("英文模式:更新横幅", () => {
  it("新版就绪横幅", async () => {
    install(
      {},
      {
        update: {
          getState: async (): Promise<UpdateState> => ({
            phase: "ready",
            version: "1.2.3",
          }),
          check: async () => {},
          install: async () => {},
          onState: () => () => {},
        },
      },
    );
    const { container } = render(
      <LangProvider>
        <UpdateBanner />
      </LangProvider>,
    );
    await screen.findByText("Version 1.2.3 is ready");
    expect(screen.getByRole("button", { name: "Restart now" })).toBeTruthy();
    expect(leaks(container)).toEqual([]);
  });
});
