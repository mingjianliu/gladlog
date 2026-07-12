// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
