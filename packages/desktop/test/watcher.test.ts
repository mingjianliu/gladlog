import { startLogWatcher, type LogWatcher } from "../src/worker/watcher";

const noopWatch = (() => ({
  close() {},
})) as unknown as typeof import("fs").watch;

function make(onFlush: (f: string[]) => Promise<void>): LogWatcher {
  return startLogWatcher({
    logsDir: "/dev/null",
    flushIntervalMs: 100,
    quietPeriodMs: 300,
    onFlush,
    watchFn: noopWatch,
  });
}

describe("startLogWatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("change 事件入脏集,间隔到点 flush 排序后的文件名", async () => {
    const seen: string[][] = [];
    const w = make(async (f) => {
      seen.push(f);
    });
    w.handleEvent("change", "WoWCombatLog-2.txt");
    w.handleEvent("change", "WoWCombatLog-1.txt");
    await vi.advanceTimersByTimeAsync(100);
    expect(seen).toEqual([["WoWCombatLog-1.txt", "WoWCombatLog-2.txt"]]);
    w.close();
  });

  it("rename 与非 WoWCombatLog*.txt 被忽略", async () => {
    const seen: string[][] = [];
    const w = make(async (f) => {
      seen.push(f);
    });
    w.handleEvent("rename", "WoWCombatLog-1.txt");
    w.handleEvent("change", "other.txt");
    w.handleEvent("change", "WoWCombatLog-1.log");
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toEqual([]);
    w.close();
  });

  it("flush 失败 → 文件回插,下一轮重试", async () => {
    let calls = 0;
    const w = make(async () => {
      calls++;
      if (calls === 1) throw new Error("boom");
    });
    w.handleEvent("change", "WoWCombatLog-1.txt");
    await vi.advanceTimersByTimeAsync(100); // 失败
    await vi.advanceTimersByTimeAsync(100); // 重试成功
    expect(calls).toBe(2);
    w.close();
  });

  it("静默期在最后事件后补一次 flush", async () => {
    const seen: string[][] = [];
    const w = startLogWatcher({
      logsDir: "/dev/null",
      flushIntervalMs: 10_000,
      quietPeriodMs: 300,
      onFlush: async (f) => {
        seen.push(f);
      },
      watchFn: noopWatch,
    });
    w.handleEvent("change", "WoWCombatLog-1.txt");
    await vi.advanceTimersByTimeAsync(300);
    expect(seen).toHaveLength(1);
    w.close();
  });

  it("close 后事件被忽略", async () => {
    const seen: string[][] = [];
    const w = make(async (f) => {
      seen.push(f);
    });
    w.close();
    w.handleEvent("change", "WoWCombatLog-1.txt");
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toEqual([]);
  });
});
