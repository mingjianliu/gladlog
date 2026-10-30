// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bridge } from "../bridge";
import { SettingsPanel } from "./SettingsPanel";

vi.mock("../bridge");

type Status = {
  enabled: boolean;
  connected: boolean;
  recording: boolean;
  lastError: string | null;
};

function mountWith(status: Status) {
  (bridge as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    settings: {
      get: vi.fn().mockResolvedValue({}),
      save: vi.fn().mockResolvedValue({}),
    },
    recorder: {
      getStatus: vi.fn().mockResolvedValue(status),
      onStatus: vi.fn().mockReturnValue(() => {}),
      testConnection: vi.fn(),
      autoConfig: vi.fn(),
      getForMatch: vi.fn(),
    },
  });
  return render(<SettingsPanel />);
}

const base: Status = {
  enabled: true,
  connected: true,
  recording: false,
  lastError: null,
};

beforeEach(() => vi.clearAllMocks());

describe("SettingsPanel 录像状态", () => {
  it("未启用时明说未启用", async () => {
    const { container } = mountWith({ ...base, enabled: false });
    await waitFor(() =>
      expect(container.querySelector(".set-rec-status")?.textContent).toContain(
        "未启用",
      ),
    );
  });

  it("启用但没连上时明说未连接 —— 这正是一期静默漏录的场景", async () => {
    const { container } = mountWith({ ...base, connected: false });
    await waitFor(() =>
      expect(container.querySelector(".set-rec-status")?.textContent).toContain(
        "未连接",
      ),
    );
  });

  it("正在录时显示正在录制", async () => {
    const { container } = mountWith({ ...base, recording: true });
    await waitFor(() =>
      expect(container.querySelector(".set-rec-status")?.textContent).toContain(
        "正在录制",
      ),
    );
  });

  it("有 lastError 时把错误原文显示出来", async () => {
    mountWith({
      ...base,
      connected: false,
      lastError: "connect ECONNREFUSED 127.0.0.1:4455",
    });
    await waitFor(() => expect(screen.getByText(/ECONNREFUSED/)).toBeTruthy());
  });
});
