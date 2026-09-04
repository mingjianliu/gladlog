import type { RulesDoc } from "@gladlog/analysis/src/learning/types";
import type { RawStreams } from "@gladlog/analysis/src/utils/rawStreams";

import type { ChatSendResult, ChatState } from "../main/coachChat";
import type { LearningState } from "../main/learning";
import type { StoredMatchMeta } from "../main/matchStore";
import type { RecorderStatus } from "../main/recorder";
import type { ObsAudioDevice } from "../main/managedObsBackend";
import type { ManagedObsPrefs } from "../shared/managedObsPrefs";
import type { ObsInstallProgress } from "../main/obsAssets";
import type { GladlogSettings } from "../main/settingsStore";
import type { UpdateState } from "../main/updater";
import type { AiBackend } from "../shared/aiModels";
import type { FileStatus } from "../shared/protocol";

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
    /** live=true only on the live-watch path (main/index.ts); historical import
     * (importLogs.ts) omits the field — auto-analysis of new matches
     * (2026-08-01) uses it to tell them apart so an import flood never fires. */
    onMatchStored(
      cb: (meta: StoredMatchMeta & { live?: boolean }) => void,
    ): () => void;
    onDiagnostic(cb: (d: DiagnosticEntry) => void): () => void;
    /** Historical log import: open a file picker → parse and store file by
     * file; cancelled → null. */
    importFiles(): Promise<{
      files: number;
      stored: number;
      dup: number;
      failed: number;
    } | null>;
    onImportProgress(
      cb: (p: {
        file: string;
        i: number;
        n: number;
        stored: number;
        dup: number;
      }) => void,
    ): () => void;
  };
  matches: {
    list(): Promise<StoredMatchMeta[]>;
    get(id: string): Promise<unknown | null>;
    /** perf-1: like get(), but a shuffle with a ready per-round sidecar comes
     * back with only round 0 parsed — the other data.rounds entries are null
     * placeholders to be filled via getRound. Falls back to the whole-doc
     * parse transparently (the result is then indistinguishable from get). */
    getLazy(id: string): Promise<unknown | null>;
    /** One lazily-loaded round (parsed + slimmed), or null when the sidecar
     * is missing/stale — the caller re-opens via get() then. */
    getRound(id: string, roundIndex: number): Promise<unknown | null>;
    /** perf-2 warm-up on hover/startup: ensure the per-round sidecar exists
     * and the OS page cache is warm. Fire-and-forget. */
    prefetch(id: string): Promise<void>;
    page(opts: { before?: number; limit: number }): Promise<StoredMatchMeta[]>;
    /** One-off backfill of rich-row fields (re-forge meta by reading each
     * directory's match.json); user-triggered. */
    rebuildIndex(): Promise<{ updated: number; failed: number }>;
    /** Inline progress for a full-library rebuild (the developer page shows
     * x/n instead of an alert once it finishes). */
    onRebuildProgress(
      cb: (p: { i: number; n: number; id: string }) => void,
    ): () => void;
    /** Developer page: re-derive the meta for this one match only (reading its
     * own match.json). */
    reparse(id: string): Promise<{ ok: boolean }>;
    /** Developer page: open matches/&lt;id&gt;/ in the system file manager.
     * Not stored → false. */
    openDir(id: string): Promise<boolean>;
    /** B2 trace-back: event lineIndex → the raw line in raw.txt (shuffle passes
     * the round's sequenceNumber). Old archives without lineIndex / a missing
     * line → null, and the UI degrades by hiding it. */
    rawLine(
      id: string,
      opts: { roundSeq?: number | null; lineIndex: number },
    ): Promise<{ line: string; fileLine: number } | null>;
    /** Intent guard (BACKLOG #26 Task 2): main reads + parses raw.txt (lazy,
     * fs try/catch → null) and returns the small structured `RawStreams`
     * instead of shipping the raw text (up to tens of MB) across IPC.
     * `baseMs` must be the caller's match/round `startTime` — see
     * rawStreams.ts's `parseRawStreams` doc comment for why. Missing/
     * unreadable raw.txt → `{ available: false, manaSamples: [], castFailed:
     * [] }`, never a rejection — every consumer degrades silently.
     * `roundDurationS` (BACKLOG #32): the caller's round-scoped duration in
     * seconds — threaded through to `parseRawStreams`' round-boundary clamp
     * so a Solo Shuffle round never sees another round's samples/events.
     * Optional so callers with no round context degrade to unbounded
     * (pre-#32 behavior), never a hard requirement. */
    getRawStreams(
      id: string,
      baseMs: number,
      roundDurationS?: number,
    ): Promise<RawStreams>;
    /** C3 image export: render the same renderer in an offscreen window and
     * capture the full page. savePath is passed directly only by E2E/scripts;
     * UI calls omit it → the system save dialog opens. Cancelled/failed →
     * null. */
    exportImage(opts: {
      matchId: string;
      roundSeq?: number | null;
      range?: { fromS: number; toS: number } | null;
      savePath?: string;
    }): Promise<{ path: string; width: number; height: number } | null>;
  };
  settings: {
    get(): Promise<GladlogSettings>;
    save(partial: Partial<GladlogSettings>): Promise<GladlogSettings>;
  };
  app: {
    getVersion(): Promise<string>;
    selectDirectory(): Promise<string | null>; // returns the chosen directory; cancelled → null. Choosing one auto-saves wowDirectory and restarts watching
    openExternal(url: string): Promise<void>;
    /** Open the system save dialog and write a text file; cancelled → null.
     * Used by the developer page to export a redacted fixture. */
    saveTextFile(opts: {
      defaultName: string;
      text: string;
    }): Promise<string | null>;
  };
  /** Windows NSIS auto-update (2026-08-02). The surface exists on every
   * platform — elsewhere getState() is a constant `disabled`, so the renderer
   * never branches on process.platform. */
  update: {
    getState(): Promise<UpdateState>;
    /** Manual check; ignores the autoCheckUpdates setting on purpose. */
    check(): Promise<void>;
    /** Runs the whole quit chain and then hands over to the installer;
     * no-op unless the state is "ready" (§4.3). */
    install(): Promise<void>;
    onState(cb: (s: UpdateState) => void): () => void;
  };
  compare: {
    run(input: {
      matchId: string;
      healerMetrics: Record<string, number | null>;
      spec: string;
      talents: number[];
      /** #37: hero-tree group (heroBuildGroupOf, renderer-side). */
      heroGroup?: string;
      bracket: string;
      archetype: string;
      wowBuild: string;
      /** 「对比自动补跑」触发(非用户点按钮);只影响 running 状态的解释文案 */
      autoTriggered?: boolean;
    }): Promise<void>;
    cancel(): Promise<void>;
    getCached(matchId: string): Promise<unknown | null>;
    /** Pullable comparison state (see CompareState in main/compare.ts): pull
     *  this on mount to recover a `done` that was dropped while unmounted, and
     *  fall back to getCached when it comes back idle. */
    getState(
      matchId: string,
    ): Promise<
      | { phase: "idle" }
      | { phase: "running"; startedAt: number; autoTriggered: boolean }
      | { phase: "done"; result: unknown }
      | { phase: "error"; message: string }
    >;
    onDelta(cb: (d: { matchId: string; text: string }) => void): () => void;
    onDone(cb: (d: { matchId: string; result: unknown }) => void): () => void;
    onError(cb: (d: { matchId: string; message: string }) => void): () => void;
  };
  analysis: {
    run(input: {
      matchId: string;
      candidates: any[];
      richContext: string;
      spec: string;
      /** Multi-model comparison: explicitly pick which backend/model this run
       * uses instead of the current selection saved in settings. Results are
       * persisted into a slot keyed by slotKeyOf(backend, model) and never
       * overwrite an older slot. */
      backendOverride?: { backend: AiBackend; model: string };
    }): Promise<void>;
    /** No argument = cancel everything; with matchId = invalidate only that
     * match's in-flight run/deepen (used by batch analysis). */
    cancel(matchId?: string): Promise<void>;
    /** A single atomic query used on remount: cache + running flag + summaries
     * of all slots. Asking in two separate calls would miss the run that
     * finished right in between. */
    getState(matchId: string): Promise<{
      cached: unknown | null;
      running: boolean;
      /** 在跑一轮的起跑时间与实际后端/模型(含 backendOverride)+ 是否已进
       * bad-json 重试轮;不在跑时 null。renderer 用它在重挂载后仍显示真实
       * 已耗时与重试标注。 */
      runningMeta: {
        since: number;
        backend: string;
        model: string;
        retrying: boolean;
      } | null;
      /** Summaries of all of this match's slots (without the result body),
       * ascending by createdAt. */
      slots: Array<{ key: string; createdAt: number; stale: boolean }>;
      /** The slot key that should currently be displayed/consumed; null when
       * no document exists. */
      activeKey: string | null;
    }>;
    /** No slotKey = use activeKey (current behavior); passing slotKey = read
     * that specific slot (used by the multi-model comparison tab switch). The
     * version gate applies either way. */
    getCached(matchId: string, slotKey?: string): Promise<unknown | null>;
    getFlags(matchId: string): Promise<Record<string, string>>;
    /** For batch analysis: ids of matches that already have a valid cache
     * (current language + current promptVersion). */
    listAnalyzed(): Promise<string[]>;
    /** Cross-match finding aggregation (per-category counts + recent instances
     * + flag stats). */
    aggregate(): Promise<
      Array<{
        category: string;
        count: number;
        recurring: number;
        done: number;
        recent: Array<{
          matchId: string;
          title: string;
          severity: string;
          createdAt: number;
        }>;
      }>
    >;
    /** Mistake notebook: findings from every analyzed match grouped by
     * category (including meta and flags). */
    notebook(): Promise<
      Array<{
        category: string;
        count: number;
        recurring: number;
        done: number;
        entries: Array<{
          matchId: string;
          flagKey: string;
          flag: string | null;
          title: string;
          explanation: string;
          severity: string;
          startTime: number;
          zoneId?: string;
          result?: string;
          bracket?: string;
        }>;
      }>
    >;
    /** Deep-dive round (automatic follow-up): triggered by the renderer once
     * the first round is done; the evidence pack is built deterministically in
     * the renderer. */
    deepen(input: {
      matchId: string;
      findings: unknown[];
      packs: unknown[];
      spec: string;
      ownerName?: string;
    }): Promise<void>;
    /** Window analysis (#16): the pack is built deterministically in the
     * renderer; single request-response, no emit.
     * force (added in #21 item11): pass true on an explicit retry to bypass the
     * cache read and force a fresh model call — the cache only protects
     * "re-selecting the same window" and must not swallow a user's retry. */
    analyzeWindow(input: {
      matchId: string;
      fromS: number;
      toS: number;
      pack: unknown;
      kind: "survival" | "offensive";
      spec: string;
      ownerName?: string;
      force?: boolean;
      /** Moment deep dive (2026-08-05): main does not rebuild the pack from
       * this flag (the renderer already folded it into `pack`) -- it only
       * affects the cache key (`:snap` windowKey suffix) and max_tokens. */
      snapshot?: boolean;
    }): Promise<
      | {
          status: "ok";
          /** Window-multi-finding Task 2: up to 4 entries (was a single
           * text/chips pair) -- see WindowAnalyzeEntry in main/analysis.ts. */
          entries: Array<{
            title: string | null;
            text: string;
            chips: Array<{
              t: number;
              label: string;
              unitNames: string[];
              spellId?: string;
            }>;
          }>;
          fromCache: boolean;
        }
      | { status: "audit-empty" }
      | { status: "no-client" }
      | { status: "busy" }
      | { status: "error" }
    >;
    setFlag(
      matchId: string,
      key: string,
      flag: "done" | "recurring" | null,
    ): Promise<Record<string, string>>;
    onDelta(cb: (d: { matchId: string; text: string }) => void): () => void;
    /** 首轮输出解析失败、正在自动重试(bad-json retry):CLI 后端单发分钟级,
     * 重试让总时长翻倍,必须让面板能解释这段等待。 */
    onRetry(cb: (d: { matchId: string }) => void): () => void;
    /** slotKey: the slot this round wrote (run = the effective slot after
     * backendOverride is applied; deepen = lastSlotKey). Invariant on the main
     * side — the slot that just finished is necessarily the new activeKey; this
     * field is only for a defensive cross-check, rendering still goes by the
     * freshly queried activeKey. It may be absent on old-cache/exception
     * fallback paths, hence optional. */
    onDone(
      cb: (d: { matchId: string; result: unknown; slotKey?: string }) => void,
    ): () => void;
    onError(cb: (d: { matchId: string; message: string }) => void): () => void;
  };
  /** Coach chat (spec 2026-08-02): continue the conversation on top of this
   * round's analysis session. */
  chat: {
    getState(matchId: string): Promise<ChatState>;
    send(input: {
      matchId: string;
      question: string;
      seed?: {
        richContext: string;
        spec: string;
        ownerName?: string;
        findingsSummary: string;
      };
    }): Promise<ChatSendResult>;
    cancel(matchId: string): Promise<void>;
  };
  /** Cross-match learning (spec 2026-07-26): rule reads, state, manual
   * consolidation. */
  learning: {
    getRules(): Promise<RulesDoc | null>;
    getState(): Promise<LearningState>;
    consolidate(): Promise<void>;
    onProgress(cb: (p: { scanned: number; total: number }) => void): () => void;
    onDone(
      cb: (d: {
        rules: number;
        distilled: number;
        dropped: number;
        distillError?: string;
      }) => void,
    ): () => void;
    onError(cb: (d: { message: string }) => void): () => void;
  };
  /** Bug report (2026-08-02): bundle that match's raw log + AI prompt/response
   * + comment, writing to the Drive sync folder (auto-uploaded when present) or
   * locally, then open the file manager once generated. */
  bugReport: {
    create(input: {
      matchId: string | null;
      roundSeq: number | null;
      comment: string;
    }): Promise<{ dir: string; synced: boolean }>;
  };
  /** OBS-driven external recording (track C, phase 1). */
  recorder: {
    getStatus(): Promise<RecorderStatus>;
    /** overrides = the settings page's current input (possibly unsaved);
     * omitted → use the saved configuration. */
    testConnection(overrides?: {
      url?: string | null;
      password?: string | null;
    }): Promise<{ ok: boolean; error?: string }>;
    /** Read this machine's OBS obs-websocket configuration (port/password/
     * enabled flag), save it automatically and try to connect. found=false: no
     * configuration was found; enabled=false: found it but the server is not
     * enabled (address and password are already stored — the user just needs to
     * tick "enable" in OBS). */
    autoConfig(): Promise<{
      found: boolean;
      enabled: boolean;
      ok: boolean;
      error?: string;
    }>;
    /** The recording associated with this match; none → null. url is a vod://
     * address; startedAt is the playback anchor (epoch ms, = the StartRecord
     * wall clock). */
    getForMatch(matchId: string): Promise<{
      url: string;
      startedAt: number;
      stoppedAt: number | null;
    } | null>;
    onStatus(cb: (s: RecorderStatus) => void): () => void;
    /** Task-5b: the settings page's "下载并启用" action for managed OBS.
     * Progress is pushed separately on onInstallProgress (a 179MB download
     * takes real time); the resolved promise here only reports pass/fail of
     * the whole install(+post-install assembly) sequence. */
    installObs(): Promise<{ ok: boolean; error?: string }>;
    onInstallProgress(cb: (p: ObsInstallProgress) => void): () => void;
    /** 复核 I4: durable, pollable install-state query — callable on mount, so
     * the settings row can render 待安装 immediately instead of depending on
     * a status push that may have already fired before it subscribed.
     * `platformSupported` (task 6, NEW-7): false on non-win32 -- the settings
     * page uses it to render the managed radio disabled-with-explanation. */
    getObsInstallState(): Promise<{
      installed: boolean;
      platformSupported: boolean;
    }>;
    /** Managed-OBS prefs (2026-09-04). Devices the managed instance can
     * record: `output` = desktop audio, `input` = microphones. Empty lists
     * when the managed instance is not running. */
    listAudioDevices(): Promise<{
      output: ObsAudioDevice[];
      input: ObsAudioDevice[];
    }>;
    /** Read the user's own OBS install (current profile + scene collection)
     * and copy its recording folder / desktop audio / mic into settings.
     * `applied` is the patch that was saved; found=false: no OBS config on
     * this machine. Read-only on the user's OBS. */
    importObsPrefs(): Promise<{
      found: boolean;
      configRoot?: string;
      applied?: Partial<ManagedObsPrefs>;
    }>;
    /** System folder picker for the recording directory; saves
     * `recordingDirectory` on pick. Cancelled → null. */
    selectRecordingDirectory(): Promise<string | null>;
  };
  icon: {
    get(name: string): Promise<string | null>;
  };
  /** UI scale (界面缩放). webFrame lives in the preload context, so the
   * renderer never has to import electron itself. Deliberately narrow: one
   * synchronous setter, no getter -- the stored value is already part of
   * GladlogSettings, and a second read path would be the same fact in two
   * places. Fire-and-forget: setZoomFactor has no failure the renderer could
   * act on. */
  ui: {
    setZoomFactor(factor: number): void;
  };
  /** Auto-detection of local CLI backends (claudeCli/agy/codex): when the
   *  command path is left blank, the settings page uses this to show
   *  "detected: …" / "not detected". Non-local backends → path: null. */
  ai: {
    detectCli(backend: string): Promise<{ path: string | null }>;
  };
  /** Developer page: the prompts and raw responses of the last 10 AI calls
   * (in memory only). */
  debug: {
    aiCalls(): Promise<
      Array<{
        kind: "analysis" | "compare";
        matchId: string;
        at: number;
        model: string;
        prompt: string;
        raw: string;
      }>
    >;
  };
}
declare global {
  interface Window {
    gladlog: GladlogApi;
  }
}
