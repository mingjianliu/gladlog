// @vitest-environment jsdom
// The batch bar words its status at render time (codex B3 fix 3): the "nothing
// to analyze" note and the in-flight match labels are stored unformatted, so a
// language switch mid-batch re-words them. Display only — the driver is mocked.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BatchStatus } from "../src/renderer/src/batch/batchAnalysis";

const status: { current: BatchStatus } = {
  current: {
    running: false,
    total: 0,
    done: 0,
    ok: 0,
    skipped: 0,
    failed: 0,
    currentLabels: [],
    cancelled: false,
    finishedAt: null,
  },
};

vi.mock("../src/renderer/src/batch/batchAnalysis", () => ({
  startBatch: vi.fn(),
  cancelBatch: vi.fn(),
  dismissBatchSummary: vi.fn(),
  getBatchStatus: () => status.current,
  subscribeBatch: () => () => {},
}));

import { BatchAnalyzeBar } from "../src/renderer/src/components/BatchAnalyzeBar";
import { LangProvider, useT } from "../src/renderer/src/i18n/LangProvider";

function ToEnglish() {
  const { setLang } = useT();
  return (
    <button data-testid="to-en" onClick={() => void setLang("en")}>
      en
    </button>
  );
}

const idle = { ...status.current };

beforeEach(() => {
  status.current = { ...idle };
  const state: Record<string, unknown> = { language: "zh" };
  (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
    settings: {
      get: async () => ({ ...state }),
      save: async (p: Record<string, unknown>) => Object.assign(state, p),
    },
    analysis: { listAnalyzed: async () => [] },
  };
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { __gladlogFixture?: unknown }).__gladlogFixture;
});

describe("批量栏:切换语言后状态文案跟着换", () => {
  it("没有未分析的对局", async () => {
    const { container } = render(
      <LangProvider>
        <ToEnglish />
        <BatchAnalyzeBar metas={[]} />
      </LangProvider>,
    );
    fireEvent.click(await screen.findByText("批量 AI 分析"));
    fireEvent.click(await screen.findByText("开始"));
    await waitFor(() =>
      expect(container.querySelector(".batch-note")?.textContent).toBe(
        "没有未分析的对局",
      ),
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("to-en"));
    });
    expect(container.querySelector(".batch-note")?.textContent).toBe(
      "No unanalyzed matches",
    );
  });

  it("进行中的对局标签(日期按当前语言格式化,同名合并)", async () => {
    const startTime = new Date(2026, 10, 14, 22, 5).getTime();
    status.current = {
      ...idle,
      running: true,
      total: 3,
      done: 1,
      currentLabels: [
        { startTime, bracket: "3v3" },
        { startTime, bracket: "3v3" },
        "abcd1234",
      ],
    };
    const { container } = render(
      <LangProvider>
        <ToEnglish />
        <BatchAnalyzeBar metas={[]} />
      </LangProvider>,
    );
    await waitFor(() =>
      expect(container.querySelector(".batch-progress")?.textContent).toBe(
        "批量分析中 1/3 · 11月14日 22:05 · 3v3 / abcd1234",
      ),
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("to-en"));
    });
    expect(container.querySelector(".batch-progress")?.textContent).toBe(
      "Analyzing 1/3 · Nov 14 22:05 · 3v3 / abcd1234",
    );
  });
});
