// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const m = loadRealMatchFixture();

beforeEach(() => {
  (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
    settings: {
      get: vi.fn().mockResolvedValue({ language: "zh" }),
      save: vi.fn().mockResolvedValue({}),
    },
    analysis: {
      getState: vi.fn().mockResolvedValue({ cached: null, running: false }),
      getCached: vi.fn().mockResolvedValue(null),
    },
    compare: {
      getState: vi.fn().mockResolvedValue(null),
      getCached: vi.fn().mockResolvedValue(null),
      run: vi.fn(),
      cancel: vi.fn(),
      onDelta: () => () => {},
      onDone: () => () => {},
      onError: () => () => {},
    },
  };
});

const legendItems = (c: HTMLElement): HTMLElement[] =>
  Array.from(c.querySelectorAll<HTMLElement>(".rpt-tl-legend-item"));
const offNames = (c: HTMLElement): string[] =>
  legendItems(c)
    .filter((el) => el.className.includes("off"))
    .map((el) => el.textContent!.trim());
const clickLegend = (c: HTMLElement, i: number) =>
  fireEvent.click(legendItems(c)[i]!);

// User feedback 2026-08-05: from all-visible a click solos; otherwise it flips.
// Flipping the last visible one off restores all (a blank chart carries zero
// information).
describe("战报人物过滤:全选点击 = solo,其余点击 = flip", () => {
  it("全选状态点 A → 只看 A(其余全部隐藏)", () => {
    const { container } = render(<MatchReport source={m} matchId="t" />);
    const n = legendItems(container).length;
    expect(n).toBeGreaterThan(2);
    expect(offNames(container)).toHaveLength(0);
    clickLegend(container, 0);
    // Everyone except A dimmed; exactly one curve left
    expect(offNames(container)).toHaveLength(n - 1);
    expect(container.querySelectorAll("path.rpt-tl-line")).toHaveLength(1);
  });

  it("solo A 后点 B → flip:A、B 两人可见", () => {
    const { container } = render(<MatchReport source={m} matchId="t" />);
    const n = legendItems(container).length;
    clickLegend(container, 0); // solo A
    clickLegend(container, 1); // flip B on
    expect(offNames(container)).toHaveLength(n - 2);
    expect(container.querySelectorAll("path.rpt-tl-line")).toHaveLength(2);
    // …and flipping B back off returns to solo A
    clickLegend(container, 1);
    expect(offNames(container)).toHaveLength(n - 1);
  });

  it("solo A 后再点 A → 回到全选(而不是全隐藏的空白图)", () => {
    const { container } = render(<MatchReport source={m} matchId="t" />);
    const n = legendItems(container).length;
    clickLegend(container, 0);
    expect(offNames(container)).toHaveLength(n - 1);
    clickLegend(container, 0);
    expect(offNames(container)).toHaveLength(0);
    expect(container.querySelectorAll("path.rpt-tl-line")).toHaveLength(n);
  });

  it("榜单行名字点击与图例同一套语义(全选状态点名 = solo)", () => {
    const { container } = render(<MatchReport source={m} matchId="t" />);
    const n = legendItems(container).length;
    const meterName = container.querySelector<HTMLElement>(".rpt-meter-name")!;
    fireEvent.click(meterName);
    expect(offNames(container)).toHaveLength(n - 1);
  });
});
