import { watch } from "fs";

export interface LogWatcher {
  close(): void;
  /** Exposed for tests; production events arrive via fs.watch. rename events are processed. */
  handleEvent(eventType: string, fileName: string | Buffer | null): void;
}

export function startLogWatcher(opts: {
  logsDir: string;
  flushIntervalMs: number;
  quietPeriodMs: number;
  onFlush: (fileNames: string[]) => Promise<void>;
  watchFn?: typeof watch;
}): LogWatcher {
  const dirty = new Set<string>();
  let interval: ReturnType<typeof setInterval> | null = null;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;
  let flushing = false;
  let closed = false;

  const drain = async (): Promise<void> => {
    if (flushing) {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        void drain();
      }, 5000);
      return;
    }
    if (dirty.size === 0) return;
    const files = [...dirty].sort();
    dirty.clear();
    flushing = true;
    try {
      await opts.onFlush(files);
    } catch (e) {
      // flush 失败不能杀 watcher;checkpoint 未推进,回插脏集等下一轮重试同一字节段
      for (const f of files) dirty.add(f);
      console.error(
        `[gladlog-worker] flush failed: ${e instanceof Error ? e.message : e}`,
      );
    } finally {
      flushing = false;
    }
  };

  const stopTimers = () => {
    if (interval) clearInterval(interval);
    interval = null;
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = null;
  };

  const handleEvent = (
    eventType: string,
    fileName: string | Buffer | null,
  ): void => {
    if (closed) return;
    if (
      typeof fileName !== "string" ||
      !fileName.includes("WoWCombatLog") ||
      !fileName.endsWith(".txt")
    )
      return;
    dirty.add(fileName);

    if (!interval) {
      interval = setInterval(() => {
        void drain();
        if (dirty.size === 0 && !flushing) stopTimers();
      }, opts.flushIntervalMs);
    }
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(() => {
      void drain();
    }, opts.quietPeriodMs);
  };

  const watcher = (opts.watchFn ?? watch)(opts.logsDir, handleEvent);

  return {
    handleEvent,
    close(): void {
      closed = true;
      stopTimers();
      watcher.close();
    },
  };
}
