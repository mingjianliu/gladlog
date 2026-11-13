// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  beginOpen,
  cancelOpen,
  currentOpen,
  endOpen,
  openDocArrived,
  openIoArrived,
  openOnce,
  openPaintAt,
  openReportAt,
  openReportLeft,
  openReportRender,
  openReportShows,
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

  // codex 85-tk-G-T93-1b
  const R1 = { round: 1 };
  const R2 = { round: 2 };

  it("1b #2 别的回合的报告阶段不写进这次打开的记录;它自己的才写", () => {
    beginOpen("m#2", "round");
    openDocArrived(currentOpen(), R2);
    // round 1, already loaded, is what the report draws
    openReportRender(R1);
    openTimed("derive:x", () => vi.advanceTimersByTime(7));
    openReportAt("fill4Committed", R1);
    endOpen("settled", R1);
    // then round 2 itself
    openReportRender(R2);
    openTimed("derive:x", () => vi.advanceTimersByTime(3));
    openReportAt("fill4Committed", R2);
    endOpen("settled", R2);
    vi.advanceTimersByTime(1000);
    const rec = traces().at(-1)!;
    expect(rec.id).toBe("m#2");
    expect(rec.dur["derive:x"]).toBe(3);
    expect(rec.at["reportRenderStart"]).toBeGreaterThanOrEqual(7);
  });

  it("1b #2 到货时没有报告画它(停在别的回合 / 别的页面):记录作废,观察器断开", () => {
    const before = traces().length;
    beginOpen("m#2", "round");
    openDocArrived(currentOpen(), R2);
    openReportRender(R1);
    openReportAt("fill4Committed", R1);
    vi.advanceTimersByTime(1000);
    expect(openTraceActive()).toBe(false);
    expect(observers.at(-1)!.disconnect).toHaveBeenCalledTimes(1);
    expect(traces().length).toBe(before);
  });

  it("1b #2 离开正在打开的回合就作废;同一份报告卸载又挂回(StrictMode)不算离开", () => {
    beginOpen("m", "match");
    openDocArrived(currentOpen());
    // a match open is of the first source a report renders
    openReportRender(R1);
    openReportShows(R1);
    openReportLeft(R1);
    openReportShows(R1);
    vi.advanceTimersByTime(1);
    expect(openTraceActive()).toBe(true);
    openReportLeft(R1);
    vi.advanceTimersByTime(1);
    expect(openTraceActive()).toBe(false);
    expect(observers.at(-1)!.disconnect).toHaveBeenCalledTimes(1);
  });

  it("1b #1 同一回合的请求只发一次;回答记在最后一次点击的那次打开上", async () => {
    const inFlight = new Map<
      string,
      { trace: ReturnType<typeof currentOpen> }
    >();
    let resolve!: (v: object) => void;
    const request = vi.fn(() => new Promise<object>((r) => (resolve = r)));
    const answers: Array<[unknown, boolean, boolean]> = [];
    const answer = (
      v: object | undefined,
      t: ReturnType<typeof currentOpen>,
      failed: boolean,
    ) => {
      answers.push([v, t === currentOpen(), failed]);
      if (v) openDocArrived(t, v);
    };
    openOnce(inFlight, "m#2", "round", request, answer);
    const first = currentOpen();
    // still the open in flight: a second click changes nothing
    openOnce(inFlight, "m#2", "round", request, answer);
    expect(currentOpen()).toBe(first);
    // round 1 is asked for meanwhile, then round 2 again
    beginOpen("m#1", "round");
    vi.advanceTimersByTime(50);
    openOnce(inFlight, "m#2", "round", request, answer);
    expect(request).toHaveBeenCalledTimes(1);
    expect(currentOpen()).not.toBe(first);
    vi.advanceTimersByTime(30);
    resolve(R2);
    await vi.advanceTimersByTimeAsync(0);
    expect(answers).toEqual([[R2, true, false]]);
    expect(inFlight.size).toBe(0);
    openReportRender(R2);
    endOpen("settled", R2);
    vi.advanceTimersByTime(1000);
    const rec = traces().at(-1)!;
    expect(rec.id).toBe("m#2");
    // from the last click on round 2, not the first
    expect(rec.at["docArrived"]).toBe(30);
  });

  it("1b #3 抛错的请求也收尾:回答带 failed,由调用方取消", async () => {
    const inFlight = new Map<
      string,
      { trace: ReturnType<typeof currentOpen> }
    >();
    openOnce(
      inFlight,
      "m#3",
      "round",
      () => Promise.reject(new Error("io")),
      (_v, t, failed) => {
        expect(failed).toBe(true);
        cancelOpen(t);
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(openTraceActive()).toBe(false);
    expect(inFlight.size).toBe(0);
    expect(observers.at(-1)!.disconnect).toHaveBeenCalledTimes(1);
  });
});
