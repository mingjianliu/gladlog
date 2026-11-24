// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LangProvider } from "../src/renderer/src/i18n/LangProvider";
import { ProComparisonVerified } from "../src/renderer/src/report/components/ProComparisonVerified";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const m = loadRealMatchFixture();

/** A minimal done-shaped compare result for the "already cached" case. */
const cachedResult = {
  verifiedComparison: { dims: [], facts: {} },
  report: "cached report text",
  droppedReason: null,
  cellMeta: {
    spec: "Discipline Priest",
    bracket: "3v3",
    archetype: "hybrid",
    buildGroup: "*",
    sampleN: 40,
    fellBackTo: "*×*",
  },
};

function stubBridge(opts: {
  analysisCached?: unknown;
  compareCached?: unknown;
  compareState?: unknown;
  language?: "zh" | "en";
}) {
  const run = vi.fn().mockResolvedValue(undefined);
  const analysisGetState = vi
    .fn()
    .mockResolvedValue({ cached: opts.analysisCached ?? null, running: false });
  (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
    settings: {
      get: vi.fn().mockResolvedValue({ language: opts.language ?? "zh" }),
    },
    analysis: { getState: analysisGetState },
    compare: {
      getState: vi.fn().mockResolvedValue(opts.compareState ?? null),
      getCached: vi.fn().mockResolvedValue(opts.compareCached ?? null),
      run,
      cancel: vi.fn(),
      onDelta: () => () => {},
      onDone: () => () => {},
      onError: () => () => {},
    },
  };
  return { run, analysisGetState };
}

beforeEach(() => {
  delete (window as unknown as { __gladlogFixture?: unknown }).__gladlogFixture;
});

// Prod triage 2026-08-04: batch/auto-analyzed matches had an analysis but no
// comparison and no path to ever get one (the merged button's runSignal was the
// sole trigger; hideActions hides the panel's own button). The panel now
// backfills automatically — these tests pin when that fires and, just as
// important, when it must not.
describe("同水平对比自动补跑", () => {
  it("有分析缓存、对比全空 → 自动跑一次,且 input 是真推导(bracket 非 unknown)", async () => {
    const { run } = stubBridge({ analysisCached: { findings: [] } });
    render(<ProComparisonVerified source={m} matchId="m-auto" hideActions />);
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const input = run.mock.calls[0]![0] as {
      matchId: string;
      bracket: string;
      spec: string;
    };
    expect(input.matchId).toBe("m-auto");
    // toLegacyMatch synthesizes startInfo.bracket from the doc — if this reads
    // "unknown" every lookup lands NO_COHORT and the backfill is useless.
    expect(input.bracket).not.toBe("unknown");
    expect(input.spec.length).toBeGreaterThan(0);
    // No retry loop: still exactly one call after the state settles.
    await new Promise((r) => setTimeout(r, 20));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("没有分析缓存 → 不自动跑(打开 AI tab 不烧钱,行为与从前一致)", async () => {
    const { run, analysisGetState } = stubBridge({ analysisCached: null });
    render(<ProComparisonVerified source={m} matchId="m-none" hideActions />);
    // The gate was consulted…
    await waitFor(() => expect(analysisGetState).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    // …and decided against running.
    expect(run).not.toHaveBeenCalled();
  });

  it("en 模式下分析缓存是回退来的 zh 结果(§6.13)→ 不自动跑;对照:en 结果照跑", async () => {
    const zh = stubBridge({
      analysisCached: { findings: [], contentLang: "zh" },
      language: "en",
    });
    const first = render(
      <LangProvider firstRunPicker={false}>
        <ProComparisonVerified source={m} matchId="m-zh" hideActions />
      </LangProvider>,
    );
    await waitFor(() => expect(zh.analysisGetState).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(zh.run).not.toHaveBeenCalled();
    first.unmount();

    const en = stubBridge({
      analysisCached: { findings: [], contentLang: "en" },
      language: "en",
    });
    render(
      <LangProvider firstRunPicker={false}>
        <ProComparisonVerified source={m} matchId="m-en" hideActions />
      </LangProvider>,
    );
    await waitFor(() => expect(en.run).toHaveBeenCalledTimes(1));
  });

  it("对比已有缓存 → 渲染缓存,不再跑", async () => {
    const { run, analysisGetState } = stubBridge({
      analysisCached: { findings: [] },
      compareCached: cachedResult,
    });
    render(<ProComparisonVerified source={m} matchId="m-cached" hideActions />);
    expect(await screen.findByText(/cached report text/)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(run).not.toHaveBeenCalled();
    expect(analysisGetState).not.toHaveBeenCalled();
  });

  it("对比正在跑(getState=running)→ 不重复触发", async () => {
    const { run } = stubBridge({
      analysisCached: { findings: [] },
      compareState: { phase: "running" },
    });
    render(<ProComparisonVerified source={m} matchId="m-run" hideActions />);
    await new Promise((r) => setTimeout(r, 30));
    expect(run).not.toHaveBeenCalled();
  });

  it("桩缺 analysis 面(测试台/fixture)→ 静默不跑,不抛", async () => {
    const { run } = stubBridge({});
    delete (
      (window as unknown as { __gladlogFixture: { analysis?: unknown } })
        .__gladlogFixture as { analysis?: unknown }
    ).analysis;
    render(<ProComparisonVerified source={m} matchId="m-stub" hideActions />);
    await new Promise((r) => setTimeout(r, 30));
    expect(run).not.toHaveBeenCalled();
  });

  it("en 模式下收到 zh 的 done(codex A#3):不显示 zh 解说,改按 getState 重新取当前语言的状态", async () => {
    let doneCb: ((d: unknown) => void) | null = null;
    const getState = vi
      .fn()
      .mockResolvedValueOnce({ phase: "running", startedAt: Date.now() })
      .mockResolvedValue({ phase: "done", result: cachedResult });
    (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
      settings: { get: vi.fn().mockResolvedValue({ language: "en" }) },
      analysis: {
        getState: vi.fn().mockResolvedValue({ cached: null, running: false }),
      },
      compare: {
        getState,
        getCached: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue(undefined),
        cancel: vi.fn(),
        onDelta: () => () => {},
        onDone: (cb: (d: unknown) => void) => {
          doneCb = cb;
          return () => {
            doneCb = null;
          };
        },
        onError: () => () => {},
      },
    };
    render(
      <LangProvider firstRunPicker={false}>
        <ProComparisonVerified source={m} matchId="m-lang" hideActions />
      </LangProvider>,
    );
    await waitFor(() => expect(getState).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(doneCb).not.toBeNull());
    doneCb!({
      matchId: "m-lang",
      result: { ...cachedResult, report: "中文解说" },
      contentLang: "zh",
    });
    await waitFor(() => expect(getState).toHaveBeenCalledTimes(2));
    expect(
      (await screen.findAllByText(/cached report text/)).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/中文解说/)).toBeNull();
  });
});
