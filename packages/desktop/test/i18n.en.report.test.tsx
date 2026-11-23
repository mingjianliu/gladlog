// @vitest-environment jsdom
// Task 6b (§6.9 check 5): the match report's components word everything in
// English when the UI language is en. The fixture's log was recorded on a
// Chinese client, so every CJK string in it is first swapped for an ASCII
// token (spell / unit names are log data, spec §8 item 1's job): any CJK left
// on screen then came from a component, a derive or the dictionary.
import { ensureAnalysisData } from "@gladlog/analysis";
import { CJK_LEAK } from "@gladlog/analysis/src/utils/localizedText";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { LangProvider } from "../src/renderer/src/i18n/LangProvider";
import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import { StructuredAnalysisPanel } from "../src/renderer/src/report/components/StructuredAnalysisPanel";
import type { ReportSource } from "../src/renderer/src/report/derive/types";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

/** Deep copy with every CJK string replaced by a stable ASCII token. */
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

/** The ASCII fixture with one injected player death (the
 * report.deathrecap.test pattern), so the death recap card and death markers
 * render too. */
function sample(): ReportSource {
  const m = asciiLog(loadRealMatchFixture()) as unknown as ReportSource & {
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

/** A bridge with every surface stubbed to "nothing there": settings say en
 * with no AI backend, subscriptions return an unsubscribe, every other call
 * resolves to null. */
function installBridge() {
  const settings = {
    wowDirectory: null,
    anthropicApiKey: null,
    deepseekApiKey: null,
    aiModels: {},
    aiBackend: "anthropic",
    aiBackendCommand: null,
    language: "en",
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

/** Every CJK piece the user can see: text plus the attributes a screen
 * reader or a tooltip shows. */
function visibleCjk(root: HTMLElement): string[] {
  const out: string[] = [];
  const text = root.textContent ?? "";
  if (CJK_LEAK.test(text)) {
    // narrow down to the leaf elements that hold it
    root.querySelectorAll("*").forEach((el) => {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent ?? "")
        .join("");
      if (CJK_LEAK.test(own)) out.push(`text <${el.tagName}>: ${own}`);
    });
    if (out.length === 0) out.push(`text: ${text}`);
  }
  root.querySelectorAll("*").forEach((el) => {
    for (const a of ["title", "aria-label", "placeholder", "alt"]) {
      const v = el.getAttribute(a);
      if (v && CJK_LEAK.test(v)) out.push(`${a} <${el.tagName}>: ${v}`);
    }
  });
  return out;
}

async function renderReport() {
  installBridge();
  const utils = render(
    <LangProvider firstRunPicker={false}>
      <MatchReport source={sample()} matchId="m-en" />
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

describe("i18n: 战报组件英文模式不出中文", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });
  afterEach(cleanup);

  it("战报视图(含默认展开的死亡回顾)", async () => {
    const { container } = await renderReport();
    // the sample really renders the cards this covers
    expect(
      await screen.findByTestId("death-recap", {}, { timeout: 10000 }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Report" })).toBeTruthy();
    expect(visibleCjk(container)).toEqual([]);
  });

  it("回放 / 事件 / AI 视图", async () => {
    const { container } = await renderReport();
    const tabs = container.querySelector(".rpt-view-tabs") as HTMLElement;
    for (const name of ["Replay", "Events", "AI analysis"]) {
      const tab = () =>
        Array.from(tabs.querySelectorAll("button")).find(
          (b) => b.textContent === name,
        )!;
      fireEvent.click(tab());
      await waitFor(() => expect(tab().className).toContain("active"));
      expect({ view: name, cjk: visibleCjk(container) }).toEqual({
        view: name,
        cjk: [],
      });
    }
  });

  it("AI 卡的演示分析在英文模式下是英文版", async () => {
    installBridge();
    const { container } = render(
      <LangProvider firstRunPicker={false}>
        <StructuredAnalysisPanel source={sample()} matchId="m-demo" />
      </LangProvider>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "See a demo analysis" }),
    );
    expect(await screen.findByTestId("ai-demo-banner")).toBeTruthy();
    expect(screen.getByText("Focused down")).toBeTruthy();
    expect(visibleCjk(container)).toEqual([]);
  });
});
