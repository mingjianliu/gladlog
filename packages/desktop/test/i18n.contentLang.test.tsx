// @vitest-environment jsdom
// Task 8 (spec §6.13): AI content generated in the other language is shown
// with a language label, and the per-match card then offers only one action —
// re-analyze in the current language. Deep dive, window analysis and the
// coach chat stay out of reach on that content (plan Review Focus 3: they
// would write into the current language's cache on top of the other
// language's findings).
//
// Also the Task 6b carry: en render coverage for the recording view and for
// the report's AI-results state. The fallback zh content is data — it is
// excluded only inside the labelled region (`[data-content-lang]`).
import { ensureAnalysisData } from "@gladlog/analysis";
import { CJK_LEAK } from "@gladlog/analysis/src/utils/localizedText";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { StatsDashboard } from "../src/renderer/src/components/StatsDashboard";
import { LangProvider, useT } from "../src/renderer/src/i18n/LangProvider";
import { CoachChatCard } from "../src/renderer/src/report/components/CoachChatCard";
import { ContentLangBadge } from "../src/renderer/src/report/components/ContentLangBadge";
import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import { StructuredAnalysisPanel } from "../src/renderer/src/report/components/StructuredAnalysisPanel";
import {
  buildAnalysisInput,
  buildDeepenPacks,
} from "../src/renderer/src/report/derive/analysisInput";
import type { ReportSource } from "../src/renderer/src/report/derive/types";
import type { Language } from "../src/shared/i18n/index";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

// The panel's Analyze button needs a non-null input; the minimal source finds
// no owner under the real builder, so the panel cases swap in a fake input
// (the StructuredAnalysisPanel.test.tsx split-button pattern). MatchReport
// cases keep the real builders.
vi.mock("../src/renderer/src/report/derive/analysisInput", async (orig) => {
  const actual =
    await orig<
      typeof import("../src/renderer/src/report/derive/analysisInput")
    >();
  return {
    ...actual,
    buildAnalysisInput: vi.fn(actual.buildAnalysisInput),
    buildDeepenPacks: vi.fn(actual.buildDeepenPacks),
  };
});

const fakeInput = {
  matchId: "m1",
  candidates: [],
  richContext: "ctx",
  spec: "spec",
  ownerName: "Healer",
  enemySpecs: [],
};

const zhResult = {
  findings: [
    {
      eventIds: ["e1"],
      severity: "high",
      category: "survival",
      title: "死亡",
      explanation: "第30秒阵亡。",
    },
  ],
  dropped: 0,
  hadNarration: true,
};
const enResult = {
  findings: [
    {
      eventIds: ["e1"],
      severity: "high",
      category: "survival",
      title: "Caught without a defensive",
      explanation: "No defensive was up.",
    },
  ],
  dropped: 0,
  hadNarration: true,
};

/** Every CJK piece the user can see (text plus readable attributes), skipping
 * the labelled other-language region. */
function visibleCjk(root: HTMLElement): string[] {
  const out: string[] = [];
  const inLabelled = (el: Element) => el.closest("[data-content-lang]") != null;
  root.querySelectorAll("*").forEach((el) => {
    if (inLabelled(el)) return;
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent ?? "")
      .join("");
    if (CJK_LEAK.test(own)) out.push(`text <${el.tagName}>: ${own}`);
    for (const a of ["title", "aria-label", "placeholder", "alt"]) {
      const v = el.getAttribute(a);
      if (v && CJK_LEAK.test(v)) out.push(`${a} <${el.tagName}>: ${v}`);
    }
  });
  return out;
}

type Calls = {
  run: ReturnType<typeof vi.fn>;
  deepen: ReturnType<typeof vi.fn>;
  analyzeWindow: ReturnType<typeof vi.fn>;
};

/** Bridge stub: settings in `language`, the analysis cache answering with
 * `cached` (tagged `contentLang`), everything else "nothing there". */
function installBridge(opts: {
  language: Language;
  cached: unknown;
  contentLang: Language;
  video?: boolean;
  /** Replaces analysis-facet members (e.g. a capturing onDone). */
  analysisOverrides?: Record<string, unknown>;
}): Calls {
  const calls: Calls = {
    run: vi.fn().mockResolvedValue(undefined),
    deepen: vi.fn().mockResolvedValue(undefined),
    analyzeWindow: vi.fn().mockResolvedValue({ status: "no-client" }),
  };
  const cached = opts.cached
    ? { ...(opts.cached as object), contentLang: opts.contentLang }
    : null;
  const settings = {
    wowDirectory: null,
    anthropicApiKey: null,
    deepseekApiKey: null,
    aiModels: {},
    aiBackend: "anthropic",
    aiBackendCommand: null,
    language: opts.language,
    autoAnalyzeNew: false,
    aiSelfReview: false,
    autoCheckUpdates: true,
  };
  const analysis: Record<string, unknown> = {
    getState: async () => ({
      cached,
      lang: opts.language,
      running: false,
      runningMeta: null,
      slots: [
        { key: "anthropic:claude-opus-5-5", createdAt: 1, stale: false },
        { key: "anthropic:claude-opus-4-8", createdAt: 2, stale: false },
      ],
      activeKey: "anthropic:claude-opus-4-8",
    }),
    getCached: async () => cached,
    getFlags: async () => ({}),
    aggregate: async () => [],
    run: calls.run,
    deepen: calls.deepen,
    analyzeWindow: calls.analyzeWindow,
    ...opts.analysisOverrides,
  };
  const surface = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          if (name === "settings" && prop === "get")
            return async () => ({ ...settings });
          if (name === "chat" && prop === "getState")
            return async () => ({ status: "not-ready" });
          if (name === "analysis" && prop in analysis) return analysis[prop];
          if (name === "recorder" && prop === "getForMatch")
            return async () =>
              opts.video ? { url: "file:///rec.mp4", startedAt: 0 } : null;
          if (prop.startsWith("on")) return () => () => {};
          return async () => null;
        },
      },
    );
  (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture =
    new Proxy({}, { get: (_t, ns: string) => surface(ns) });
  return calls;
}

/** Deep copy with every CJK string replaced by a stable ASCII token (the log
 * was recorded on a Chinese client; names are log data, not UI copy). */
function asciiLog<T>(value: T): T {
  const tokens = new Map<string, string>();
  return JSON.parse(JSON.stringify(value), (_k, v: unknown) => {
    if (typeof v !== "string" || !CJK_LEAK.test(v)) return v;
    let t = tokens.get(v);
    if (!t) {
      t = `LogName${tokens.size}`;
      tokens.set(v, t);
    }
    return t;
  }) as T;
}
const sample = () =>
  asciiLog(loadRealMatchFixture()) as unknown as ReportSource;

function renderPanel() {
  return render(
    <LangProvider firstRunPicker={false}>
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as unknown as ReportSource}
        matchId="m1"
      />
    </LangProvider>,
  );
}

async function renderReport(initialView: "ai" | "video") {
  const utils = render(
    <LangProvider firstRunPicker={false}>
      <MatchReport source={sample()} matchId="m-cl" initialView={initialView} />
    </LangProvider>,
  );
  await waitFor(
    () =>
      expect(
        utils.container.querySelector('[data-fill="done"]'),
      ).not.toBeNull(),
    { timeout: 10000 },
  );
  return utils;
}

beforeAll(async () => {
  await ensureAnalysisData();
});
afterEach(() => {
  cleanup();
  vi.mocked(buildAnalysisInput).mockReset();
  vi.mocked(buildDeepenPacks).mockReset();
});

describe("ContentLangBadge", () => {
  it("内容语言与界面语言相同时什么都不渲染,不同时显示对应标签", async () => {
    installBridge({ language: "en", cached: null, contentLang: "en" });
    const { container } = render(
      <LangProvider firstRunPicker={false}>
        <span data-testid="same">
          <ContentLangBadge contentLang="en" />
        </span>
        <span data-testid="other">
          <ContentLangBadge contentLang="zh" />
        </span>
      </LangProvider>,
    );
    expect((await screen.findByTestId("other")).textContent).toBe(
      "Analyzed in Chinese",
    );
    expect(screen.getByTestId("same").textContent).toBe("");
    expect(visibleCjk(container)).toEqual([]);
  });

  it("中文模式下英文内容标「英文分析」", async () => {
    installBridge({ language: "zh", cached: null, contentLang: "zh" });
    render(
      <LangProvider firstRunPicker={false}>
        <span data-testid="other">
          <ContentLangBadge contentLang="en" />
        </span>
      </LangProvider>,
    );
    expect((await screen.findByTestId("other")).textContent).toBe("英文分析");
  });
});

describe("单局卡片显示另一种语言的回退内容(Review Focus 3)", () => {
  beforeEach(() => {
    vi.mocked(buildAnalysisInput).mockReturnValue(fakeInput as never);
    vi.mocked(buildDeepenPacks).mockReturnValue([]);
  });

  it("en 模式 + zh 回退:有标签和「Re-analyze in English」,没有深挖 / 换模型 / 分槽 / 标记;按钮走和「分析」相同的 IPC", async () => {
    const calls = installBridge({
      language: "en",
      cached: zhResult,
      contentLang: "zh",
    });
    const { container } = renderPanel();
    expect(await screen.findByText(/第30秒阵亡/)).toBeTruthy();
    expect(screen.getByTestId("content-lang-badge").textContent).toBe(
      "Analyzed in Chinese",
    );
    const btn = await screen.findByRole("button", {
      name: "Re-analyze in English",
    });
    await waitFor(() =>
      expect((btn as HTMLButtonElement).disabled).toBe(false),
    );
    // no other actions on fallback content
    expect(screen.queryByTestId("analysis-model-picker")).toBeNull();
    expect(screen.queryByTestId("analysis-slot-tabs")).toBeNull();
    expect(container.querySelector(".rpt-ai-export")).toBeNull();
    expect(container.querySelector(".rpt-finding-flags")).toBeNull();
    // the automatic deep dive never fires on it
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.deepen).not.toHaveBeenCalled();
    // the UI copy around it is English; only the labelled region holds zh
    expect(visibleCjk(container)).toEqual([]);

    fireEvent.click(btn);
    await waitFor(() => expect(calls.run).toHaveBeenCalledTimes(1));
    expect(calls.run).toHaveBeenCalledWith(fakeInput);
  });

  it("对照:同语言的结果照常深挖,没有标签,按钮是普通的「Re-analyze」", async () => {
    const calls = installBridge({
      language: "en",
      cached: enResult,
      contentLang: "en",
    });
    renderPanel();
    expect(await screen.findByText(/No defensive was up/)).toBeTruthy();
    expect(screen.queryByTestId("content-lang-badge")).toBeNull();
    expect(screen.getByRole("button", { name: "Re-analyze" })).toBeTruthy();
    expect(screen.getByTestId("analysis-model-picker")).toBeTruthy();
    expect(screen.getByTestId("analysis-slot-tabs")).toBeTruthy();
    await waitFor(() => expect(calls.deepen).toHaveBeenCalledTimes(1));
    // the packs' chip labels are built in the findings' language (spec §6.5)
    expect(vi.mocked(buildDeepenPacks).mock.calls[0]![4]).toBe("en");
  });

  it("老 stub 没有 contentLang:当作当前语言(不出标签)", async () => {
    const calls = installBridge({
      language: "en",
      cached: enResult,
      contentLang: undefined as unknown as Language,
    });
    renderPanel();
    expect(await screen.findByText(/No defensive was up/)).toBeTruthy();
    expect(screen.queryByTestId("content-lang-badge")).toBeNull();
    await waitFor(() => expect(calls.deepen).toHaveBeenCalledTimes(1));
  });
});

describe("战报 AI 视图:回退内容时不给问教练 / 选段入口", () => {
  it("en 模式 + zh 回退:问教练卡不出现,AI 视图文案无中文(标注区域除外)", async () => {
    installBridge({ language: "en", cached: zhResult, contentLang: "zh" });
    const { container } = await renderReport("ai");
    await screen.findByTestId("content-lang-badge");
    // the panel reports the fallback from a passive effect, after the badge
    // has painted
    await waitFor(() =>
      expect(screen.queryByTestId("coach-chat-card")).toBeNull(),
    );
    expect(screen.queryByTestId("uncovered-highlights-card")).toBeNull();
    expect(visibleCjk(container)).toEqual([]);
  });

  it("对照:en 结果时问教练卡照常出现,整个 AI 视图无中文", async () => {
    installBridge({ language: "en", cached: enResult, contentLang: "en" });
    const { container } = await renderReport("ai");
    expect(await screen.findByText(/No defensive was up/)).toBeTruthy();
    expect(await screen.findByTestId("coach-chat-card")).toBeTruthy();
    expect(container.querySelector("[data-content-lang]")).toBeNull();
    expect(visibleCjk(container)).toEqual([]);
  });
});

describe("录像视图英文模式(Task 6b carry)", () => {
  it("录像视图无中文;回退来的 zh findings 不变成录像上的 AI 标记", async () => {
    // a deep-dive chip would become an AI marker on the recording
    const withChip = {
      ...zhResult,
      findings: [
        {
          ...zhResult.findings[0],
          deepDive: { chips: [{ t: 10, label: "被集火的瞬间" }] },
        },
      ],
    };
    installBridge({
      language: "en",
      cached: withChip,
      contentLang: "zh",
      video: true,
    });
    const { container } = await renderReport("video");
    await waitFor(() =>
      expect(container.querySelector(".rpt-video-tab")).not.toBeNull(),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(visibleCjk(container)).toEqual([]);
    expect(container.textContent).not.toContain("被集火的瞬间");
  });
});

describe("笔记本条目的语言标签(汇总视图只标条目)", () => {
  it("en 模式下 zh 条目带「Analyzed in Chinese」,en 条目不带;没有逐条重新分析按钮", async () => {
    const entry = (title: string, contentLang: Language, flagKey: string) => ({
      matchId: "m1",
      flagKey,
      flag: null,
      title,
      explanation: "",
      severity: "high",
      startTime: Date.now(),
      zoneId: "1505",
      result: "win",
      bracket: "3v3",
      contentLang,
    });
    (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
      settings: {
        get: async () => ({ language: "en" }),
        save: async () => ({}),
      },
      matches: { list: async () => [] },
      logs: { onMatchStored: () => () => {} },
      analysis: {
        notebook: async () => [
          {
            category: "survival",
            count: 2,
            recurring: 0,
            done: 0,
            entries: [
              entry("死在空地", "zh", "k1"),
              entry("Died in the open", "en", "k2"),
            ],
          },
        ],
        setFlag: async () => ({}),
      },
    };
    const { container } = render(
      <LangProvider firstRunPicker={false}>
        <StatsDashboard />
      </LangProvider>,
    );
    fireEvent.click(await screen.findByText("Survival"));
    await screen.findByText("Died in the open");
    const rows = Array.from(container.querySelectorAll(".dash-nb-entry"));
    expect(rows).toHaveLength(2);
    const badgeOf = (r: Element) =>
      r.querySelector("[data-testid=content-lang-badge]")?.textContent ?? null;
    expect(rows.map(badgeOf)).toEqual(["Analyzed in Chinese", null]);
    expect(
      screen.queryByRole("button", { name: "Re-analyze in English" }),
    ).toBeNull();
    expect(visibleCjk(container)).toEqual([]);
  });
});

describe("问教练重新播种不带另一种语言的 findings", () => {
  async function seedSummaryFor(contentLang: Language): Promise<string> {
    vi.mocked(buildAnalysisInput).mockReturnValue(fakeInput as never);
    const send = vi
      .fn()
      .mockResolvedValueOnce({ status: "need-reseed" })
      .mockResolvedValueOnce({ status: "ok" });
    (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
      settings: { get: async () => ({ language: "en" }) },
      chat: {
        getState: async () => ({
          status: "ready",
          backend: "claude-cli",
          model: "m",
          messages: [],
          busy: false,
        }),
        send,
        cancel: async () => {},
      },
      analysis: {
        getCached: async () => ({ ...zhResult, contentLang }),
        onDone: () => () => {},
      },
    };
    render(
      <LangProvider firstRunPicker={false}>
        <CoachChatCard
          source={{ units: {}, startInfo: {} } as unknown as ReportSource}
          matchId="m1"
        />
      </LangProvider>,
    );
    fireEvent.change(await screen.findByLabelText("Ask the coach a question"), {
      target: { value: "why?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    return send.mock.calls[1]![0].seed.findingsSummary as string;
  }

  it("en 模式下 getCached 回退来的 zh 结果:播种摘要为 (none)", async () => {
    expect(await seedSummaryFor("zh")).toBe("(none)");
  });

  it("对照:同语言的结果照常写进播种摘要", async () => {
    expect(await seedSummaryFor("en")).toContain("死亡");
  });
});

describe("问教练:发送时固定语言 + 另一种语言的历史(codex B2#1 / A#5 / B2#6)", () => {
  /** Exposes the provider's setLang so a case can switch mid-flight. */
  let switchLang: ((l: Language) => Promise<boolean>) | null = null;
  function LangHandle() {
    switchLang = useT().setLang;
    return null;
  }

  it("need-reseed 重试沿用发送时的语言:两次 send 都带 zh,即使中途切到 en;回退判断按固定语言", async () => {
    vi.mocked(buildAnalysisInput).mockReturnValue(fakeInput as never);
    const send = vi
      .fn()
      .mockImplementationOnce(async () => {
        await switchLang!("en"); // the user switches while the CLI resumes
        return { status: "need-reseed" };
      })
      .mockResolvedValueOnce({ status: "lang-mismatch" });
    (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
      settings: {
        get: async () => ({ language: "zh" }),
        save: async (p: unknown) => p,
      },
      chat: {
        getState: async () => ({
          status: "ready",
          backend: "claude-cli",
          model: "m",
          messages: [],
          busy: false,
        }),
        send,
        cancel: async () => {},
      },
      analysis: {
        getCached: async () => ({ ...zhResult, contentLang: "zh" }),
        onDone: () => () => {},
      },
    };
    render(
      <LangProvider firstRunPicker={false}>
        <LangHandle />
        <CoachChatCard
          source={{ units: {}, startInfo: {} } as unknown as ReportSource}
          matchId="m1"
        />
      </LangProvider>,
    );
    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "为什么?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls.map((c) => c[0].lang)).toEqual(["zh", "zh"]);
    // pinned zh: the zh result is this language's, so it seeds
    expect(send.mock.calls[1]![0].seed.findingsSummary).toContain("死亡");
  });

  it("en 模式下只有 zh 的聊天记录:作为只读历史显示并带语言标签;not-ready 时无输入框", async () => {
    (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
      settings: { get: async () => ({ language: "en" }) },
      chat: {
        getState: async () => ({
          status: "not-ready",
          history: {
            contentLang: "zh",
            model: "m",
            messages: [
              { role: "user", content: "为什么输了?", at: 1 },
              { role: "assistant", content: "因为没交保命。", at: 1 },
            ],
          },
        }),
        send: vi.fn(),
        cancel: async () => {},
      },
      analysis: { onDone: () => () => {} },
    };
    const { container } = render(
      <LangProvider firstRunPicker={false}>
        <CoachChatCard
          source={{ units: {}, startInfo: {} } as unknown as ReportSource}
          matchId="m1"
        />
      </LangProvider>,
    );
    expect(await screen.findByText("为什么输了?")).toBeTruthy();
    expect(screen.getByText("因为没交保命。")).toBeTruthy();
    expect(screen.getByTestId("content-lang-badge").textContent).toBe(
      "Analyzed in Chinese",
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(visibleCjk(container)).toEqual([]);
  });

  it("ready 且有另一种语言的历史:历史带标签在上,新发送照常走当前语言", async () => {
    const send = vi.fn().mockResolvedValue({ status: "ok", reply: "x" });
    (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
      settings: { get: async () => ({ language: "en" }) },
      chat: {
        getState: async () => ({
          status: "ready",
          backend: "claude-cli",
          model: "m",
          messages: [],
          busy: false,
          history: {
            contentLang: "zh",
            model: "m",
            messages: [{ role: "user", content: "旧问题", at: 1 }],
          },
        }),
        send,
        cancel: async () => {},
      },
      analysis: { onDone: () => () => {} },
    };
    render(
      <LangProvider firstRunPicker={false}>
        <CoachChatCard
          source={{ units: {}, startInfo: {} } as unknown as ReportSource}
          matchId="m1"
        />
      </LangProvider>,
    );
    expect(await screen.findByText("旧问题")).toBeTruthy();
    expect(screen.getByTestId("content-lang-badge")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Ask the coach a question"), {
      target: { value: "why?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]![0].lang).toBe("en");
  });

  it("语言切换时卡片重新取聊天状态", async () => {
    const getState = vi.fn().mockResolvedValue({ status: "not-ready" });
    (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
      settings: {
        get: async () => ({ language: "zh" }),
        save: async (p: unknown) => p,
      },
      chat: { getState, send: vi.fn(), cancel: async () => {} },
      analysis: { onDone: () => () => {} },
    };
    render(
      <LangProvider firstRunPicker={false}>
        <LangHandle />
        <CoachChatCard
          source={{ units: {}, startInfo: {} } as unknown as ReportSource}
          matchId="m1"
        />
      </LangProvider>,
    );
    await waitFor(() => expect(getState).toHaveBeenCalledTimes(1));
    await act(async () => {
      await switchLang!("en");
    });
    await waitFor(() => expect(getState).toHaveBeenCalledTimes(2));
  });
});

describe("AI 卡片:另一种语言的完成 / 在跑 / 无候选(codex A#7·B1#1·B2#2 / B2#3 / B2#8)", () => {
  it("en 结果在屏上时到达 zh 一轮的 done:不替换,按 getState 重新取(仍是 en 结果)", async () => {
    let done: ((d: unknown) => void) | null = null;
    const getState = vi.fn(async () => ({
      cached: { ...enResult, contentLang: "en" },
      lang: "en",
      running: false,
      runningMeta: null,
      slots: [],
      activeKey: null,
    }));
    installBridge({
      language: "en",
      cached: enResult,
      contentLang: "en",
      analysisOverrides: {
        getState,
        onDone: (cb: (d: unknown) => void) => {
          done = cb;
          return () => {
            done = null;
          };
        },
      },
    });
    renderPanel();
    expect(await screen.findByText(/No defensive was up/)).toBeTruthy();
    const before = getState.mock.calls.length;
    await act(async () => {
      done!({ matchId: "m1", result: zhResult, contentLang: "zh" });
    });
    await waitFor(() =>
      expect(getState.mock.calls.length).toBeGreaterThan(before),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText(/No defensive was up/)).toBeTruthy();
    expect(screen.queryByText(/第30秒阵亡/)).toBeNull();
    expect(screen.queryByTestId("content-lang-badge")).toBeNull();
  });

  it("getState 同时给回退内容和 running:恢复在跑状态(按钮禁用),回退内容照常在下面显示", async () => {
    installBridge({
      language: "en",
      cached: zhResult,
      contentLang: "zh",
      analysisOverrides: {
        getState: async () => ({
          cached: { ...zhResult, contentLang: "zh" },
          lang: "en",
          running: true,
          runningMeta: {
            since: Date.now(),
            backend: "anthropic",
            model: "claude-opus-5-5",
            retrying: false,
            reviewing: false,
          },
          slots: [],
          activeKey: null,
        }),
      },
    });
    vi.mocked(buildAnalysisInput).mockReturnValue(fakeInput as never);
    renderPanel();
    expect(await screen.findByText(/第30秒阵亡/)).toBeTruthy();
    const btn = await screen.findByRole("button", { name: "Analyzing…" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("getState 给 en 未深挖结果 + 一轮 zh 在跑:在跑期间不自动深挖;那一轮结束后才深挖(codex F2#2)", async () => {
    let done: ((d: unknown) => void) | null = null;
    let runningNow = true;
    const getState = vi.fn(async () => ({
      cached: { ...enResult, contentLang: "en" },
      lang: "en",
      running: runningNow,
      runningMeta: runningNow
        ? {
            since: Date.now(),
            backend: "anthropic",
            model: "claude-opus-5-5",
            retrying: false,
            reviewing: false,
          }
        : null,
      slots: [],
      activeKey: null,
    }));
    const calls = installBridge({
      language: "en",
      cached: enResult,
      contentLang: "en",
      analysisOverrides: {
        getState,
        onDone: (cb: (d: unknown) => void) => {
          done = cb;
          return () => {
            done = null;
          };
        },
      },
    });
    vi.mocked(buildAnalysisInput).mockReturnValue(fakeInput as never);
    renderPanel();
    expect(await screen.findByText(/No defensive was up/)).toBeTruthy();
    await screen.findByRole("button", { name: "Analyzing…" });
    await new Promise((r) => setTimeout(r, 50));
    // a deep dive here would bump the match's generation in main and cancel
    // the running zh round
    expect(calls.deepen).not.toHaveBeenCalled();
    // the zh round finishes (saved to the zh cache): the panel re-resolves
    runningNow = false;
    await act(async () => {
      done!({ matchId: "m1", result: zhResult, contentLang: "zh" });
    });
    await waitFor(() => expect(calls.deepen).toHaveBeenCalledTimes(1));
    expect(calls.deepen.mock.calls[0]![0].contentLang).toBe("en");
  });

  it("en 结果在屏上 + 一轮 zh 在跑:zh 的流式片段不显示在 en 结果下面;en 的照常显示(codex F2#9)", async () => {
    let delta: ((d: unknown) => void) | null = null;
    installBridge({
      language: "en",
      cached: enResult,
      contentLang: "en",
      analysisOverrides: {
        getState: async () => ({
          cached: { ...enResult, contentLang: "en" },
          lang: "en",
          running: true,
          runningMeta: {
            since: Date.now(),
            backend: "anthropic",
            model: "claude-opus-5-5",
            retrying: false,
            reviewing: false,
          },
          slots: [],
          activeKey: null,
        }),
        onDelta: (cb: (d: unknown) => void) => {
          delta = cb;
          return () => {
            delta = null;
          };
        },
      },
    });
    vi.mocked(buildAnalysisInput).mockReturnValue(fakeInput as never);
    const { container } = renderPanel();
    expect(await screen.findByText(/No defensive was up/)).toBeTruthy();
    await screen.findByRole("button", { name: "Analyzing…" });
    await act(async () => {
      delta!({ matchId: "m1", text: '[{"title":"死亡"', contentLang: "zh" });
    });
    expect(screen.queryByTestId("ai-preview")).toBeNull();
    expect(visibleCjk(container)).toEqual([]);
    await act(async () => {
      delta!({ matchId: "m1", text: '[{"title":"Death"', contentLang: "en" });
    });
    expect(screen.getByTestId("ai-preview").textContent).toContain("Death");
  });

  it("restore 在跑后那一轮失败(state=error):不对旧结果自动深挖,错误保留(codex F3#2)", async () => {
    let fail: ((d: unknown) => void) | null = null;
    let runningNow = true;
    const getState = vi.fn(async () => ({
      cached: { ...enResult, contentLang: "en" },
      lang: "en",
      running: runningNow,
      runningMeta: runningNow
        ? {
            since: Date.now(),
            backend: "anthropic",
            model: "claude-opus-5-5",
            retrying: false,
            reviewing: false,
          }
        : null,
      slots: [],
      activeKey: null,
    }));
    const calls = installBridge({
      language: "en",
      cached: enResult,
      contentLang: "en",
      analysisOverrides: {
        getState,
        onError: (cb: (d: unknown) => void) => {
          fail = cb;
          return () => {
            fail = null;
          };
        },
      },
    });
    vi.mocked(buildAnalysisInput).mockReturnValue(fakeInput as never);
    renderPanel();
    await screen.findByRole("button", { name: "Analyzing…" });
    runningNow = false;
    await act(async () => {
      fail!({ matchId: "m1", message: "backend exploded" });
    });
    expect(await screen.findByText(/backend exploded/)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 50));
    // a deep dive here would re-deepen the previous result and its done
    // would clear the error
    expect(calls.deepen).not.toHaveBeenCalled();
    expect(screen.getByText(/backend exploded/)).toBeTruthy();
  });

  it("en 无候选(hadNarration=false, no-candidates):空状态是英文,不出中文", async () => {
    const empty = {
      findings: [],
      dropped: 0,
      hadNarration: false,
      fallbackReason: "no-candidates",
    };
    installBridge({ language: "en", cached: empty, contentLang: "en" });
    const { container } = renderPanel();
    await screen.findByTestId("zero-finding-reason");
    expect(visibleCjk(container)).toEqual([]);
  });
});
