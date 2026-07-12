import { watch } from "fs";

export interface LogWatcher {
  close(): void;
  /** Exposed for tests; production events arrive via fs.watch. */
  handleEvent(eventType: string, fileName: string | Buffer | null): void;
}

/**
 * Event-driven watcher (zero polling): fs.watch marks files dirty; a flush
 * timer drains the dirty set every flushIntervalMs while active, plus one
 * quiet-period flush after the last event (uploads the tail of the final match
 * promptly). 'rename' events are dropped to avoid the new-file race.
 */
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
      // Flush failures must not kill the watcher; files were cleared from the
      // dirty set but their checkpoints didn't advance, so the next event
      // (or quiet flush) retries the same byte range.
      for (const f of files) dirty.add(f);
      console.error(
        `[log-pipeline] flush failed: ${e instanceof Error ? e.message : e}`,
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
    if (closed || eventType === "rename") return;
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
        if (dirty.size === 0 && !flushing) stopTimers(); // fully idle → stop ticking
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
