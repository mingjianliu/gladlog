import type { GladMatch, GladShuffle } from "@gladlog/parser";

import type { StagedMatch } from "../main/matchStore";

export interface FileCheckpoint {
  offset: number; // byte offset past the last fully consumed line (safe boundary)
  firstLineChecksum: string | null; // sha1 hex of the file's first line; null for an empty file
}

export interface WorkerConfig {
  logsDir: string;
  checkpointsPath: string; // absolute path of the checkpoint registry JSON
  quarantined: string[]; // skipped fileKeys (basename)
  flushIntervalMs: number; // default 2000
  quietPeriodMs: number; // default 5000
  /** the match store's root: the worker stages a parsed match there and posts
   * `matchStaged` (GH #149); absent → it posts the whole document */
  matchesDir?: string;
}

export type MainToWorker =
  | { type: "configure"; config: WorkerConfig }
  // main has durably stored (or deduped) the match/shuffle the worker sent
  // with this ackId. Until then the worker's persisted checkpoint stays at
  // or before that match's opening line, so a crash between the worker's
  // post and main's commit replays it instead of losing it (GH #211 review).
  | { type: "stored"; fileKey: string; ackId: string };

export interface FileStatus {
  fileKey: string;
  offset: number;
  size: number;
  quarantined: boolean;
}

export type WorkerToMain =
  // `ackId` on the three store messages: main answers with a `stored`
  // message carrying it once the match is on disk (see MainToWorker)
  | { type: "match"; fileKey: string; payload: GladMatch; ackId: string }
  | { type: "shuffle"; fileKey: string; payload: GladShuffle; ackId: string }
  // a match/shuffle the worker already wrote to the store's staging area
  // (GH #149); main commits it with MatchStore.commitStaged
  | {
      type: "matchStaged";
      fileKey: string;
      staged: StagedMatch;
      ackId: string;
    }
  | { type: "diagnostic"; fileKey?: string; code: string; detail?: string }
  // Match lifecycle (drives OBS recording; a shuffle lobby gets one open/close
  // pair for the whole lobby)
  | {
      type: "segmentOpen";
      fileKey: string;
      bracket: string;
      zoneId: string;
      isRated: boolean;
      startTime: number; // epoch ms of the opening line
    }
  | {
      type: "segmentClose";
      fileKey: string;
      endTime: number | null; // null on an abnormal close (log rotation / end)
      aborted: boolean;
    }
  | {
      type: "status";
      watching: boolean;
      logsDir: string;
      files: FileStatus[];
      current?: { fileKey: string; offset: number }; // position being processed (for crash attribution)
    };

/** Masked value returned when settings are read back (a protocol constant shared
 * by renderer and main; the renderer must never value-import a main module --
 * proven by the v0.0.4 build: it drags fs into the browser bundle). */
export const API_KEY_REDACTED = "__gladlog_api_key_set__";

/** Read-back sentinel for the OBS websocket password (same pattern as
 * API_KEY_REDACTED). This is the USER'S OWN OBS instance's password
 * (external/bypass mode, obsWebsocketPassword) -- see
 * MANAGED_WS_PASSWORD_REDACTED for the managed instance's own, separate,
 * auto-generated password. */
export const OBS_PASSWORD_REDACTED = "__gladlog_obs_password_set__";
/** Read-back sentinel for the managed OBS instance's auto-generated
 * websocket password (task-6 secret three-piece; same pattern as
 * OBS_PASSWORD_REDACTED but a different field: managedWsPassword, generated
 * on first managed enable, never typed by the user). */
export const MANAGED_WS_PASSWORD_REDACTED =
  "__gladlog_managed_ws_password_set__";
/** Read-back sentinel for the DeepSeek API key (same pattern as
 * API_KEY_REDACTED). */
export const DEEPSEEK_KEY_REDACTED = "__gladlog_deepseek_key_set__";
/** Default OBS 28+ websocket address (single-source, shared by the renderer
 * placeholder and the main-process connection). */
export const DEFAULT_OBS_WS_URL = "ws://127.0.0.1:4455";
