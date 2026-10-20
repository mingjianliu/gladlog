// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { bridge } from "./bridge";

vi.mock("./bridge");

type Status = {
  enabled: boolean;
  connected: boolean;
  recording: boolean;
  lastError: string | null;
};

function mountWith(status: Status) {
  (bridge as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    matches: {
      page: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      list: vi.fn(),
    },
    logs: { onMatchStored: () => () => {} },
    settings: { get: vi.fn().mockResolvedValue({ wowDirectory: "/wow" }) },
    recorder: {
      getStatus: vi.fn().mockResolvedValue(status),
      onStatus: vi.fn().mockReturnValue(() => {}),
    },
  });
  return render(<App />);
}

beforeEach(() => vi.clearAllMocks());

describe("App 录像未连接横幅", () => {
  it("启用 + 未连接 + 没在录 → 出现", async () => {
    const { container } = mountWith({
      enabled: true,
      connected: false,
      recording: false,
      lastError: null,
    });
    await waitFor(() =>
      expect(container.querySelector(".app-rec-warn")).toBeTruthy(),
    );
  });

  it("未启用 → 不出现", async () => {
    const { container } = mountWith({
      enabled: false,
      connected: false,
      recording: false,
      lastError: null,
    });
    await waitFor(() =>
      expect(container.querySelector(".app-rec-warn")).toBeNull(),
    );
  });

  it("已连接 → 不出现", async () => {
    const { container } = mountWith({
      enabled: true,
      connected: true,
      recording: false,
      lastError: null,
    });
    await waitFor(() =>
      expect(container.querySelector(".app-rec-warn")).toBeNull(),
    );
  });

  it("正在录制 → 不出现", async () => {
    const { container } = mountWith({
      enabled: true,
      connected: true,
      recording: true,
      lastError: null,
    });
    await waitFor(() =>
      expect(container.querySelector(".app-rec-warn")).toBeNull(),
    );
  });
});
