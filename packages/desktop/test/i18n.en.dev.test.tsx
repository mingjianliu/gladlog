// @vitest-environment jsdom
// Task 7 (§6.9 check 5): the developer page renders no CJK in English mode.
// Fixture data (match metas, the JSON doc, AI calls, diagnostics) is ASCII,
// so any CJK left in the DOM is UI copy that missed the dictionary.
import { CJK_LEAK } from "@gladlog/analysis/src/utils/localizedText";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DevPanel } from "../src/renderer/src/components/DevPanel";
import { formatTime } from "../src/renderer/src/i18n/format";
import { LangProvider } from "../src/renderer/src/i18n/LangProvider";
import { installDevFixture } from "./support/devPanelFixture";

function installEn(opts: Parameters<typeof installDevFixture>[0] = {}) {
  const h = installDevFixture(opts);
  const fx = (
    window as unknown as { __gladlogFixture: Record<string, unknown> }
  ).__gladlogFixture;
  fx.settings = {
    get: async () => ({ wowDirectory: null, language: "en" }),
    save: async () => ({}),
  };
  return h;
}

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

describe("英文模式:开发者页不漏中文", () => {
  it("监控区 + rail + 状态条 + 重建结果", async () => {
    installEn({
      status: {
        watching: false,
        logsDir: "",
        files: [
          {
            fileKey: "WoWCombatLog.txt",
            offset: 10,
            size: 20,
            quarantined: true,
          },
        ],
      } as never,
    });
    const { container } = render(
      <LangProvider>
        <DevPanel />
      </LangProvider>,
    );
    await screen.findByText("Watch status", { selector: "h2" });
    await screen.findByText("⛔ Not watching (no folder)");
    fireEvent.click(screen.getByTestId("dev-rebuild"));
    await screen.findByText("Updated 1, failed 0");
    expect(leaks(container)).toEqual([]);
  });

  it("对局检查器:搜索、节点操作与文档事实", async () => {
    installEn({ detail: { schemaVersion: 3, data: { rounds: [] } } });
    const { container } = render(
      <LangProvider>
        <DevPanel initialZone="inspect" />
      </LangProvider>,
    );
    expect(await screen.findByText("No match selected")).toBeTruthy();
    fireEvent.click(await screen.findByTestId("dev-match-row"));
    await screen.findByTestId("dev-doc-facts");
    fireEvent.change(screen.getByTestId("dev-json-search"), {
      target: { value: "nothingHere" },
    });
    fireEvent.submit(screen.getByTestId("dev-json-search-form"));
    await screen.findByText(/^No hits \(scanned \d+ nodes?\)$/);
    fireEvent.click(screen.getByTestId("dev-reparse"));
    await screen.findByText("Re-parsed; meta backfilled");
    expect(container.textContent).toContain("1 match · 1 shown");
    expect(leaks(container)).toEqual([]);
  });

  it("AI 调用区(展开一条)与诊断区", async () => {
    const h = installEn({
      aiCalls: [
        {
          kind: "analysis",
          matchId: "m1",
          at: 1_700_000_000_000,
          model: "claude",
          prompt: "hello",
          raw: "world",
        },
      ],
    });
    const { container } = render(
      <LangProvider>
        <DevPanel initialZone="ai" />
      </LangProvider>,
    );
    fireEvent.click(await screen.findByText("View"));
    expect(container.textContent).toContain("prompt 5 chars → reply 5 chars");
    expect(container.textContent).toContain(
      formatTime(1_700_000_000_000, "en"),
    );
    expect(leaks(container)).toEqual([]);

    fireEvent.click(screen.getByTestId("dev-nav-diag"));
    await screen.findByText("No diagnostics");
    act(() => h.emitDiagnostic({ code: "monotonic", at: 2 }));
    fireEvent.change(screen.getByTestId("dev-diag-filter"), {
      target: { value: "zzz" },
    });
    await waitFor(() =>
      expect(container.textContent).toContain("No diagnostics (filtered out)"),
    );
    expect(leaks(container)).toEqual([]);
  });
});
