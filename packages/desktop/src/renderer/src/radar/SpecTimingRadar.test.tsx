// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  SpecTimingQuery,
  SpecTimingResult,
} from "../../../shared/specRadar";
import { bridge } from "../bridge";
import { response, spec } from "./radarFixtures";
import { SpecTimingRadar } from "./SpecTimingRadar";

vi.mock("../bridge");

const ok = (tier: string, name: string): SpecTimingResult => ({
  ok: true,
  url: `http://radar/${tier}`,
  fetchedAt: 0,
  data: response([
    spec(name, name.split(" ").pop()!, "dps"),
    spec("Fire Mage", "Mage", "dps"),
    spec("Frost Mage", "Mage", "dps"),
    spec("Arcane Mage", "Mage", "dps"),
  ]),
});

function mount(fetch: (q: SpecTimingQuery) => Promise<SpecTimingResult>) {
  (bridge as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    specRadar: {
      getConfig: vi
        .fn()
        .mockResolvedValue({ enabled: true, baseUrl: "http://radar" }),
      fetch: vi.fn(fetch),
    },
    icon: { get: vi.fn().mockResolvedValue(null) },
  });
  return render(<SpecTimingRadar />);
}

// jsdom here has no usable localStorage; give each test a fresh in-memory one
// (the roster / source field read it on mount).
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});

describe("SpecTimingRadar", () => {
  it("切分段后旧分段的分数立刻下屏;新分段失败时也不回显旧表", async () => {
    let pending: ((r: SpecTimingResult) => void) | null = null;
    mount((q) =>
      q.ratingTier === "2600"
        ? Promise.resolve(ok("2600", "Arms Warrior"))
        : new Promise((res) => {
            pending = res;
          }),
    );
    await screen.findAllByText("武器战士");
    fireEvent.click(screen.getByRole("button", { name: "2400–2599" }));
    await waitFor(() => expect(screen.queryByText("武器战士")).toBeNull());
    expect(document.querySelector(".radar-table")).toBeNull();
    pending!({ ok: false, error: "HTTP 503", url: "http://radar/2400" });
    await screen.findByRole("alert");
    expect(screen.queryByText("武器战士")).toBeNull();
  });

  it("同一选择刷新失败时保留上一次的表", async () => {
    let n = 0;
    mount(() =>
      Promise.resolve(
        n++ === 0
          ? ok("2600", "Arms Warrior")
          : { ok: false, error: "HTTP 503", url: "http://radar/2600" },
      ),
    );
    await screen.findAllByText("武器战士");
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await screen.findByRole("alert");
    expect(screen.getAllByText("武器战士").length).toBeGreaterThan(0);
  });

  it("下拉里「全选本职业」选整个职业,不只是搜索命中的专精", async () => {
    mount(() => Promise.resolve(ok("2600", "Arms Warrior")));
    await screen.findAllByText("武器战士");
    fireEvent.click(document.querySelector(".radar-drop-trigger")!);
    fireEvent.change(document.querySelector(".radar-drop-search input")!, {
      target: { value: "fire" },
    });
    fireEvent.click(screen.getByRole("button", { name: /法师.*全选本职业/ }));
    await waitFor(() =>
      expect(document.querySelectorAll(".radar-table tbody tr").length).toBe(3),
    );
  });
});
