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

// Count only real match rows, not the "加载更早…" loading indicator.
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
  });
});

describe("App pagination", () => {
  it("loads the first 100 on mount and appends older on scroll-to-bottom", async () => {
    render(<App />);
    await waitFor(() => expect(matchRows()).toHaveLength(100));
    const list = screen.getByTestId("match-list");
    // simulate reaching the bottom
    Object.defineProperty(list, "scrollHeight", {
      value: 1000,
      configurable: true,
    });
    Object.defineProperty(list, "clientHeight", {
      value: 300,
      configurable: true,
    });
    Object.defineProperty(list, "scrollTop", {
      value: 700,
      configurable: true,
    });
    fireEvent.scroll(list);
    await waitFor(() => expect(matchRows()).toHaveLength(200));
  });
});
