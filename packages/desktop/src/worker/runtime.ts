import { readdirSync, statSync } from "fs";
import { basename, join } from "path";

import type {
  FileStatus,
  MainToWorker,
  WorkerConfig,
  WorkerToMain,
} from "../shared/protocol";
import {
  type CheckpointRegistry,
  loadCheckpoints,
  saveCheckpoints,
} from "./checkpoints";
import { FilePipeline, type ParserLike } from "./pipeline";
import { type LogWatcher,startLogWatcher } from "./watcher";

export interface WorkerTransport {
  post(msg: WorkerToMain): void;
  onMessage(cb: (msg: MainToWorker) => void): void;
}

/** Segment quiet valve: a match segment is open but the file has produced no
 * new bytes for this long -> synthesize an aborted close for the recording
 * side. Watching is purely fs.watch event driven with zero polling, so when
 * no new combat events push WoW to flush after a match ends (the END is stuck
 * in the client buffer / the group disbands with no END / a new file leaves
 * the old segment dangling), the whole stop-recording chain freezes at hop 2
 * and the recording can only wait for the 40-minute safety valve (evidence
 * gathered 2026-08-02; the secondary root cause of "the match ended ages ago
 * and the recording will not stop" on a real machine). The threshold is far
 * larger than any normal in-match write gap (seconds during a fight, ~1
 * minute between shuffle rounds) and far smaller than the safety valve. It
 * only emits a signal and does not touch the parser: a late real END is still
 * stored normally, and the recorder idempotently absorbs the second close. */
const SEGMENT_QUIET_CLOSE_MS = 3 * 60_000;
const QUIET_CHECK_INTERVAL_MS = 30_000;

export function createWorkerRuntime(opts: {
  transport: WorkerTransport;
  watchFn?: typeof import("fs").watch;
  parserFactory?: () => ParserLike;
  fatal?: (msg: string) => void;
  /** Test-only overrides; never passed in production. */
  segmentQuietCloseMs?: number;
  quietCheckIntervalMs?: number;
}): { dispose(): void } {
  let watcher: LogWatcher | null = null;
  let pipelines = new Map<string, FilePipeline>();
  let registry: CheckpointRegistry = { files: {} };
  let config: WorkerConfig | null = null;
  const quietCloseMs = opts.segmentQuietCloseMs ?? SEGMENT_QUIET_CLOSE_MS;
  const quietCheckMs = opts.quietCheckIntervalMs ?? QUIET_CHECK_INTERVAL_MS;
  /** fileKey -> the last time new bytes were consumed. */
  const lastGrowthAt = new Map<string, number>();
  /** fileKeys for which a synthetic close has already been sent for the
   * current quiet period (cleared as soon as new bytes arrive, to avoid
   * sending it twice). */
  const quietClosed = new Set<string>();
  let quietTimer: ReturnType<typeof setInterval> | null = null;

  const post = opts.transport.post;
  const fatal =
    opts.fatal ??
    ((msg) => {
      console.error(msg);
      process.exit(1);
    });

  const fileStatuses = (): FileStatus[] => {
    if (!config) return [];
    const out: FileStatus[] = [];
    for (const [key, p] of pipelines) {
      let size = 0;
      try {
        size = statSync(join(config.logsDir, key)).size;
      } catch {
        /* gone */
      }
      out.push({
        fileKey: key,
        offset: p.currentOffset,
        size,
        quarantined: false,
      });
    }
    for (const q of config.quarantined)
      out.push({ fileKey: q, offset: 0, size: 0, quarantined: true });
    return out;
  };

  const postStatus = (
    watching: boolean,
    current?: { fileKey: string; offset: number },
  ) => {
    post({
      type: "status",
      watching,
      logsDir: config?.logsDir ?? "",
      files: fileStatuses(),
      current,
    });
  };

  const pipelineFor = (fileKey: string): FilePipeline | null => {
    if (!config || config.quarantined.includes(fileKey)) return null;
    let p = pipelines.get(fileKey);
    if (!p) {
      p = new FilePipeline({
        fileKey,
        filePath: join(config.logsDir, fileKey),
        checkpoint: registry.files[fileKey] ?? null,
        emit: post,
        parserFactory: opts.parserFactory,
      });
      pipelines.set(fileKey, p);
    }
    return p;
  };

  const flushFile = (fileKey: string): void => {
    const p = pipelineFor(fileKey);
    if (!p) return;
    postStatus(true, { fileKey, offset: p.currentOffset });
    const before = p.currentOffset;
    try {
      p.processFlush();
    } catch (e) {
      fatal(
        `[gladlog-worker] fatal parse error at ${fileKey}:${p.currentOffset}: ${e instanceof Error ? e.message : e}`,
      );
      return;
    }
    if (p.currentOffset !== before || !lastGrowthAt.has(fileKey)) {
      lastGrowthAt.set(fileKey, Date.now());
      quietClosed.delete(fileKey); // New bytes again: restart the quiet period
    }
    registry.files[fileKey] = p.checkpoint;
  };

  /** Segment quiet valve tick: see the SEGMENT_QUIET_CLOSE_MS comment. */
  const quietSweep = (): void => {
    const now = Date.now();
    for (const [key, p] of pipelines) {
      if (!p.hasOpenSegment) continue;
      if (quietClosed.has(key)) continue;
      const seen = lastGrowthAt.get(key);
      if (seen !== undefined && now - seen > quietCloseMs) {
        p.closeOpenSegment(); // Only emits the synthetic close signal; parser state untouched
        quietClosed.add(key);
      }
    }
  };

  const teardown = () => {
    watcher?.close();
    watcher = null;
    if (quietTimer) {
      clearInterval(quietTimer);
      quietTimer = null;
    }
    for (const p of pipelines.values()) p.closeOpenSegment();
    pipelines = new Map();
    lastGrowthAt.clear();
    quietClosed.clear();
  };

  const configure = (next: WorkerConfig): void => {
    teardown();
    config = next;
    registry = loadCheckpoints(next.checkpointsPath);
    let names: string[];
    try {
      names = readdirSync(next.logsDir).filter(
        (n) => n.includes("WoWCombatLog") && n.endsWith(".txt"),
      );
    } catch {
      post({
        type: "diagnostic",
        code: "LOGS_DIR_UNREADABLE",
        detail: next.logsDir,
      });
      postStatus(false);
      return;
    }
    for (const name of names.sort()) flushFile(basename(name));
    saveCheckpoints(next.checkpointsPath, registry);
    watcher = startLogWatcher({
      logsDir: next.logsDir,
      flushIntervalMs: next.flushIntervalMs,
      quietPeriodMs: next.quietPeriodMs,
      watchFn: opts.watchFn,
      onFlush: async (fileNames) => {
        for (const name of fileNames) flushFile(basename(name));
        if (config) saveCheckpoints(config.checkpointsPath, registry);
        postStatus(true);
      },
    });
    // Segment quiet valve: a permanent low-frequency timer independent of fs
    // events -- the watcher's own timer destroys itself once the dirty set is
    // empty, so it cannot be relied on; this needs its own heartbeat to act
    // in the quiet state where "no further events" ever arrive.
    quietTimer = setInterval(quietSweep, quietCheckMs);
    postStatus(true);
  };

  opts.transport.onMessage((msg) => {
    if (msg.type === "configure") configure(msg.config);
  });

  return { dispose: teardown };
}
