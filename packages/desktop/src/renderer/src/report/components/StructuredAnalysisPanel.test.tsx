// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { untilText } from "../../../../../test/support/untilDom";
import { buildAnalysisInput } from "../derive/analysisInput";
import { slotLabel } from "../derive/slotLabel";
import { StructuredAnalysisPanel } from "./StructuredAnalysisPanel";

// The split-button tests (Task 4) need a click to actually reach
// handleAnalyze/runAnalyze, which first requires passing the `input !== null`
// gate; the minimal source every other case in this file uses
// (`{units:{}, startInfo:{}}`) finds no owner under the real
// buildAnalysisInput and is always null (recorded in the Task 3 report: this
// repo has no ready-made lightweight GladMatch fixture, and building one is not
// worth it within a single Task). So buildAnalysisInput is wrapped in a vi.fn
// delegating to the real implementation — behaviour is byte-for-byte identical
// to un-mocked by default (all other cases still get null, zero regression) —
// and only the split describe block temporarily mockReturnValue's a fake input,
// leaving buildDeepenPacks and the other exports untouched.
vi.mock("../derive/analysisInput", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../derive/analysisInput")>();
  return { ...actual, buildAnalysisInput: vi.fn(actual.buildAnalysisInput) };
});

const result = {
  findings: [
    {
      eventIds: ["e1"],
      severity: "high",
      category: "survival",
      // Pure Chinese text (no ASCII words): after #15 wired up inline icons,
      // English placeholder words can collide with the real spell-name table
      // (410k entries) and get wrapped by accident (e.g. "Death" and the
      // single letter "s" are both real spell names) — pure Chinese is
      // naturally immune to that matching path.
      title: "死亡",
      explanation: "第30秒阵亡。",
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
      // Panel remount goes through getState (cache + running read atomically
      // in one call); getCached is kept on the stub because the
      // language-switch case asserts on the re-query itself.
      // Single slot (slots.length === 1): the tab bar must not render — the
      // counterpart to the "multi-slot tab switching" cases.
      getState: vi.fn().mockResolvedValue({
        cached: result,
        running: false,
        slots: [
          { key: "anthropic:claude-sonnet-5", createdAt: 1, stale: false },
        ],
        activeKey: "anthropic:claude-sonnet-5",
      }),
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
    expect(await screen.findByText(/第30秒阵亡/)).toBeTruthy();
    // Single slot: no tab bar (it only shows with >=2 slots).
    expect(screen.queryByTestId("analysis-slot-tabs")).toBeNull();
  });

  it("语言切换:点 EN 持久化 aiLanguage 并重查缓存(backlog #1)", async () => {
    render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    await screen.findByText(/第30秒阵亡/);
    const fx = (window as any).__gladlogFixture;
    const callsBefore = fx.analysis.getState.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    await screen.findByText(/第30秒阵亡/); // re-rendered after the re-query
    expect(fx.settings.save).toHaveBeenCalledWith({ aiLanguage: "en" });
    expect(fx.analysis.getState.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});

describe("演示分析(UI review #7)", () => {
  it("未配置后端且无缓存 → 出现「看一个演示分析」;点击显示带横幅的演示 findings,不写缓存", async () => {
    const fx = (window as any).__gladlogFixture;
    fx.analysis.getState = vi
      .fn()
      .mockResolvedValue({ cached: null, running: false });
    fx.ai = { detectCli: vi.fn().mockResolvedValue({ path: null }) };
    // CI-order race (2026-08-22): the offer shows before settings.get()
    // resolves; a demo opened in that gap must survive the `lang` flip that
    // settings trigger. Hold settings until after the click.
    let resolveSettings: (v: unknown) => void = () => {};
    fx.settings.get = vi.fn(() => new Promise((r) => (resolveSettings = r)));
    render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    const btn = await screen.findByTestId("ai-demo-btn");
    fireEvent.click(btn);
    expect(screen.getByTestId("ai-demo-banner").textContent).toContain(
      "演示数据",
    );
    await act(async () => {
      resolveSettings({ aiLanguage: "zh" });
    });
    expect(screen.getByTestId("ai-demo-banner")).toBeTruthy();
    expect(screen.getByText("被集火秒杀")).toBeTruthy();
    // Component-local: nothing was run or cached
    expect(fx.analysis.run).not.toHaveBeenCalled();
    // 关闭 removes it and the offer comes back
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByTestId("ai-demo-banner")).toBeNull();
    expect(screen.getByTestId("ai-demo-btn")).toBeTruthy();
  });

  it("有缓存结果时不出现演示按钮", async () => {
    render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    await screen.findByText(/已缓存/);
    expect(screen.queryByTestId("ai-demo-btn")).toBeNull();
  });

  it("配置了 API key 时不出现演示按钮", async () => {
    const fx = (window as any).__gladlogFixture;
    fx.settings.get = vi
      .fn()
      .mockResolvedValue({ aiLanguage: "zh", anthropicApiKey: "sk-x" });
    fx.analysis.getState = vi
      .fn()
      .mockResolvedValue({ cached: null, running: false });
    fx.ai = { detectCli: vi.fn().mockResolvedValue({ path: null }) };
    render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    await screen.findByRole("button", { name: "AI 分析" });
    await waitFor(() => expect(fx.ai.detectCli).toHaveBeenCalled());
    expect(screen.queryByTestId("ai-demo-btn")).toBeNull();
  });
});

describe("本场目标(D3 教练闭环)", () => {
  it("aggregate 有「还在犯」分类时渲染目标卡,按 recurring 降序取 top", async () => {
    const fx = (window as any).__gladlogFixture;
    fx.analysis.aggregate = vi.fn().mockResolvedValue([
      {
        category: "survival",
        count: 5,
        recurring: 2,
        done: 1,
        recent: [
          { matchId: "x", title: "开怕晚了", severity: "high", createdAt: 2 },
        ],
      },
      { category: "positioning", count: 3, recurring: 0, done: 3, recent: [] },
      {
        category: "cd",
        count: 4,
        recurring: 4,
        done: 0,
        recent: [
          {
            matchId: "y",
            title: "壁垒全场没按",
            severity: "med",
            createdAt: 1,
          },
        ],
      },
    ]);
    render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    const card = await screen.findByTestId("ai-goals");
    // category goes through the render-side word table (the cd alias is
    // normalized to the cooldown-usage label)
    expect(card.textContent).toContain("↻4 冷却使用");
    expect(card.textContent).toContain("↻2 生存");
    expect(card.textContent).toContain("壁垒全场没按");
    // categories with recurring=0 must not appear
    expect(card.textContent).not.toContain("positioning");
    expect(card.textContent).not.toContain("站位");
  });

  it("桩无 aggregate 面时不渲染、不崩(旧行为兼容)", async () => {
    render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    await screen.findByText(/第30秒阵亡/);
    expect(screen.queryByTestId("ai-goals")).toBeNull();
  });
});

describe("getFlags 竞态守卫(周度复核 新#2)", () => {
  it("快速切场时,先发后到的旧场 flags 不会盖到当前场上", async () => {
    const { findingKey } = await import("../../../../shared/findingKey");
    const key = findingKey(result.findings[0] as never);
    const fx = (window as any).__gladlogFixture;

    // m1's flags are slow: by the time they resolve, m2 is already mounted.
    // m2 has no flags.
    let releaseM1!: (v: Record<string, string>) => void;
    const m1Flags = new Promise<Record<string, string>>((r) => {
      releaseM1 = r;
    });
    fx.analysis.getFlags = vi.fn((id: string) =>
      id === "m1" ? m1Flags : Promise.resolve({}),
    );

    const { rerender } = render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    rerender(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m2"
      />,
    );
    releaseM1({ [key]: "done" }); // the stale match's response only lands now
    await screen.findByText(/第30秒阵亡/);

    const btn = screen.getByTitle("标记为已改进");
    expect(btn.className).not.toContain("active"); // stale flag didn't leak in
  });
});

describe("slotLabel(拆首个 冒号 + 后端/模型显示名映射)", () => {
  it("已知后端 + 已知模型 id → 中文后端名 · 模型 label", () => {
    expect(slotLabel("anthropic:claude-sonnet-5")).toBe(
      "Claude API · Claude Sonnet 5",
    );
    expect(slotLabel("agy:pro")).toBe("agy · Gemini 3.1 Pro (High)");
  });

  it("已知后端 + 未知模型 id → 模型部分回退原串", () => {
    expect(slotLabel("codex:some-future-model")).toBe(
      "Codex · some-future-model",
    );
  });

  it("无冒号(防御性)→ 原样返回整串", () => {
    expect(slotLabel("legacy")).toBe("legacy");
  });
});

describe("多模型槽 tab 切换(Task 3)", () => {
  const resultA = result; // agy:pro, the activeKey, the newest
  const resultB = {
    findings: [
      {
        eventIds: ["e2"],
        severity: "med",
        category: "cd",
        title: "旧模型发现",
        explanation: "旧槽的观察文本。",
      },
    ],
    dropped: 0,
    hadNarration: true,
  };

  const twoSlotSummary = {
    slots: [
      { key: "anthropic:claude-sonnet-5", createdAt: 1, stale: true },
      { key: "agy:pro", createdAt: 2, stale: false },
    ],
    activeKey: "agy:pro",
  };

  function twoSlotFixture() {
    let doneCb:
      | ((d: { matchId: string; result: unknown; slotKey?: string }) => void)
      | undefined;
    // Mutable "disk state": the re-query triggered by onDone reads this latest
    // snapshot, simulating main's real ordering of write-to-disk-then-emit-done
    // (regression coverage for agy flash review F2).
    let docSummary = twoSlotSummary;
    const fx = (window as any).__gladlogFixture;
    fx.analysis.getState = vi.fn(() =>
      Promise.resolve({ cached: resultA, running: false, ...docSummary }),
    );
    fx.analysis.getCached = vi.fn((_matchId: string, slotKey?: string) =>
      Promise.resolve(
        slotKey === "anthropic:claude-sonnet-5" ? resultB : resultA,
      ),
    );
    fx.analysis.onDone = (
      cb: (d: { matchId: string; result: unknown; slotKey?: string }) => void,
    ) => {
      doneCb = cb;
      return () => {};
    };
    return {
      fx,
      getDoneCb: () => doneCb,
      setDocSummary: (s: typeof twoSlotSummary) => {
        docSummary = s;
      },
    };
  }

  it("双槽:渲染 tab 条,默认显示 activeKey 槽内容,旧槽带「旧版」标", async () => {
    twoSlotFixture();
    render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    const tabs = await screen.findByTestId("analysis-slot-tabs");
    expect(await screen.findByText(/第30秒阵亡/)).toBeTruthy(); // activeKey=agy:pro content
    expect(tabs.textContent).toContain("旧版");
  });

  it("点旧槽 tab → 显示该槽 findings,不触发 run/deepen", async () => {
    const { fx } = twoSlotFixture();
    fx.analysis.deepen = vi.fn().mockResolvedValue(undefined);
    render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    await screen.findByText(/第30秒阵亡/);
    const tabs = await screen.findByTestId("analysis-slot-tabs");
    // slots are sorted by createdAt ascending: index 0 = the old
    // anthropic:claude-sonnet-5 slot.
    fireEvent.click(within(tabs).getAllByRole("button")[0]);
    expect(await screen.findByText(/旧槽的观察文本/)).toBeTruthy();
    expect(fx.analysis.run).not.toHaveBeenCalled();
    expect(fx.analysis.deepen).not.toHaveBeenCalled();
  });

  // Final review I-2: selectedSlotKey flips at the moment of the click (the
  // highlight follows the finger), but when getCached resolved to null the old
  // implementation did nothing — the panel sat in a torn state of "the previous
  // slot's findings + the new slot's highlight", looking like the click did
  // nothing. Before the fix this failed on the first assertion (the placeholder
  // text never appears, `第30秒阵亡` is still on screen); after the fix it
  // passes.
  it("点旧槽 tab 但 getCached 返回 null(槽已因 prompt 升级失效)→ 占位提示、findings 消失,点回激活槽秒恢复(复核 I-2)", async () => {
    const { fx } = twoSlotFixture();
    fx.analysis.getCached = vi.fn((_matchId: string, slotKey?: string) =>
      Promise.resolve(slotKey === "anthropic:claude-sonnet-5" ? null : resultA),
    );
    render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    await screen.findByText(/第30秒阵亡/); // initially shows activeKey=agy:pro
    const tabs = await screen.findByTestId("analysis-slot-tabs");
    // index 0 = the old anthropic:claude-sonnet-5 slot; this time its
    // getCached resolves to null.
    fireEvent.click(within(tabs).getAllByRole("button")[0]);

    expect(
      await screen.findByText(/该槽为旧版本分析.*重新分析后可查看/),
    ).toBeTruthy();
    // Neither slot's findings should show — no stale content left behind, and
    // no pretending the old content belongs to the newly selected slot.
    expect(screen.queryByText(/第30秒阵亡/)).toBeNull();
    expect(screen.queryByText(/旧槽的观察文本/)).toBeNull();
    // The highlight honestly stays on this (empty) slot rather than silently
    // snapping back to the previous tab.
    const staleTab = within(tabs)
      .getAllByRole("button")
      .find((b) => b.className.includes("active"));
    expect(staleTab?.textContent).toContain("旧版");
    // GH #38 residual (archive #10 final-review handoff): the header status
    // line and the Export button used to keep reading the underlying (not
    // cleared) `result`, so the placeholder note sat under "已缓存 · 2 条
    // findings" + a Copy Markdown button that would export the *previous*
    // slot's findings as if they were this slot's. Both must follow the
    // placeholder: the status says the slot is stale, and there is nothing to
    // export.
    expect(screen.queryByText(/已缓存/)).toBeNull();
    expect(screen.getByTestId("ai-status").textContent).toMatch(/旧版本/);
    expect(screen.queryByText("Copy Markdown")).toBeNull();

    // Click back to the active slot (index 1, getCached still returns resultA)
    // → content comes back and the placeholder disappears.
    fireEvent.click(within(tabs).getAllByRole("button")[1]);
    expect(await screen.findByText(/第30秒阵亡/)).toBeTruthy();
    expect(screen.queryByTestId("slot-stale-note")).toBeNull();
    expect(screen.getByText(/已缓存/)).toBeTruthy();
    expect(screen.getByText("Copy Markdown")).toBeTruthy();
  });

  it("查看旧槽后 onDone 触发 → selectedSlotKey 重置,回到新结果", async () => {
    const { getDoneCb } = twoSlotFixture();
    render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    await screen.findByText(/第30秒阵亡/);
    const tabs = await screen.findByTestId("analysis-slot-tabs");
    fireEvent.click(within(tabs).getAllByRole("button")[0]);
    await screen.findByText(/旧槽的观察文本/);

    const freshResult = {
      findings: [
        {
          eventIds: ["e3"],
          severity: "high",
          category: "survival",
          title: "新分析",
          explanation: "刚跑完的最新结果。",
        },
      ],
      dropped: 0,
      hadNarration: true,
    };
    act(() => {
      getDoneCb()?.({ matchId: "m1", result: freshResult });
    });
    expect(await screen.findByText(/刚跑完的最新结果/)).toBeTruthy();
  });

  it("onDone 后重新拉取 getState,tab 条按最新槽摘要更新(agy flash 复核 F2)", async () => {
    const { getDoneCb, setDocSummary } = twoSlotFixture();
    render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    await screen.findByText(/第30秒阵亡/);
    expect(
      within(screen.getByTestId("analysis-slot-tabs")).getAllByRole("button"),
    ).toHaveLength(2);

    // main writes to disk before emitting done: by now a third backend's slot
    // exists on disk.
    setDocSummary({
      slots: [
        ...twoSlotSummary.slots,
        { key: "codex:gpt-5.5", createdAt: 3, stale: false },
      ],
      activeKey: "codex:gpt-5.5",
    });
    act(() => {
      getDoneCb()?.({
        matchId: "m1",
        result: { ...resultA, deepened: true },
      });
    });
    await waitFor(() => {
      expect(
        within(screen.getByTestId("analysis-slot-tabs")).getAllByRole("button"),
      ).toHaveLength(3);
    });
  });

  it("override 分析完成(done payload 带 slotKey)→ 展示新槽结果且 tab 计入新槽(Task 4 onDone 不变式)", async () => {
    const { getDoneCb, setDocSummary } = twoSlotFixture();
    render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    await screen.findByText(/第30秒阵亡/);

    const overrideResult = {
      findings: [
        {
          eventIds: ["e4"],
          severity: "high",
          category: "survival",
          title: "deepseek新发现",
          explanation: "deepseek 槽的结果。",
        },
      ],
      dropped: 0,
      hadNarration: true,
    };
    // main writes to disk before emitting done: by now disk carries the third
    // slot produced by the override run, and that slot is the new lastSlotKey
    // (the upsertSlot semantics of finish()).
    setDocSummary({
      slots: [
        ...twoSlotSummary.slots,
        { key: "deepseek:deepseek-chat", createdAt: 3, stale: false },
      ],
      activeKey: "deepseek:deepseek-chat",
    });
    act(() => {
      getDoneCb()?.({
        matchId: "m1",
        result: overrideResult,
        slotKey: "deepseek:deepseek-chat",
      });
    });
    expect(await screen.findByText(/deepseek 槽的结果/)).toBeTruthy();
    await waitFor(() => {
      const tabs = within(
        screen.getByTestId("analysis-slot-tabs"),
      ).getAllByRole("button");
      expect(tabs).toHaveLength(3);
      const activeTab = tabs.find((b) => b.className.includes("active"));
      expect(activeTab?.textContent).toContain("DeepSeek");
    });
  });

  it("done payload 的 slotKey 与刷新后 activeKey 不一致(违反不变式)时只 warn,仍按 activeKey 展示", async () => {
    const { getDoneCb, setDocSummary } = twoSlotFixture();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    await screen.findByText(/第30秒阵亡/);

    // The refreshed activeKey is still agy:pro, yet the payload reports a
    // different slotKey — this should never happen in theory; the case only
    // verifies that the defensive branch does not misalign the display.
    setDocSummary(twoSlotSummary);
    act(() => {
      getDoneCb()?.({
        matchId: "m1",
        result: resultA,
        slotKey: "codex:gpt-5.5",
      });
    });
    await waitFor(() => expect(warnSpy).toHaveBeenCalled());
    expect(screen.getByText(/第30秒阵亡/)).toBeTruthy();
    warnSpy.mockRestore();
  });

  /**
   * GH #26 root cause, pinned deterministically (2026-09-02). Both ledger
   * records from this describe block ("only warn" never warning; "override
   * done" never showing the deepseek result) share one mechanism: on mount,
   * settings.get() flips `lang` null → "zh", and that used to re-run the
   * `[matchId, lang]` query effect — `setResult(null)`, `resultForRef =
   * null`, a second getState. When onDone landed in the window between the
   * commit that showed the first result and the passive flush of that effect,
   * act() flushed the effect *after* the handler had set the ref, so the
   * handler's getState resolved against a null ref (match-switch guard →
   * swallowed) and the second getState's cached result overwrote the done
   * payload. testing-library's waitFor opens that window (MutationObserver
   * observe + setTimeout(0) drain vs React's setImmediate passive flush).
   *
   * These two tests enter the window on purpose: render outside act, observe
   * the first result through a MutationObserver, fire onDone inside act right
   * there.
   */
  function mountOutsideAct() {
    const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const prevActEnv = g.IS_REACT_ACT_ENVIRONMENT;
    g.IS_REACT_ACT_ENVIRONMENT = false;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    root.render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    return {
      container,
      /** Restore the act environment (call before act()) */
      enterAct: () => {
        g.IS_REACT_ACT_ENVIRONMENT = true;
      },
      cleanup: () => {
        act(() => root.unmount());
        container.remove();
        g.IS_REACT_ACT_ENVIRONMENT = prevActEnv;
      },
    };
  }

  it("首个结果刚进 DOM、lang 翻转的 effect 尚未刷新时 onDone 到来 → 不变式 warn 仍然触发(GH #26 根因)", async () => {
    const { getDoneCb, setDocSummary } = twoSlotFixture();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = mountOutsideAct();
    try {
      await untilText(m.container, /第30秒阵亡/);
      setDocSummary(twoSlotSummary);
      m.enterAct();
      act(() => {
        getDoneCb()?.({
          matchId: "m1",
          result: resultA,
          slotKey: "codex:gpt-5.5",
        });
      });
      await waitFor(() => expect(warnSpy).toHaveBeenCalled(), {
        timeout: 1500,
      });
    } finally {
      warnSpy.mockRestore();
      m.cleanup();
    }
  });

  it("同一窗口里 override 完成 → 展示的是 done payload 的结果,不被第二次 getState 的缓存覆盖(GH #26 根因)", async () => {
    const { getDoneCb, setDocSummary } = twoSlotFixture();
    const overrideResult = {
      findings: [
        {
          eventIds: ["e3"],
          severity: "low",
          category: "cd",
          title: "deepseek 的发现",
          explanation: "deepseek 槽的结果。",
        },
      ],
      dropped: 0,
      hadNarration: true,
    };
    const m = mountOutsideAct();
    try {
      await untilText(m.container, /第30秒阵亡/);
      setDocSummary({
        slots: [
          ...twoSlotSummary.slots,
          { key: "deepseek:deepseek-chat", createdAt: 3, stale: false },
        ],
        activeKey: "deepseek:deepseek-chat",
      });
      m.enterAct();
      act(() => {
        getDoneCb()?.({
          matchId: "m1",
          result: overrideResult,
          slotKey: "deepseek:deepseek-chat",
        });
      });
      await waitFor(
        () => expect(m.container.textContent).toMatch(/deepseek 槽的结果/),
        { timeout: 1500 },
      );
      // and it must stay: the mount query's late answer may not clobber it
      await new Promise((r) => setTimeout(r, 50));
      expect(m.container.textContent).toMatch(/deepseek 槽的结果/);
    } finally {
      m.cleanup();
    }
  });
});

describe("split 箭头:选用其他模型分析(Task 4)", () => {
  const fakeInput = {
    matchId: "m1",
    candidates: [],
    richContext: "ctx",
    spec: "spec",
    ownerName: "Healer",
    enemySpecs: [],
  };

  beforeEach(() => {
    (buildAnalysisInput as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      fakeInput,
    );
  });
  afterEach(() => {
    (buildAnalysisInput as unknown as ReturnType<typeof vi.fn>).mockReset();
  });

  function pickerFixture(overrides?: {
    detectCli?: (backend: string) => Promise<{ path: string | null }>;
    settings?: Record<string, unknown>;
  }) {
    const fx = (window as any).__gladlogFixture;
    fx.settings.get = vi.fn().mockResolvedValue({
      aiLanguage: "zh",
      aiBackend: "anthropic",
      aiModels: {},
      anthropicApiKey: "sk-set",
      deepseekApiKey: null,
      ...overrides?.settings,
    });
    fx.ai = {
      detectCli:
        overrides?.detectCli ??
        vi.fn((backend: string) =>
          Promise.resolve({
            path: backend === "agy" ? "/usr/bin/agy" : null,
          }),
        ),
    };
    return fx;
  }

  it("菜单分组列出可用后端×模型 + 当前全局默认标记,不可用后端不出现", async () => {
    pickerFixture();
    render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    await screen.findByText(/第30秒阵亡/);
    fireEvent.click(screen.getByRole("button", { name: "选用其他模型分析" }));
    const menu = await screen.findByTestId("analysis-model-menu");

    // Global default = settings.aiBackend("anthropic") + that backend's default
    // model (aiModels unset → AI_DEFAULT_MODEL.anthropic = claude-opus-5).
    expect(
      within(menu).getByText("Claude API · Claude Opus 5 (默认)"),
    ).toBeTruthy();
    // other models of the same backend appear, without the default marker
    expect(within(menu).getByText("Claude API · Claude Opus 4.8")).toBeTruthy();
    expect(within(menu).getByText("Claude API · Claude Sonnet 5")).toBeTruthy();
    // agy's CLI path was detected → all its models appear; a non-default
    // backend carries no marker
    expect(within(menu).getByText(slotLabel("agy:flash"))).toBeTruthy();
    // unavailable backends are absent: claudeCli/codex undetected, deepseek
    // has no key
    expect(within(menu).queryByText(/Claude CLI/)).toBeNull();
    expect(within(menu).queryByText(/^Codex/)).toBeNull();
    expect(within(menu).queryByText(/DeepSeek/)).toBeNull();
  });

  it("菜单开着时点主按钮跑默认分析 → 菜单同步关闭,不留可点的旧菜单项(agy flash 复核)", async () => {
    const fx = pickerFixture();
    render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    await screen.findByText(/第30秒阵亡/);
    fireEvent.click(screen.getByRole("button", { name: "选用其他模型分析" }));
    await screen.findByTestId("analysis-model-menu");

    fireEvent.click(screen.getByRole("button", { name: "重新分析" }));

    // The menu must already be closed — otherwise the user could click a menu
    // item after the default analysis is already running, and main's nextGen
    // would cut off the request just sent (burning a round of tokens).
    expect(screen.queryByTestId("analysis-model-menu")).toBeNull();
    expect(fx.analysis.run).toHaveBeenCalledTimes(1);
    expect(
      (fx.analysis.run.mock.calls[0][0] as { backendOverride?: unknown })
        .backendOverride,
    ).toBeUndefined();
  });

  it("选中菜单项 → run 收到 backendOverride,不写 settings,菜单关闭", async () => {
    const fx = pickerFixture();
    render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    await screen.findByText(/第30秒阵亡/);
    fireEvent.click(screen.getByRole("button", { name: "选用其他模型分析" }));
    const menu = await screen.findByTestId("analysis-model-menu");
    fireEvent.click(within(menu).getByText(slotLabel("agy:flash")));

    expect(fx.analysis.run).toHaveBeenCalledWith(
      expect.objectContaining({
        backendOverride: { backend: "agy", model: "flash" },
      }),
    );
    expect(fx.settings.save).not.toHaveBeenCalled();
    expect(screen.queryByTestId("analysis-model-menu")).toBeNull();
  });

  it("Esc 关闭菜单", async () => {
    pickerFixture();
    render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    await screen.findByText(/第30秒阵亡/);
    fireEvent.click(screen.getByRole("button", { name: "选用其他模型分析" }));
    await screen.findByTestId("analysis-model-menu");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByTestId("analysis-model-menu")).toBeNull(),
    );
  });

  it("点击菜单外部关闭菜单", async () => {
    pickerFixture();
    render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    await screen.findByText(/第30秒阵亡/);
    fireEvent.click(screen.getByRole("button", { name: "选用其他模型分析" }));
    await screen.findByTestId("analysis-model-menu");
    fireEvent.mouseDown(document.body);
    await waitFor(() =>
      expect(screen.queryByTestId("analysis-model-menu")).toBeNull(),
    );
  });

  it("分析进行中时箭头禁用", async () => {
    const fx = pickerFixture();
    // With the stub's minimal source, buildAnalysisInput is always null (the
    // pre-existing test limitation recorded in the Task 3 report), so clicking
    // the main button never actually enters running — instead getState makes
    // the panel read "still running" on remount, the same technique as the
    // existing "first round still running on remount" case.
    fx.analysis.getState = vi.fn().mockResolvedValue({
      cached: null,
      running: true,
      slots: [],
      activeKey: null,
    });
    render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    const arrow = await screen.findByRole("button", {
      name: "选用其他模型分析",
    });
    expect((arrow as HTMLButtonElement).disabled).toBe(true);
  });
});
