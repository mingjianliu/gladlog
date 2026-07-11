/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import { SpellIcon } from "../src/renderer/src/report/components/SpellIcon";

function mockBridge(iconResult: string | null) {
  (window as unknown as Record<string, unknown>).__gladlogFixture = {
    icon: { get: async () => iconResult },
  };
}

describe("SpellIcon", () => {
  it("拿到 data URL → 渲染 img", async () => {
    mockBridge("data:image/jpeg;base64,QUJD");
    render(<SpellIcon icon="spell_holy_renew" label="Renew" />);
    await waitFor(() => {
      const img = screen.getByRole("img");
      expect(img.getAttribute("src")).toMatch(/^data:image\/jpeg/);
    });
  });

  it("null(离线未缓存/失败)→ 首字母块降级", async () => {
    mockBridge(null);
    render(<SpellIcon icon="whatever" label="Renew" />);
    await waitFor(() => {
      expect(screen.getByText("R")).toBeTruthy();
    });
  });

  it("无 icon 名 → 直接首字母块,不调 bridge", () => {
    mockBridge("data:image/jpeg;base64,QUJD");
    render(<SpellIcon icon="" label="Serenity" />);
    expect(screen.getByText("S")).toBeTruthy();
  });
});
