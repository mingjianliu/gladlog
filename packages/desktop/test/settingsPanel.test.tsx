// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { API_KEY_REDACTED } from "../src/main/settingsStore";
import type { UpdateState } from "../src/main/updater";
import { SettingsPanel } from "../src/renderer/src/components/SettingsPanel";

function mockBridge(
  over: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) {
  const state = {
    wowDirectory: null,
    anthropicApiKey: null,
    anthropicModel: null,
    aiBackend: "anthropic",
    aiBackendCommand: null,
    aiLanguage: "zh",
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
      selectDirectory: async () => "/wow",
      getVersion: async () => "9.9.9",
    },
    ...extra,
  };
  return { save };
}

/** update surface stub: goes into mockBridge's `extra`. The returned `emit`
 *  pushes a new state the same way main does. */
function mockUpdate(initial: UpdateState) {
  const check = vi.fn(async () => {});
  const install = vi.fn(async () => {});
  let push: ((s: UpdateState) => void) | null = null;
  const update = {
    getState: async () => initial,
    check,
    install,
    onState: (cb: (s: UpdateState) => void) => {
      push = cb;
      return () => {
        push = null;
      };
    },
  };
  return {
    update,
    check,
    install,
    emit: (s: UpdateState) => act(() => push?.(s)),
  };
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

  it("自动分析新对局:关时按钮显示启用,点击后调用 save 打开开关", async () => {
    const { save } = mockBridge();
    render(<SettingsPanel />);
    const btn = await screen.findByRole("button", {
      name: "自动分析新对局",
    });
    expect(btn.textContent).toBe("启用");
    fireEvent.click(btn);
    expect(save).toHaveBeenCalledWith({ autoAnalyzeNew: true });
  });

  it("自动分析新对局:开时按钮显示停用,点击后调用 save 关闭开关", async () => {
    const { save } = mockBridge({ autoAnalyzeNew: true });
    render(<SettingsPanel />);
    const btn = await screen.findByRole("button", {
      name: "自动分析新对局",
    });
    expect(btn.textContent).toBe("停用");
    fireEvent.click(btn);
    expect(save).toHaveBeenCalledWith({ autoAnalyzeNew: false });
  });

  it("AI 自查(2026-10-15):默认关,按钮显示开启;说明写清代价;开 / 关都持久化", async () => {
    const { save } = mockBridge();
    render(<SettingsPanel />);
    const btn = await screen.findByRole("button", { name: "AI 自查" });
    expect(btn.textContent).toBe("开启");
    expect(screen.getByText(/多一次\s*AI 调用,用量约翻倍,多等 1–2 分钟/)).toBeTruthy();
    fireEvent.click(btn);
    expect(save).toHaveBeenCalledWith({ aiSelfReview: true });
    expect(
      (await screen.findByRole("button", { name: "AI 自查" })).textContent,
    ).toBe("关闭");
    fireEvent.click(screen.getByRole("button", { name: "AI 自查" }));
    expect(save).toHaveBeenLastCalledWith({ aiSelfReview: false });
  });

  // Task 6(moment 深挖 UI 入口):自动深挖轮的密集快照开关,照抄自动分析新对局
  // 开关的行样式与测试样式。


});

describe("设置页「关于」(spec §4.6)", () => {
  it("显示当前版本号", async () => {
    mockBridge();
    render(<SettingsPanel />);
    expect(await screen.findByText("9.9.9")).toBeTruthy();
  });

  it("自动检查更新默认开 → 按钮显示停用,点击写回 false", async () => {
    const { save } = mockBridge();
    render(<SettingsPanel />);
    const btn = await screen.findByRole("button", { name: "自动检查更新" });
    expect(btn.textContent).toBe("停用");
    fireEvent.click(btn);
    expect(save).toHaveBeenCalledWith({ autoCheckUpdates: false });
  });

  // 本小节的重点:开关只管定时检查,不许连手动入口一起关死
  it("自动检查关掉时,「检查更新」按钮仍可用且真的调 check", async () => {
    const u = mockUpdate({ phase: "idle", lastCheckedAt: null });
    mockBridge({ autoCheckUpdates: false }, { update: u.update });
    render(<SettingsPanel />);
    const btn = await screen.findByRole("button", { name: "检查更新" });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(btn);
    expect(u.check).toHaveBeenCalledTimes(1);
  });

  it("checking → 按钮禁用并显示检查中…", async () => {
    const u = mockUpdate({ phase: "checking" });
    mockBridge({}, { update: u.update });
    render(<SettingsPanel />);
    const btn = await screen.findByRole("button", { name: "检查中…" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("手动查完回到 idle → 显示已是最新 + 相对时间", async () => {
    const u = mockUpdate({ phase: "idle", lastCheckedAt: null });
    mockBridge({}, { update: u.update });
    render(<SettingsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "检查更新" }));
    u.emit({ phase: "idle", lastCheckedAt: Date.now() - 5 * 60_000 });
    expect(screen.getByText("已是最新 · 上次检查:5 分钟前")).toBeTruthy();
  });

  it("从未检查 → 显示从未检查", async () => {
    const u = mockUpdate({ phase: "idle", lastCheckedAt: null });
    mockBridge({}, { update: u.update });
    render(<SettingsPanel />);
    expect(await screen.findByText("从未检查")).toBeTruthy();
  });

  it("error → 就地显示失败原因,不弹窗", async () => {
    const u = mockUpdate({ phase: "error", message: "net::ERR_TIMED_OUT" });
    mockBridge({}, { update: u.update });
    render(<SettingsPanel />);
    expect(await screen.findByText("net::ERR_TIMED_OUT")).toBeTruthy();
    expect(screen.getByRole("button", { name: "检查更新" })).toBeTruthy();
  });

  // CSS(.settings-v)会用 text-overflow: ellipsis 截断长文;error 这一行是用户
  // 唯一能拿到失败原因的地方(比如 mac 签名校验失败那条很长的消息,截断恰好
  // 截在 "did not pass validation" 之前),所以要靠 title 悬停补全。
  it("error 且消息很长(会被 CSS 截断)→ title 带完整原文", async () => {
    const longMessage =
      "Code signature at URL file:///Users/mingjianliu/Library/Caches/com.gladlog.desktop.ShipIt/update.ifMeGTA/gladlog.app/ did not pass validation: code failed to satisfy specified code requirement(s)";
    const u = mockUpdate({ phase: "error", message: longMessage });
    mockBridge({}, { update: u.update });
    render(<SettingsPanel />);
    const el = await screen.findByText(longMessage);
    expect(el.title).toBe(longMessage);
  });

  it("disabled(绿色版)→ 说明为什么不更新,且不出检查按钮", async () => {
    const u = mockUpdate({ phase: "disabled", reason: "portable" });
    mockBridge({}, { update: u.update });
    render(<SettingsPanel />);
    expect(
      await screen.findByText("绿色版(zip)不自动更新,请改用安装版"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "检查更新" })).toBeNull();
  });

  it("桩没有 update 面 → 版本号照显、说明为什么,不出检查按钮、不崩", async () => {
    mockBridge();
    render(<SettingsPanel />);
    expect(await screen.findByText("9.9.9")).toBeTruthy();
    expect(screen.getByText("此环境不提供自动更新")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "检查更新" })).toBeNull();
  });
});
