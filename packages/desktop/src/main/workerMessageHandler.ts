import type { WorkerToMain } from "../shared/protocol";
import type { LogsStatusSnapshot } from "../preload/api";
import type { MatchStore, StoredMatchMeta } from "./matchStore";
import type { RecorderService } from "./recorder";

/**
 * worker → main message routing, extracted from index.ts to make it testable
 * (2026-08-01, auto-analysis of new matches): the only branch with product
 * meaning is the matchStored event emitted after a match/shuffle is stored
 * successfully — it must carry `live: true`, which is the renderer's only
 * signal for telling live matches from historical imports in the autoAnalyze
 * queue. The import path (importLogs.ts) uses its own emit and never goes
 * through this function, so it naturally lacks `live` and needs no extra check
 * here.
 */
interface WorkerMessageHandlerDeps {
  store: Pick<MatchStore, "store">;
  recorder: Pick<
    RecorderService,
    "associate" | "onSegmentOpen" | "onSegmentClose"
  > | null;
  emit: (channel: string, payload: unknown) => void;
  setStatus: (s: LogsStatusSnapshot) => void;
  logWarn: (msg: string) => void;
}

export function createWorkerMessageHandler(
  deps: WorkerMessageHandlerDeps,
): (msg: WorkerToMain) => void {
  return (msg: WorkerToMain): void => {
    if (msg.type === "match" || msg.type === "shuffle") {
      const r = deps.store.store(msg.payload);
      if (r.stored && r.meta) {
        deps.recorder?.associate(r.meta);
        const live: StoredMatchMeta & { live: true } = {
          ...r.meta,
          live: true,
        };
        deps.emit("gladlog:logs:matchStored", live);
      }
    } else if (msg.type === "segmentOpen") {
      deps.recorder?.onSegmentOpen({
        startTime: msg.startTime,
        bracket: msg.bracket,
      });
    } else if (msg.type === "segmentClose") {
      deps.recorder?.onSegmentClose({
        endTime: msg.endTime,
        aborted: msg.aborted,
      });
    } else if (msg.type === "status") {
      const status: LogsStatusSnapshot = {
        watching: msg.watching,
        logsDir: msg.logsDir,
        files: msg.files,
      };
      deps.setStatus(status);
      deps.emit("gladlog:logs:statusChanged", status);
    } else if (msg.type === "diagnostic") {
      const entry = {
        fileKey: msg.fileKey,
        code: msg.code,
        detail: msg.detail,
        at: Date.now(),
      };
      deps.logWarn(`[worker diagnostic] ${JSON.stringify(entry)}`);
      deps.emit("gladlog:logs:diagnostic", entry);
    }
  };
}
