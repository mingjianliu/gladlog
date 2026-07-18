// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import App from "./App";
import { bridge } from "./bridge";

vi.mock("./bridge");

const meta = (id: string, startTime: number) => ({
  id,
  kind: "match",
  bracket: "2v2",
  zoneId: "0",
  startTime,
  endTime: startTime + 1,
  result: "0",
  storedAt: 0,
});

// Count only real match rows, not the "后台补载中…" loading indicator.
const matchRows = () =>
  screen
    .getAllByRole("listitem")
    .filter((li) => !li.className.includes("loading-more"));

beforeEach(() => {
  const page = vi.fn(async (opts: { before?: number; limit: number }) => {
    // 250 synthetic matches, startTime 250..1 (newest first)
    const all = Array.from({ length: 250 }, (_, i) =>
      meta(`m${250 - i}`, 250 - i),
    );
    const before = opts.before ?? Infinity;
    return all.filter((m) => m.startTime < before).slice(0, opts.limit);
  });
  (bridge as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    matches: { page, get: vi.fn().mockResolvedValue(null), list: vi.fn() },
    logs: { onMatchStored: () => () => {} },
    settings: { get: vi.fn().mockResolvedValue({ wowDirectory: "/wow" }) },
  });
});

describe("App pagination", () => {
  it("首屏 100 条即渲染,其余后台自动补满(无需滚动)", async () => {
    render(<App />);
    await waitFor(() => expect(matchRows()).toHaveLength(100));
    // 后台循环逐页(150ms/页)拉满 250 条
    await waitFor(() => expect(matchRows()).toHaveLength(250), {
      timeout: 4000,
    });
  });
});

describe("首启引导(phase3 #2b)", () => {
  it("无对局且未设目录 → 引导卡;选目录后转监控提示", async () => {
    const selectDirectory = vi.fn().mockResolvedValue("/wow/dir");
    (bridge as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      matches: {
        page: vi.fn().mockResolvedValue([]),
        get: vi.fn().mockResolvedValue(null),
        list: vi.fn(),
      },
      logs: { onMatchStored: () => () => {} },
      settings: { get: vi.fn().mockResolvedValue({ wowDirectory: null }) },
      app: { selectDirectory },
    });
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("onboard")).toBeTruthy());
    expect(screen.getByText(/欢迎使用 gladlog/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /选择 WoW 目录/ }));
    await waitFor(() => expect(screen.getByText(/正在监控/)).toBeTruthy());
    expect(selectDirectory).toHaveBeenCalled();
  });

  it("有对局时不出引导(仍是选择提示)", async () => {
    (bridge as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      matches: {
        page: vi.fn().mockResolvedValue([meta("m1", 5)]),
        get: vi.fn().mockResolvedValue(null),
        list: vi.fn(),
      },
      logs: { onMatchStored: () => () => {} },
      settings: { get: vi.fn().mockResolvedValue({ wowDirectory: null }) },
    });
    render(<App />);
    await waitFor(() => expect(screen.queryByTestId("onboard")).toBeNull());
  });
});
