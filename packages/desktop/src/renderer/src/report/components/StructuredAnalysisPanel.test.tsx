// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { StructuredAnalysisPanel } from "./StructuredAnalysisPanel";

const result = {
  findings: [
    {
      eventIds: ["e1"],
      severity: "high",
      category: "survival",
      title: "Death",
      explanation: "You died at 30s.",
    },
  ],
  dropped: 0,
  hadNarration: true,
};

beforeEach(() => {
  (window as any).__gladlogFixture = {
    settings: {
      get: vi.fn().mockResolvedValue({ aiLanguage: "zh" }),
      save: vi.fn().mockResolvedValue({}),
    },
    analysis: {
      getCached: vi.fn().mockResolvedValue(result),
      run: vi.fn(),
      cancel: vi.fn(),
      onDone: () => () => {},
      onError: () => () => {},
    },
  };
});

describe("StructuredAnalysisPanel", () => {
  it("renders cached findings", async () => {
    render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    expect(await screen.findByText(/You died at 30s/)).toBeTruthy();
  });

  it("语言切换:点 EN 持久化 aiLanguage 并重查缓存(backlog #1)", async () => {
    render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    await screen.findByText(/You died at 30s/);
    const fx = (window as any).__gladlogFixture;
    const callsBefore = fx.analysis.getCached.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    await screen.findByText(/You died at 30s/); // 重查后重新渲染
    expect(fx.settings.save).toHaveBeenCalledWith({ aiLanguage: "en" });
    expect(fx.analysis.getCached.mock.calls.length).toBeGreaterThan(
      callsBefore,
    );
  });
});
