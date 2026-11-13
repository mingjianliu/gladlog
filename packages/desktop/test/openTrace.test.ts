// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  beginOpen,
  cancelOpen,
  currentOpen,
  endOpen,
  openDocArrived,
  openIoArrived,
  openPaintAt,
  openTimed,
  openTraceActive,
} from "../src/renderer/src/openTrace";

// T93 open trace, the shapes codex 85-tk-G-T93-1 #2–#4 named.

const observers: Array<{ disconnect: ReturnType<typeof vi.fn> }> = [];
const traces = (): Array<{
  id: string;
  at: Record<string, number>;
  dur: Record<string, number>;
}> =>
  (window as unknown as { __gladlogOpenTraces?: never[] })
    .__gladlogOpenTraces ?? [];

beforeEach(() => {
  observers.length = 0;
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "performance",
      "Date",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
  });
  vi.stubGlobal(
    "PerformanceObserver",
    class {
      disconnect = vi.fn();
      observe = vi.fn();
      constructor() {
        observers.push(this);
      }
    },
  );
  (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
    debug: {},
  };
});
afterEach(() => {
  cancelOpen();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("open trace", () => {
  it("#2 一个被放弃的请求晚到,不往下一次打开的记录里写", () => {
    beginOpen("a#1", "round");
    const a = currentOpen();
    beginOpen("b", "match");
    const b = currentOpen();
    vi.advanceTimersByTime(20);
    // A's answer arrives first, against B's trace
    openIoArrived(a);
    openTimed("parse", () => undefined, false, a);
    openDocArrived(a);
    vi.advanceTimersByTime(120);
    // B's own answer
    openTimed("parse", () => vi.advanceTimersByTime(5), false, b);
    openDocArrived(b);
    endOpen();
    vi.advanceTimersByTime(1000);
    const rec = traces().at(-1)!;
    expect(rec.id).toBe("b");
    expect(rec.at["docArrived"]).toBeGreaterThanOrEqual(140);
    expect(rec.dur["parse"]).toBeGreaterThanOrEqual(5);
  });

  it("#3 没有文档的打开被取消:观察器断开,不留记录", () => {
    const before = traces().length;
    beginOpen("missing", "match");
    const t = currentOpen();
    expect(observers).toHaveLength(1);
    // a stale token cancels nothing
    cancelOpen({});
    expect(openTraceActive()).toBe(true);
    cancelOpen(t);
    expect(openTraceActive()).toBe(false);
    expect(observers[0]!.disconnect).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(traces().length).toBe(before);
  });

  it("#4 没有 requestAnimationFrame 的环境里照常记一笔,不抛错", () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    beginOpen("c", "match");
    expect(() => openPaintAt("loadingPainted")).not.toThrow();
    openDocArrived(currentOpen());
    expect(() => endOpen()).not.toThrow();
    vi.advanceTimersByTime(1000);
    const rec = traces().at(-1)!;
    expect(rec.id).toBe("c");
    expect(rec.at["loadingPainted"]).toBeDefined();
    expect(rec.at["settledPainted"]).toBeDefined();
  });
});
