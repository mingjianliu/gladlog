// @vitest-environment jsdom
// Task 9 (spec §8 item 1, Review Focus 5): spell names from a log recorded on
// a Chinese client read in English in the en UI, the English names arrive
// without a remount once the background name table loads, and the zh UI keeps
// showing the log's own names.
import * as analysis from "@gladlog/analysis";
import { CJK_LEAK } from "@gladlog/analysis/src/utils/localizedText";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { LangProvider } from "../src/renderer/src/i18n/LangProvider";
import { AuraUptimeCard } from "../src/renderer/src/report/components/AuraUptimeCard";
import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import type { AuraUptime } from "../src/renderer/src/report/derive/auraUptime";
import {
  resetSourceMemoForTest,
  setSourceMemoReadyForTest,
} from "../src/renderer/src/report/derive/sourceMemo";
import type { ReportSource } from "../src/renderer/src/report/derive/types";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

// The name table's loading is driven by the test: `gate.loaded` false = the
// 12 MB table has not streamed in yet (every id misses), and
// `gate.resolve()` is the moment it lands.
const gate = vi.hoisted(() => {
  const g = {
    loaded: true,
    resolve: () => {},
    promise: Promise.resolve(),
    reset() {
      g.loaded = false;
      g.promise = new Promise<void>((r) => {
        g.resolve = () => {
          g.loaded = true;
          r();
        };
      });
    },
  };
  return g;
});
vi.mock("@gladlog/analysis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@gladlog/analysis")>();
  return {
    ...actual,
    ensureSpellNames: () => (gate.loaded ? Promise.resolve() : gate.promise),
    spellNamesReady: () => gate.loaded,
    getEnglishSpellName: (id: string, fallback?: string | null) =>
      gate.loaded
        ? actual.getEnglishSpellName(id, fallback)
        : (fallback ?? "") || id,
  };
});

function installBridge(language: "zh" | "en") {
  const settings = {
    wowDirectory: null,
    anthropicApiKey: null,
    deepseekApiKey: null,
    aiModels: {},
    aiBackend: "anthropic",
    aiBackendCommand: null,
    language,
    autoAnalyzeNew: false,
    aiSelfReview: false,
    autoCheckUpdates: true,
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
          if (prop.startsWith("on")) return () => () => {};
          return async () => null;
        },
      },
    );
  (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture =
    new Proxy({}, { get: (_t, ns: string) => surface(ns) });
}

// Power Word: Shield, a spell the name table has.
const PWS_ID = "17";
const PWS_ZH = "真言术:盾";

function auraData(): AuraUptime {
  return {
    durationS: 100,
    groups: [
      {
        unitId: "u1",
        unitName: "Healer",
        classId: 5,
        reaction: "Friendly",
        rows: [
          {
            unitId: "u1",
            unitName: "Healer",
            classId: 5,
            reaction: "Friendly",
            spellId: PWS_ID,
            spellName: PWS_ZH,
            kind: "defense",
            intervals: [{ fromS: 10, toS: 20 }],
            uptimeS: 10,
            uptimePct: 10,
            applications: 1,
            hasInferred: false,
          },
        ],
        hiddenRows: [],
      },
    ],
  } as unknown as AuraUptime;
}

/** The marker a test spell name carries: `技<id>`. */
const MARK = /技\d+/;

/** Deep copy of the fixture in which every spell name the English table
 * knows is `技<id>` (a Chinese-client log of those spells) and every other
 * CJK string an ASCII token, so any `技` left on an en screen is a log spell
 * name a component printed as-is. */
function cjkSpellLog<T>(value: T): T {
  const tokens = new Map<string, string>();
  const known = (id: unknown) => {
    const s = id == null ? "" : String(id);
    return s !== "" && analysis.getEnglishSpellName(s, null) !== s ? s : null;
  };
  return JSON.parse(JSON.stringify(value), (_k, v: unknown) => {
    if (typeof v === "string" && CJK_LEAK.test(v)) {
      let t = tokens.get(v);
      if (!t) tokens.set(v, (t = `LogName${tokens.size}`));
      return t;
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      for (const key of Object.keys(o)) {
        const m = /^(.*)([sS])pellName$/.exec(key);
        if (!m) continue;
        const id = known(o[`${m[1]}${m[2]}pellId`]);
        if (id) o[key] = `技${id}`;
      }
    }
    return v;
  }) as T;
}

/** The fixture with one injected player death (the report.deathrecap.test
 * pattern), so the death recap renders too. */
function sample(): ReportSource {
  const m = cjkSpellLog(loadRealMatchFixture()) as unknown as ReportSource & {
    units: Record<string, Record<string, unknown>>;
  };
  const players = Object.values(m.units).filter(
    (u) => u.kind === "Player" && (u.damageIn as unknown[] | undefined)?.length,
  ) as unknown as Array<{
    id: string;
    name: string;
    damageIn: Array<{ timestamp: number }>;
    deaths: Array<Record<string, unknown>>;
  }>;
  players.sort((a, b) => b.damageIn.length - a.damageIn.length);
  const victim = players[0]!;
  const t = Math.max(...victim.damageIn.map((d) => d.timestamp));
  victim.deaths.push({
    timestamp: t,
    eventName: "UNIT_DIED",
    spellId: 0,
    spellName: "",
    srcId: "",
    srcName: "",
    destId: victim.id,
    destName: victim.name,
    unconscious: false,
  });
  return m;
}

/** Every marked spell name on screen: text plus tooltip attributes. */
function markedNames(root: HTMLElement): string[] {
  const out: string[] = [];
  root.querySelectorAll("*").forEach((el) => {
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent ?? "")
      .join("");
    if (MARK.test(own))
      out.push(`text <${el.tagName}.${el.className}>: ${own}`);
    for (const a of ["title", "aria-label", "alt"]) {
      const val = el.getAttribute(a);
      if (val && MARK.test(val)) out.push(`${a} <${el.tagName}>: ${val}`);
    }
  });
  return out;
}

async function renderReport(language: "zh" | "en", source: ReportSource) {
  installBridge(language);
  const utils = render(
    <LangProvider firstRunPicker={false}>
      <MatchReport source={source} matchId={`m-names-${language}`} />
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

async function eachView(
  container: HTMLElement,
  visit: (view: string) => void,
): Promise<void> {
  visit("Report");
  const tabs = container.querySelector(".rpt-view-tabs") as HTMLElement;
  for (const [i] of ["replay", "events"].entries()) {
    const tab = () =>
      Array.from(tabs.querySelectorAll("button"))[i + 1] as HTMLElement;
    fireEvent.click(tab());
    await waitFor(() => expect(tab().className).toContain("active"));
    visit(tab().textContent ?? String(i + 1));
  }
}

describe("i18n: 英文模式下的技能名(§8 第 1 条)", () => {
  beforeAll(async () => {
    await analysis.ensureAnalysisData();
  });
  afterEach(() => {
    cleanup();
    gate.loaded = true;
  });

  it("名字表没加载时先显示日志名,加载完不重新挂载就换成英文名(Review Focus 5)", async () => {
    gate.reset();
    installBridge("en");
    render(
      <LangProvider firstRunPicker={false}>
        <AuraUptimeCard data={auraData()} />
      </LangProvider>,
    );
    const cell = await screen.findByText(PWS_ZH);
    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    await waitFor(() => expect(cell.textContent).toBe("Power Word: Shield"));
    // same node: updated in place, not remounted
    expect(cell.isConnected).toBe(true);
    expect(screen.queryByText(PWS_ZH)).toBeNull();
  });

  it("战报里的 memo 路径(事件表 / 回放)也在名字表加载完后不重新挂载就换成英文名", async () => {
    const source = sample(); // built while the table is in: it marks known ids
    gate.reset();
    // the whole-match cache keeps nothing until the analysis tables (the
    // name table among them) are in — as in the app
    resetSourceMemoForTest(false);
    const { container } = await renderReport("en", source);
    const tabs = container.querySelector(".rpt-view-tabs") as HTMLElement;
    const events = Array.from(tabs.querySelectorAll("button"))[2]!;
    fireEvent.click(events);
    await waitFor(() => expect(events.className).toContain("active"));
    const panel = container.querySelector(".rpt-view-tabs")!.parentElement!;
    expect(markedNames(container).length).toBeGreaterThan(0);
    await act(async () => {
      gate.resolve();
      setSourceMemoReadyForTest(true);
      await gate.promise;
    });
    await waitFor(() => expect(markedNames(container)).toEqual([]));
    // same report, not a remount
    expect(panel.isConnected).toBe(true);
  });

  it("zh 模式下照旧显示日志名", async () => {
    installBridge("zh");
    render(
      <LangProvider firstRunPicker={false}>
        <AuraUptimeCard data={auraData()} />
      </LangProvider>,
    );
    expect(await screen.findByText(PWS_ZH)).toBeTruthy();
  });

  it("en 战报 / 回放 / 事件视图里没有原样印出的日志技能名", async () => {
    const source = sample();
    const { container } = await renderReport("en", source);
    const seen: Record<string, string[]> = {};
    await eachView(container, (view) => {
      seen[view] = markedNames(container);
    });
    expect(seen).toEqual(
      Object.fromEntries(Object.keys(seen).map((k) => [k, []])),
    );
  });

  it("zh 战报里日志技能名照旧(探针本身有效)", async () => {
    const { container } = await renderReport("zh", sample());
    let marked = 0;
    await eachView(container, () => {
      marked += markedNames(container).length;
    });
    expect(marked).toBeGreaterThan(0);
  });
});
