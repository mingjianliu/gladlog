// @vitest-environment jsdom
// Task 7 (§6.9 check 5): the statistics page renders no CJK in English mode.
// Fixture data (titles, explanations, rule text) is ASCII, so any CJK left in
// the DOM is UI copy that missed the dictionary.
import { CJK_LEAK } from "@gladlog/analysis/src/utils/localizedText";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StoredMatchMeta } from "../src/main/matchStore";
import { StatsDashboard } from "../src/renderer/src/components/StatsDashboard";
import { LangProvider } from "../src/renderer/src/i18n/LangProvider";

const H = 3_600_000;

function meta(over: Partial<StoredMatchMeta>): StoredMatchMeta {
  return {
    id: Math.random().toString(36).slice(2),
    kind: "match",
    bracket: "3v3",
    zoneId: "1505",
    startTime: Date.now() - H,
    endTime: Date.now() - H + 300_000,
    result: "win",
    storedAt: 1,
    durationS: 300,
    avgRating: 2400,
    teams: [
      [{ specId: 105, classId: 11 }],
      [
        { specId: 64, classId: 8 },
        { specId: 71, classId: 1 },
      ],
    ],
    ...over,
  };
}

const rule = {
  ruleId: "r1",
  status: "active",
  category: "survival",
  eventTypes: ["death"],
  condition: { enemySpec: 64 },
  stats: {
    windowMatches: 10,
    hits: 4,
    firstSeen: 0,
    lastSeen: 0,
    trend: [1, 0, 2],
  },
  description: { en: "Died to {{hits}} kill windows" },
  advice: { en: "Trinket earlier" },
  evidence: ["m1"],
  distilledAt: 0,
  distillModel: "x",
};

function install(
  list: () => Promise<StoredMatchMeta[]>,
  language: "zh" | "en" = "en",
) {
  (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
    settings: {
      get: async () => ({ language }),
      save: async (p: unknown) => p,
    },
    matches: {
      list: vi.fn(list),
      rebuildIndex: vi.fn(async () => ({ updated: 3, failed: 1 })),
    },
    logs: { onMatchStored: () => () => {} },
    analysis: {
      notebook: async () => [
        {
          category: "survival",
          count: 2,
          recurring: 1,
          done: 1,
          entries: [
            {
              matchId: "m1",
              flagKey: "k1",
              flag: "recurring",
              title: "Died in the open",
              explanation: "No defensive",
              severity: "high",
              startTime: Date.now() - H,
              zoneId: "1505",
              result: "win",
              bracket: "3v3",
            },
          ],
        },
      ],
      setFlag: async () => {},
    },
    learning: {
      getRules: async () => ({
        schemaVersion: 1,
        updatedAt: 0,
        ledgerMatches: 5,
        rules: [rule],
      }),
      getState: async () => ({
        backfill: null,
        consolidating: false,
        ledgerMatches: 5,
        badLines: 2,
        lastConsolidatedAt: null,
      }),
      onDone: () => () => {},
      onProgress: () => () => {},
      onError: () => () => {},
    },
  };
}

/** Visible text plus the attribute copy a user can still read or hear. */
function leaks(root: Element): string[] {
  const out: string[] = [];
  if (CJK_LEAK.test(root.textContent ?? ""))
    out.push(`text: ${root.textContent}`);
  for (const el of root.querySelectorAll("*")) {
    for (const a of ["title", "aria-label", "placeholder", "alt"]) {
      const v = el.getAttribute(a);
      if (v && CJK_LEAK.test(v)) out.push(`${a}: ${v}`);
    }
  }
  return out;
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { __gladlogFixture?: unknown }).__gladlogFixture;
});

describe("英文模式:统计页不漏中文", () => {
  it("总览 + 练习卡 + 阵容/地图 + 最近对局 + 评分曲线弹窗", async () => {
    const now = Date.now();
    install(async () => [
      meta({ id: "m1", startTime: now - H }),
      meta({ result: "loss", avgRating: 2350, startTime: now - 2 * H }),
      meta({ startTime: now - 3 * H, teams: undefined }),
    ]);
    const { container } = render(
      <LangProvider>
        <StatsDashboard onOpenMatch={() => {}} onZoneClick={() => {}} />
      </LangProvider>,
    );
    await screen.findByText("Record");
    await screen.findByText("Died to 4 kill windows");
    // Open a notebook group so its entries render too.
    fireEvent.click(await screen.findByText("Survival"));
    await screen.findByText("Died in the open");
    expect(
      container.querySelector(".dash-nb-sev .rpt-finding-sev")!.textContent,
    ).toBe("High");
    const text = container.textContent ?? "";
    for (const s of [
      "Matches",
      "Win rate",
      "Current rating (3v3)",
      "Median duration",
      "Ledger: 5 matches · not consolidated yet · 2 bad lines skipped",
      "Recurring · 4 of last 10 matches",
      "Vs enemy comps",
      " · 1 older match has no comp data ",
      "By map",
      "Recent matches",
    ])
      expect(text).toContain(s);
    expect(leaks(container)).toEqual([]);

    fireEvent.click(screen.getByLabelText("Expand the rating curve"));
    const dialog = screen.getByRole("dialog", { name: "Rating curve" });
    expect(dialog.textContent).toContain(
      "Rating curve (your rating; older matches fall back to the team average)",
    );
    expect(leaks(container)).toEqual([]);
  });

  it("阵容空态与重建结果", async () => {
    install(async () => [meta({ teams: undefined })]);
    const { container } = render(
      <LangProvider>
        <StatsDashboard />
      </LangProvider>,
    );
    await screen.findByText(/No comp data — older matches have no comp index/);
    fireEvent.click(screen.getByTestId("dash-rebuild"));
    await waitFor(() =>
      expect(container.textContent).toContain(
        "Rebuilt: 3 matches updated, 1 failed",
      ),
    );
    expect(leaks(container)).toEqual([]);
  });
});

describe("错题本条目的严重度走词典", () => {
  it("中文模式显示「高」而不是 high", async () => {
    install(async () => [meta({ id: "m1", startTime: Date.now() - H })], "zh");
    const { container } = render(
      <LangProvider>
        <StatsDashboard onOpenMatch={() => {}} onZoneClick={() => {}} />
      </LangProvider>,
    );
    fireEvent.click(await screen.findByText("生存"));
    await screen.findByText("Died in the open");
    expect(
      container.querySelector(".dash-nb-sev .rpt-finding-sev")!.textContent,
    ).toBe("高");
  });
});

describe("学到的规则:zh 模式回退到英文描述时标语言(§6.13)", () => {
  it("只有 en 描述/建议 → 两处各带「英文分析」标签;有 zh 的不带", async () => {
    install(async () => [meta({ id: "m1", startTime: Date.now() - H })], "zh");
    const { container } = render(
      <LangProvider>
        <StatsDashboard onOpenMatch={() => {}} onZoneClick={() => {}} />
      </LangProvider>,
    );
    await screen.findByText(/Died to 4 kill windows/);
    const desc = container.querySelector(".dash-learning-desc")!;
    const adv = container.querySelector(".dash-learning-advice")!;
    expect(desc.getAttribute("data-content-lang")).toBe("en");
    expect(
      desc.querySelector("[data-testid=content-lang-badge]")?.textContent,
    ).toBe("英文分析");
    expect(
      adv.querySelector("[data-testid=content-lang-badge]"),
    ).not.toBeNull();
  });

  it("有 zh 描述时不标;en 模式只显示 en,不标", async () => {
    install(async () => [meta({ id: "m1", startTime: Date.now() - H })], "zh");
    const prev = { ...rule.description };
    const prevAdv = { ...rule.advice };
    Object.assign(rule.description, { zh: "被击杀窗口打死 {{hits}} 次" });
    Object.assign(rule.advice, { zh: "早交饰品" });
    try {
      const { container } = render(
        <LangProvider>
          <StatsDashboard onOpenMatch={() => {}} onZoneClick={() => {}} />
        </LangProvider>,
      );
      await screen.findByText(/被击杀窗口打死 4 次/);
      expect(
        container.querySelectorAll("[data-testid=content-lang-badge]"),
      ).toHaveLength(0);
      cleanup();
      install(
        async () => [meta({ id: "m1", startTime: Date.now() - H })],
        "en",
      );
      const en = render(
        <LangProvider>
          <StatsDashboard onOpenMatch={() => {}} onZoneClick={() => {}} />
        </LangProvider>,
      );
      await screen.findByText("Died to 4 kill windows");
      expect(
        en.container.querySelector(
          ".dash-learning-desc [data-testid=content-lang-badge]",
        ),
      ).toBeNull();
    } finally {
      rule.description = prev as typeof rule.description;
      rule.advice = prevAdv as typeof rule.advice;
    }
  });
});

describe("学到的规则:en 模式回退到中文描述时标语言(§6.13)", () => {
  it("只有 zh 描述/建议 → en 模式显示中文原文,两处各带 Analyzed in Chinese", async () => {
    install(async () => [meta({ id: "m1", startTime: Date.now() - H })], "en");
    const prev = rule.description;
    const prevAdv = rule.advice;
    rule.description = { zh: "被击杀窗口打死 {{hits}} 次" } as typeof prev;
    rule.advice = { zh: "早交饰品" } as typeof prevAdv;
    try {
      const { container } = render(
        <LangProvider>
          <StatsDashboard onOpenMatch={() => {}} onZoneClick={() => {}} />
        </LangProvider>,
      );
      await screen.findByText(/被击杀窗口打死 4 次/);
      const desc = container.querySelector(".dash-learning-desc")!;
      const adv = container.querySelector(".dash-learning-advice")!;
      expect(desc.getAttribute("data-content-lang")).toBe("zh");
      expect(adv.getAttribute("data-content-lang")).toBe("zh");
      expect(adv.textContent).toContain("早交饰品");
      expect(
        desc.querySelector("[data-testid=content-lang-badge]")?.textContent,
      ).toBe("Analyzed in Chinese");
      expect(
        adv.querySelector("[data-testid=content-lang-badge]")?.textContent,
      ).toBe("Analyzed in Chinese");
      expect(container.textContent).not.toContain(
        "(description arrives with the next consolidation)",
      );
    } finally {
      rule.description = prev;
      rule.advice = prevAdv;
    }
  });

  it("两种语言都没有 → 占位文案,不显示建议,不带标签", async () => {
    install(async () => [meta({ id: "m1", startTime: Date.now() - H })], "en");
    const prev = rule.description;
    const prevAdv = rule.advice;
    rule.description = {} as typeof prev;
    rule.advice = {} as typeof prevAdv;
    try {
      const { container } = render(
        <LangProvider>
          <StatsDashboard onOpenMatch={() => {}} onZoneClick={() => {}} />
        </LangProvider>,
      );
      await screen.findByText(
        "(description arrives with the next consolidation)",
      );
      expect(container.querySelector(".dash-learning-advice")).toBeNull();
      expect(
        container.querySelector(
          ".dash-learning-desc [data-testid=content-lang-badge]",
        ),
      ).toBeNull();
    } finally {
      rule.description = prev;
      rule.advice = prevAdv;
    }
  });
});
