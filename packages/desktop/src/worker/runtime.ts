import { readdirSync, statSync } from "fs";
import { basename, join } from "path";
import type {
  FileStatus,
  MainToWorker,
  WorkerConfig,
  WorkerToMain,
} from "../shared/protocol";
import {
  loadCheckpoints,
  saveCheckpoints,
  type CheckpointRegistry,
} from "./checkpoints";
import { FilePipeline, type ParserLike } from "./pipeline";
import { startLogWatcher, type LogWatcher } from "./watcher";

export interface WorkerTransport {
  post(msg: WorkerToMain): void;
  onMessage(cb: (msg: MainToWorker) => void): void;
}

export function createWorkerRuntime(opts: {
  transport: WorkerTransport;
  watchFn?: typeof import("fs").watch;
  parserFactory?: () => ParserLike;
  fatal?: (msg: string) => void;
}): { dispose(): void } {
  let watcher: LogWatcher | null = null;
  let pipelines = new Map<string, FilePipeline>();
  let registry: CheckpointRegistry = { files: {} };
  let config: WorkerConfig | null = null;

  const post = opts.transport.post;
  const fatal = opts.fatal ?? ((msg) => {
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
    try {
      p.processFlush();
    } catch (e) {
      fatal(`[gladlog-worker] fatal parse error at ${fileKey}:${p.currentOffset}: ${e instanceof Error ? e.message : e}`);
      return;
    }
    registry.files[fileKey] = p.checkpoint;
  };

  const teardown = () => {
    watcher?.close();
    watcher = null;
    pipelines = new Map();
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
    postStatus(true);
  };

  opts.transport.onMessage((msg) => {
    if (msg.type === "configure") configure(msg.config);
  });

  return { dispose: teardown };
}
