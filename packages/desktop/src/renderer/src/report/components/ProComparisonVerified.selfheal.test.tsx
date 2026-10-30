// @vitest-environment jsdom
//
// Finding 1 (whole-branch review): the useMemo for `rich` depends only on
// [source, lang], so if the 12MB spellNames table has not finished loading at
// evaluation time (englishNameIndex() === null), that match's comparison
// commentary stays plain text forever — violating the ensure contract that
// "display paths heal themselves on the next render". The fix copies
// StructuredAnalysisPanel's three-line dataReady pattern. This test uses
// vi.mock to control the ordering of
// analysisDataReady/ensureAnalysisData/englishNameIndex (so it does not depend
// on the microtask timing of the real 12MB load and can reproduce the
// "not loaded → healed" two-phase state deterministically).
import { act, render, screen } from "@testing-library/react";
import { beforeEach,describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  ready: false,
  resolveEnsure: null as (() => void) | null,
}));

vi.mock("@gladlog/analysis", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    analysisDataReady: () => mockState.ready,
    ensureAnalysisData: () =>
      new Promise<void>((resolve) => {
        mockState.resolveEnsure = () => {
          mockState.ready = true;
          resolve();
        };
      }),
    // The real implementation returns null until the table is loaded (see
    // spellNameLookup.ts); controlling it directly instead of waiting on the
    // real dynamic JSON import keeps the ordering deterministic.
    englishNameIndex: () =>
      mockState.ready ? new Map([["Tranquility", ["740"]]]) : null,
  };
});

// Must be imported after vi.mock so we get the stubbed module graph.
import { ProComparisonVerified } from "./ProComparisonVerified";

const result = {
  verifiedComparison: { dims: [], facts: {} },
  report: "You should use Tranquility earlier in the fight.",
  droppedReason: null,
  cellMeta: {
    spec: "Discipline Priest",
    bracket: "3v3",
    archetype: "hybrid",
    buildGroup: "offensive",
    sampleN: 40,
    fellBackTo: "archetype×buildGroup",
  },
};

beforeEach(() => {
  mockState.ready = false;
  mockState.resolveEnsure = null;
  (window as any).__gladlogFixture = {
    compare: {
      getCached: vi.fn().mockResolvedValue(result),
      run: vi.fn(),
      cancel: vi.fn(),
      onDelta: () => () => {},
      onDone: () => () => {},
      onError: () => () => {},
    },
  };
});

describe("ProComparisonVerified rich memo 自愈(dataReady 门)", () => {
  it("表未载完时纯文本展示;载完后下次渲染自动补内联图标,不需重开组件", async () => {
    const { container } = render(
      <ProComparisonVerified
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    await screen.findByText(/Tranquility/);
    // First evaluation: dataReady=false → englishNameIndex() null → plain-text
    // degradation
    expect(container.querySelector('[title="Tranquility"]')).toBeNull();

    // Table loaded: ensureAnalysisData resolves → dataReady flips true → the
    // memo recomputes
    await act(async () => {
      mockState.resolveEnsure?.();
      await Promise.resolve();
    });

    expect(container.querySelector('[title="Tranquility"]')).not.toBeNull();
  });
});
