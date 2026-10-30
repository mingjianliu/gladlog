// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The bar is the driver's display surface only — the driver is mocked so these
// tests pin exactly what work set + options the bar hands over.
vi.mock("../src/renderer/src/batch/batchAnalysis", () => ({
  startBatch: vi.fn(),
  cancelBatch: vi.fn(),
  dismissBatchSummary: vi.fn(),
  getBatchStatus: () => ({
    running: false,
    total: 0,
    done: 0,
    ok: 0,
    skipped: 0,
    failed: 0,
    currentLabel: null,
    cancelled: false,
    finishedAt: null,
  }),
  subscribeBatch: () => () => {},
}));

import type { StoredMatchMeta } from "../src/main/matchStore";
import { startBatch } from "../src/renderer/src/batch/batchAnalysis";
import { BatchAnalyzeBar } from "../src/renderer/src/components/BatchAnalyzeBar";

const meta = (id: string, kind = "match"): StoredMatchMeta =>
  ({
    id,
    kind,
    bracket: "3v3",
    startTime: 1_700_000_000_000,
    result: "win",
    zoneId: "1",
  }) as unknown as StoredMatchMeta;

// a1 is analyzed; a2 fresh; sh1 is a shuffle whose meta.id happens to be in the
// analyzed list (= its first round is cached — must NOT be pre-filtered).
const metas = [meta("a1"), meta("a2"), meta("sh1", "shuffle")];

beforeEach(() => {
  vi.mocked(startBatch).mockClear();
  (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
    analysis: { listAnalyzed: async () => ["a1", "sh1"] },
  };
});

const ids = (): string[] =>
  (vi.mocked(startBatch).mock.calls[0]![0] as Array<{ id: string }>).map(
    (x) => x.id,
  );
const opts = (): unknown => vi.mocked(startBatch).mock.calls[0]![1];

describe("批量分析栏:跳过已分析开关", () => {
  it("默认勾选:已分析的非 shuffle 预过滤掉,shuffle 永不预过滤;传 skipAnalyzed:true", async () => {
    render(<BatchAnalyzeBar metas={metas} />);
    expect((screen.getByTestId("batch-skip") as HTMLInputElement).checked).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "开始" }));
    await waitFor(() => expect(startBatch).toHaveBeenCalledTimes(1));
    expect(ids()).toEqual(["a2", "sh1"]);
    expect(opts()).toEqual({ skipAnalyzed: true });
  });

  it("取消勾选 = 重新分析:不预过滤,传 skipAnalyzed:false", async () => {
    render(<BatchAnalyzeBar metas={metas} />);
    fireEvent.click(screen.getByTestId("batch-skip"));
    fireEvent.click(screen.getByRole("button", { name: "开始" }));
    await waitFor(() => expect(startBatch).toHaveBeenCalledTimes(1));
    expect(ids()).toEqual(["a1", "a2", "sh1"]);
    expect(opts()).toEqual({ skipAnalyzed: false });
  });
});

describe("批量分析栏:勾选场次", () => {
  it("有勾选 → 按钮变「分析勾选的 N 场」,只跑勾选的,launch 后清空勾选", async () => {
    const onClear = vi.fn();
    render(
      <BatchAnalyzeBar
        metas={metas}
        selected={new Set(["a2", "sh1"])}
        onClearSelected={onClear}
      />,
    );
    // The N input gives way to the selection chip
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.getByTestId("batch-sel").textContent).toContain("2");
    fireEvent.click(screen.getByRole("button", { name: "分析勾选的 2 场" }));
    await waitFor(() => expect(startBatch).toHaveBeenCalledTimes(1));
    // sh1 is a shuffle lobby id — one item; the driver expands it to 6 rounds
    expect(ids()).toEqual(["a2", "sh1"]);
    expect(onClear).toHaveBeenCalled();
  });

  it("勾选的全是已分析且开关开着 → 提示,不启动,也不清空勾选", async () => {
    const onClear = vi.fn();
    render(
      <BatchAnalyzeBar
        metas={metas}
        selected={new Set(["a1"])}
        onClearSelected={onClear}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "分析勾选的 1 场" }));
    expect(await screen.findByText("勾选的对局都已分析")).toBeTruthy();
    expect(startBatch).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });

  it("勾选 + 关掉跳过 → 已分析的也重新跑", async () => {
    render(
      <BatchAnalyzeBar
        metas={metas}
        selected={new Set(["a1"])}
        onClearSelected={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("batch-skip"));
    fireEvent.click(screen.getByRole("button", { name: "分析勾选的 1 场" }));
    await waitFor(() => expect(startBatch).toHaveBeenCalledTimes(1));
    expect(ids()).toEqual(["a1"]);
    expect(opts()).toEqual({ skipAnalyzed: false });
  });

  it("清除勾选按钮回调", () => {
    const onClear = vi.fn();
    render(
      <BatchAnalyzeBar
        metas={metas}
        selected={new Set(["a2"])}
        onClearSelected={onClear}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "清除勾选" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
