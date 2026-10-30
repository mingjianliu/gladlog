// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// Queue-semantics unit test: the batch driver is mocked out wholesale (its own
// orchestration logic is covered by batchAnalysis.test.ts); this file only
// checks who gets fed into startBatch and under what conditions — in the same
// spirit as CLAUDE.md's "the gate predicate is the spec": autoAnalyze never
// reimplements skipping / serialization / deep dive, it delegates all of it to
// the one driver.
vi.mock("../src/renderer/src/batch/batchAnalysis", () => {
  let running = false;
  const subs = new Set<() => void>();
  return {
    getBatchStatus: () => ({ running }),
    subscribeBatch: (cb: () => void) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    startBatch: vi.fn(async () => {}),
    // Test-only knob: simulate the batch driver's busy → idle transition (not
    // on any production code path).
    __setRunning: (v: boolean) => {
      running = v;
      for (const cb of [...subs]) cb();
    },
  };
});

import { startAutoAnalyzeListener } from "../src/renderer/src/batch/autoAnalyze";
import {
  type BatchItem,
  getBatchStatus,
  startBatch,
} from "../src/renderer/src/batch/batchAnalysis";
import * as batchAnalysisMock from "../src/renderer/src/batch/batchAnalysis";

const setRunning = (v: boolean) =>
  (
    batchAnalysisMock as unknown as { __setRunning(v: boolean): void }
  ).__setRunning(v);

const startBatchMock = startBatch as unknown as ReturnType<typeof vi.fn>;

function stubBridge(opts: {
  autoAnalyzeNew: boolean;
  settingsError?: boolean;
}) {
  let stored: ((meta: unknown) => void) | null = null;
  const unsub = vi.fn();
  (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
    settings: {
      get: async () => {
        if (opts.settingsError) throw new Error("no settings pane");
        return { autoAnalyzeNew: opts.autoAnalyzeNew };
      },
    },
    logs: {
      onMatchStored: (cb: (meta: unknown) => void) => {
        stored = cb;
        return unsub;
      },
    },
  };
  return {
    fire: (meta: unknown) => stored?.(meta),
    unsub,
  };
}

const META = (over: Record<string, unknown> = {}) => ({
  id: "m1",
  kind: "match" as const,
  bracket: "3v3",
  zoneId: "1825",
  startTime: Date.parse("2026-08-01T12:34:00"),
  endTime: Date.parse("2026-08-01T12:40:00"),
  result: "win",
  storedAt: Date.now(),
  live: true,
  ...over,
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("autoAnalyze(自动分析新对局队列)", () => {
  beforeEach(() => {
    setRunning(false);
    startBatchMock.mockClear();
  });

  it("开关关 → 不入队,startBatch 不被调用", async () => {
    const { fire } = stubBridge({ autoAnalyzeNew: false });
    const unlisten = startAutoAnalyzeListener();
    fire(META());
    await flush();
    expect(startBatchMock).not.toHaveBeenCalled();
    unlisten();
  });

  it("开关开 + live → 入队且 startBatch 收到该 id", async () => {
    const { fire } = stubBridge({ autoAnalyzeNew: true });
    const unlisten = startAutoAnalyzeListener();
    fire(META({ id: "m-live" }));
    await flush();
    expect(startBatchMock).toHaveBeenCalledTimes(1);
    const items = startBatchMock.mock.calls[0]![0] as BatchItem[];
    expect(items.map((i) => i.id)).toEqual(["m-live"]);
    expect(items[0]!.label).toContain("3v3");
    unlisten();
  });

  it("import(无 live)→ 不触发", async () => {
    const { fire } = stubBridge({ autoAnalyzeNew: true });
    const unlisten = startAutoAnalyzeListener();
    fire(META({ id: "m-import", live: undefined }));
    await flush();
    expect(startBatchMock).not.toHaveBeenCalled();
    unlisten();
  });

  it("批量运行中 → 挂起;批量结束(running→false)后 drain 补跑", async () => {
    setRunning(true);
    const { fire } = stubBridge({ autoAnalyzeNew: true });
    const unlisten = startAutoAnalyzeListener();
    fire(META({ id: "m-queued" }));
    await flush();
    expect(startBatchMock).not.toHaveBeenCalled();
    expect(getBatchStatus().running).toBe(true);

    setRunning(false); // simulate the batch driver finishing and notifying subs
    await flush();
    expect(startBatchMock).toHaveBeenCalledTimes(1);
    const items = startBatchMock.mock.calls[0]![0] as BatchItem[];
    expect(items.map((i) => i.id)).toEqual(["m-queued"]);
    unlisten();
  });

  it("重复 id 去重:同一场连续两次入库通知只入队一次", async () => {
    const { fire } = stubBridge({ autoAnalyzeNew: true });
    // hold it busy so the first event does not drain the queue immediately
    setRunning(true);
    const unlisten = startAutoAnalyzeListener();
    fire(META({ id: "m-dup" }));
    fire(META({ id: "m-dup" }));
    await flush();
    setRunning(false);
    await flush();
    expect(startBatchMock).toHaveBeenCalledTimes(1);
    const items = startBatchMock.mock.calls[0]![0] as BatchItem[];
    expect(items.map((i) => i.id)).toEqual(["m-dup"]);
    unlisten();
  });

  it("settings.get 抛错(桩缺该面)→ 不崩,不入队", async () => {
    const { fire } = stubBridge({ autoAnalyzeNew: true, settingsError: true });
    const unlisten = startAutoAnalyzeListener();
    expect(() => fire(META())).not.toThrow();
    await flush();
    expect(startBatchMock).not.toHaveBeenCalled();
    unlisten();
  });
});
