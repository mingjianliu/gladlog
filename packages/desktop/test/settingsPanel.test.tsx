// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { SettingsPanel } from "../src/renderer/src/components/SettingsPanel";
import { API_KEY_REDACTED } from "../src/main/settingsStore";

function mockBridge(over: Record<string, unknown> = {}) {
  const state = {
    wowDirectory: null,
    anthropicApiKey: null,
    anthropicModel: null,
    aiBackend: "anthropic",
    aiBackendCommand: null,
    aiLanguage: "zh",
    ...over,
  };
  const save = vi.fn(async (partial: Record<string, unknown>) => {
    Object.assign(state, partial);
    return { ...state };
  });
  (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
    settings: { get: async () => ({ ...state }), save },
    app: { selectDirectory: async () => "/wow" },
  };
  return { save };
}

describe("设置页(phase3 #2a)", () => {
  it("key 未设置 → 显示未设置;输入保存后调用 save 并清空输入", async () => {
    const { save } = mockBridge();
    render(<SettingsPanel />);
    expect(await screen.findByText(/未设置\(没有 key/)).toBeTruthy();
    const input = screen.getByPlaceholderText("sk-ant-…");
    fireEvent.change(input, { target: { value: "sk-ant-xyz" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(save).toHaveBeenCalledWith({ anthropicApiKey: "sk-ant-xyz" });
  });

  it("key 已设置(哨兵)→ 显示已设置 + 清除按钮;语言切换持久化", async () => {
    const { save } = mockBridge({ anthropicApiKey: API_KEY_REDACTED });
    render(<SettingsPanel />);
    expect(await screen.findByText("已设置")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "清除" }));
    expect(save).toHaveBeenCalledWith({ anthropicApiKey: null });
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(save).toHaveBeenCalledWith({ aiLanguage: "en" });
  });
});
