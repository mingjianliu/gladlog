// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";

import fixture from "../../../../../test/fixtures/report-match.json";
import type { ReportSource } from "../derive/types";
import { MatchReport } from "./MatchReport";

const source = fixture as unknown as ReportSource;

beforeEach(() => {
  (window as any).__gladlogFixture = {
    settings: {
      get: vi.fn().mockResolvedValue({ aiLanguage: "zh" }),
      save: vi.fn().mockResolvedValue({}),
    },
    analysis: {
      getState: vi.fn().mockResolvedValue({ cached: null, running: false }),
      getCached: vi.fn().mockResolvedValue(null),
      run: vi.fn(),
      cancel: vi.fn(),
      onDone: () => () => {},
      onError: () => () => {},
    },
    compare: {
      getCached: vi.fn().mockResolvedValue(null),
      run: vi.fn(),
      cancel: vi.fn(),
      onDelta: () => () => {},
      onDone: () => () => {},
      onError: () => () => {},
    },
  };
});

describe("MatchReport initialView", () => {
  it("默认打开战报视图", () => {
    const { container } = render(<MatchReport source={source} matchId="m1" />);
    const tab = Array.from(container.querySelectorAll(".rpt-view-tabs button")).find(
      (b) => b.textContent === "战报",
    );
    expect(tab).toBeTruthy();
    expect(tab!.className.split(" ")).toContain("active");
  });

  it("initialView=replay 直接打开回放视图", () => {
    const { container } = render(<MatchReport source={source} matchId="m1" initialView="replay" />);
    const replayTab = Array.from(container.querySelectorAll(".rpt-view-tabs button")).find(
      (b) => b.textContent === "回放",
    );
    const reportTab = Array.from(container.querySelectorAll(".rpt-view-tabs button")).find(
      (b) => b.textContent === "战报",
    );
    expect(replayTab).toBeTruthy();
    expect(replayTab!.className.split(" ")).toContain("active");
    expect(reportTab).toBeTruthy();
    expect(reportTab!.className.split(" ")).not.toContain("active");
  });

  it("initialView=ai 直接打开 AI 视图", () => {
    const { container } = render(<MatchReport source={source} matchId="m1" initialView="ai" />);
    const aiTab = Array.from(container.querySelectorAll(".rpt-view-tabs button")).find(
      (b) => b.textContent === "AI 分析",
    );
    expect(aiTab).toBeTruthy();
    expect(aiTab!.className.split(" ")).toContain("active");
  });
});
