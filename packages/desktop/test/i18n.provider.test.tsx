// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsPanel } from "../src/renderer/src/components/SettingsPanel";
import {
  formatDateTime,
  formatNumber,
  formatTime,
} from "../src/renderer/src/i18n/format";
import { LangProvider, useT } from "../src/renderer/src/i18n/LangProvider";
import { StructuredAnalysisPanel } from "../src/renderer/src/report/components/StructuredAnalysisPanel";

/** Bridge stub with a mutable settings document (save merges into it). */
function mockBridge(over: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    wowDirectory: null,
    anthropicApiKey: null,
    aiBackend: "anthropic",
    aiBackendCommand: null,
    language: null,
    autoAnalyzeNew: false,
    aiSelfReview: false,
    autoCheckUpdates: true,
    ...over,
  };
  const save = vi.fn(async (partial: Record<string, unknown>) => {
    Object.assign(state, partial);
    return { ...state };
  });
  (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
    settings: { get: async () => ({ ...state }), save },
    app: {
      selectDirectory: async () => null,
      getVersion: async () => "9.9.9",
    },
  };
  return { save, state };
}

function LangProbe() {
  const { lang, t } = useT();
  return (
    <span data-testid="probe">
      {lang}|{t("common.save")}
    </span>
  );
}

const navLang = Object.getOwnPropertyDescriptor(window.navigator, "language");
function setNavigatorLanguage(v: string) {
  Object.defineProperty(window.navigator, "language", {
    value: v,
    configurable: true,
  });
}

beforeEach(() => {
  document.documentElement.lang = "";
});
afterEach(() => {
  if (navLang) Object.defineProperty(window.navigator, "language", navLang);
  else delete (window.navigator as { language?: string }).language;
});

describe("LangProvider / 首启语言选择框(spec §6.3 §6.7)", () => {
  it("language 为 null → 显示双语选择框;点 English 保存 {language:'en'},选择框消失,<html lang> = en", async () => {
    const { save } = mockBridge({ language: null });
    render(
      <LangProvider>
        <LangProbe />
      </LangProvider>,
    );
    expect(await screen.findByText(/选择语言/)).toBeTruthy();
    expect(screen.getByText(/Choose language/)).toBeTruthy();
    // The app is not shown behind the picker.
    expect(screen.queryByTestId("probe")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ language: "en" }));
    expect(await screen.findByTestId("probe")).toBeTruthy();
    expect(screen.getByTestId("probe").textContent).toBe("en|Save");
    expect(screen.queryByText(/Choose language/)).toBeNull();
    expect(document.documentElement.lang).toBe("en");
  });

  it("选择框默认高亮按系统语言(navigator.language)判断的那个", async () => {
    setNavigatorLanguage("zh-TW");
    mockBridge({ language: null });
    const first = render(
      <LangProvider>
        <LangProbe />
      </LangProvider>,
    );
    const zhBtn = await screen.findByRole("button", { name: "中文" });
    expect(zhBtn.className).toMatch(/active/);
    expect(
      screen.getByRole("button", { name: "English" }).className,
    ).not.toMatch(/active/);
    first.unmount();

    setNavigatorLanguage("de-DE");
    mockBridge({ language: null });
    render(
      <LangProvider>
        <LangProbe />
      </LangProvider>,
    );
    const enBtn = await screen.findByRole("button", { name: "English" });
    expect(enBtn.className).toMatch(/active/);
  });

  it("language 为 en → 不显示选择框,useT() 拿到 en", async () => {
    mockBridge({ language: "en" });
    render(
      <LangProvider>
        <LangProbe />
      </LangProvider>,
    );
    expect((await screen.findByTestId("probe")).textContent).toBe("en|Save");
    expect(screen.queryByText(/Choose language/)).toBeNull();
    expect(document.documentElement.lang).toBe("en");
  });

  it("provider 外的 useT():zh、no-op setLang、namesVersion 0", async () => {
    let seen: ReturnType<typeof useT> | null = null;
    function Grab() {
      seen = useT();
      return null;
    }
    render(<Grab />);
    expect(seen!.lang).toBe("zh");
    expect(seen!.namesVersion).toBe(0);
    expect(seen!.t("common.save")).toBe("保存");
    // Nothing to persist to outside a provider: reported as not saved.
    await expect(seen!.setLang("en")).resolves.toBe(false);
  });

  it("首启选择框:保存失败 → 选择框不关、显示一行双语失败提示、高亮所选;再点一次 → 按所选语言进入(仅本次有效)", async () => {
    const { save } = mockBridge({ language: null });
    save.mockRejectedValueOnce(new Error("disk full"));
    save.mockRejectedValueOnce(new Error("disk full"));
    render(
      <LangProvider>
        <LangProbe />
      </LangProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "English" }));
    const notice = await screen.findByTestId("language-picker-save-failed");
    expect(notice.textContent).toBe(
      "语言设置没能保存。再选一次即可进入，只在本次运行有效 / Couldn't save the language setting. Pick again to continue; it will apply to this session only.",
    );
    expect(screen.queryByTestId("probe")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "English" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(await screen.findByTestId("probe")).toBeTruthy();
    expect(screen.getByTestId("probe").textContent).toBe("en|Save");
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("首启选择框:保存成功不显示失败提示", async () => {
    mockBridge({ language: null });
    render(
      <LangProvider>
        <LangProbe />
      </LangProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "中文" }));
    expect(await screen.findByTestId("probe")).toBeTruthy();
    expect(screen.queryByTestId("language-picker-save-failed")).toBeNull();
  });

  it("setLang 返回是否已持久化:save 成功 → true,save 失败 → false", async () => {
    const { save } = mockBridge({ language: "zh" });
    let seen: ReturnType<typeof useT> | null = null;
    function Grab() {
      seen = useT();
      return null;
    }
    render(
      <LangProvider>
        <Grab />
      </LangProvider>,
    );
    await waitFor(() => expect(seen).not.toBeNull());
    await expect(seen!.setLang("en")).resolves.toBe(true);
    save.mockRejectedValueOnce(new Error("disk full"));
    await expect(seen!.setLang("zh")).resolves.toBe(false);
  });

  it("设置页:语言没保存成功 → 显示失败提示而不是「已切换」", async () => {
    const { save } = mockBridge({ language: "zh" });
    save.mockRejectedValueOnce(new Error("disk full"));
    render(
      <LangProvider>
        <SettingsPanel />
      </LangProvider>,
    );
    const section = await screen.findByTestId("settings-language");
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    await waitFor(() =>
      expect(section.textContent).toContain(
        "Couldn't save the language setting",
      ),
    );
    expect(section.querySelector(".settings-saved-failed")).toBeTruthy();
    expect(section.textContent).not.toContain("Language changed");
    expect(section.textContent).not.toContain("✓");
  });

  it("设置页:语言保存成功 → 显示「已切换」", async () => {
    mockBridge({ language: "zh" });
    render(
      <LangProvider>
        <SettingsPanel />
      </LangProvider>,
    );
    const section = await screen.findByTestId("settings-language");
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    await waitFor(() =>
      expect(section.textContent).toContain("✓ Language changed"),
    );
    expect(section.querySelector(".settings-saved-failed")).toBeNull();
  });

  it("设置页点「中文」→ useT().lang 立即变成 zh,不需要重新挂载", async () => {
    const { save } = mockBridge({ language: "en" });
    render(
      <LangProvider>
        <LangProbe />
        <SettingsPanel />
      </LangProvider>,
    );
    const probe = await screen.findByTestId("probe");
    expect(probe.textContent).toBe("en|Save");
    // Label sits at the top of the page, shown in both languages.
    const section = await screen.findByTestId("settings-language");
    expect(section.textContent).toContain("语言 / Language");
    expect(
      screen
        .getByTestId("settings-panel")
        .querySelector("section")
        ?.getAttribute("data-testid"),
    ).toBe("settings-language");
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    // Same probe node: no remount.
    await waitFor(() => expect(probe.textContent).toBe("zh|保存"));
    expect(screen.getByTestId("probe")).toBe(probe);
    expect(save).toHaveBeenCalledWith({ language: "zh" });
    expect(document.documentElement.lang).toBe("zh-CN");
  });
});

describe("AI 卡片不再有语言切换(spec §6.12)", () => {
  it("StructuredAnalysisPanel 里找不到「中文」/「EN」切换按钮", async () => {
    (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
      settings: {
        get: vi.fn().mockResolvedValue({ language: "zh" }),
        save: vi.fn().mockResolvedValue({}),
      },
      analysis: {
        getState: vi.fn().mockResolvedValue({
          cached: null,
          running: false,
          slots: [],
          activeKey: null,
        }),
        run: vi.fn(),
        cancel: vi.fn(),
        onDone: () => () => {},
        onError: () => () => {},
      },
    };
    const { container } = render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as never}
        matchId="m1"
      />,
    );
    await screen.findByRole("button", { name: /AI 分析|正在准备分析数据/ });
    for (const name of ["中文", "EN"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
      expect(screen.queryByLabelText(name)).toBeNull();
    }
    expect(container.querySelector(".rpt-ai-lang")).toBeNull();
  });
});

describe("format.ts", () => {
  it("formatNumber 按语言取 locale,千分位", () => {
    expect(formatNumber(1234567, "en")).toBe("1,234,567");
    expect(formatNumber(1234567, "zh")).toBe("1,234,567");
  });

  it("formatDateTime 与 toLocaleString(locale) 一致(本地时区,不改时区规则)", () => {
    const t = Date.UTC(2026, 10, 23, 15, 4, 5);
    expect(formatDateTime(t, "en")).toBe(new Date(t).toLocaleString("en-US"));
    expect(formatDateTime(t, "zh")).toBe(new Date(t).toLocaleString("zh-CN"));
    const timeOnly = {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    } as const;
    expect(formatDateTime(t, "en", timeOnly)).toBe(
      new Date(t).toLocaleTimeString("en-US"),
    );
  });

  it("formatTime 只出时刻,与 toLocaleTimeString(locale) 一致", () => {
    const t = Date.UTC(2026, 10, 23, 15, 4, 5);
    expect(formatTime(t, "zh")).toBe(new Date(t).toLocaleTimeString("zh-CN"));
    expect(formatTime(t, "en")).toBe(new Date(t).toLocaleTimeString("en-US"));
  });
});
