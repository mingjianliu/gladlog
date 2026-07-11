import type { GladMatch, GladShuffle } from "@gladlog/parser";

export interface FileCheckpoint {
  offset: number; // 已消费完整行尾的字节偏移(安全边界)
  firstLineChecksum: string | null; // 文件首行 sha1 hex;空文件为 null
}

export interface WorkerConfig {
  logsDir: string;
  checkpointsPath: string; // checkpoint registry JSON 的绝对路径
  quarantined: string[]; // 跳过的 fileKey(basename)
  flushIntervalMs: number; // 默认 2000
  quietPeriodMs: number; // 默认 5000
}

export type MainToWorker = { type: "configure"; config: WorkerConfig };

export interface FileStatus {
  fileKey: string;
  offset: number;
  size: number;
  quarantined: boolean;
}

export type WorkerToMain =
  | { type: "match"; fileKey: string; payload: GladMatch }
  | { type: "shuffle"; fileKey: string; payload: GladShuffle }
  | { type: "diagnostic"; fileKey?: string; code: string; detail?: string }
  | {
      type: "status";
      watching: boolean;
      logsDir: string;
      files: FileStatus[];
      current?: { fileKey: string; offset: number }; // 正在处理的位置(崩溃归因用)
    };
