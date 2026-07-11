import type { FileStatus } from "../shared/protocol";
import type { GladlogSettings } from "../main/settingsStore";
import type { StoredMatchMeta } from "../main/matchStore";

export interface LogsStatusSnapshot {
  watching: boolean;
  logsDir: string;
  files: FileStatus[];
}
export interface DiagnosticEntry {
  fileKey?: string;
  code: string;
  detail?: string;
  at: number;
}

export interface GladlogApi {
  logs: {
    getStatus(): Promise<LogsStatusSnapshot | null>;
    onStatusChanged(cb: (s: LogsStatusSnapshot) => void): () => void;
    onMatchStored(cb: (meta: StoredMatchMeta) => void): () => void;
    onDiagnostic(cb: (d: DiagnosticEntry) => void): () => void;
  };
  matches: {
    list(): Promise<StoredMatchMeta[]>;
    get(id: string): Promise<unknown | null>;
  };
  settings: {
    get(): Promise<GladlogSettings>;
    save(partial: Partial<GladlogSettings>): Promise<GladlogSettings>;
  };
  app: {
    getVersion(): Promise<string>;
    selectDirectory(): Promise<string | null>; // 返回选中目录;取消 → null。选中即自动 save wowDirectory 并重启监控
    openExternal(url: string): Promise<void>;
  };
  ai: {
    analyze(matchId: string, context: string): Promise<void>;
    cancel(): Promise<void>;
    getCached(
      matchId: string,
    ): Promise<{ content: string; model: string; createdAt: number } | null>;
    onDelta(cb: (d: { matchId: string; text: string }) => void): () => void;
    onDone(cb: (d: { matchId: string; content: string }) => void): () => void;
    onError(cb: (d: { matchId: string; message: string }) => void): () => void;
  };
}
declare global {
  interface Window {
    gladlog: GladlogApi;
  }
}
