import { DEFAULT_OBS_WS_URL, OBS_PASSWORD_REDACTED } from "../shared/protocol";
import type {
  BackendHealth,
  CaptureBackend,
  CaptureChunk,
} from "./captureBackend";
import type { ObsClientLike } from "./obsClient";
import type { RecordingEntry, RecordingsStore } from "./recordingsStore";
import { RECORDING_SCHEMA } from "./recordingsStore";

export { DEFAULT_OBS_WS_URL };

/** Safety valve for a segment that stays open and never sees close (worker died / log stream stalled). */
const SAFETY_STOP_MS = 40 * 60_000;
const META_BUFFER_CAP = 20;
/**
 * Managed-mode idle-split cadence (design doc §5.5): while continuously
 * recording outside a match window, cut a fresh chunk this often so a long
 * play session doesn't accumulate into one unbounded file. Paused the moment
 * a match opens and restarted only after the post-close split -- the hard
 * invariant is "never split during a match" (task-5 brief).
 *
 * 10 minutes -> 60s (user ruling 2026-09-05). This constant is what actually
 * bounds how much pre-match lobby footage sits at the head of a match's file:
 * the chunk carrying a match starts at the previous split, so at ten minutes
 * a match's video could open with ten minutes of queue. The ruling asked for
 * "one file, one match"; the honest half of that is bounding this number,
 * because the other half -- cutting at the match's own start -- can only ever
 * be as punctual as the combat log is (see MATCH_OPEN_SPLIT_MAX_LAG_MS).
 *
 * Cost of the shorter cadence is file COUNT, not bytes: the recorder was
 * already writing continuously either way. Unclaimed lobby chunks are pruned
 * by recordingsStore's orphan cap once they age past ORPHAN_GRACE_MS, and
 * pruneNow() runs on every split, i.e. now once a minute while idle.
 */
const IDLE_SPLIT_MS = 60_000;
/**
 * How stale the log may be for the match-OPEN split to be worth taking
 * (user ruling 2026-09-05, "开局也切", option C).
 *
 * The ruling wants one file per match. We only learn a match started when
 * `ARENA_MATCH_START` reaches us, and that is late by the combat log's own
 * lag — a >=2s batch flush on top of WoW's write lag, "可达 20s+"
 * (`docs/plans/2026-08-02-obs-phase2-design.md:166`). Splitting the moment we
 * hear about it therefore puts the first `lag` seconds of the match — the
 * opener, the first CC chain, the first burst — into the PREVIOUS file, and
 * pushes `headroom = source.startTime - chunk.startedAt` negative, which is
 * exactly the phase-1 defect phase 2's continuous recording was built to
 * remove (design doc §5.5 / §9.1 acceptance).
 *
 * So the split is gated on the lag we actually measured for THIS match: cut
 * when the log kept up (the loss is sub-second and the file really is just
 * the match), and decline when it did not — that match falls back to the
 * continuous-recording behaviour, whose head is now bounded by the shortened
 * IDLE_SPLIT_MS above rather than by ten minutes.
 *
 * A negative lag can only mean the log timestamp and the wall clock disagree
 * (a timezone/parse skew — see the parser's own timestamp traps), and we then
 * have no idea where "now" sits inside the match, so it declines too. Every
 * failure mode of this gate degrades to "don't split", never to "split in the
 * wrong place".
 */
const MATCH_OPEN_SPLIT_MAX_LAG_MS = 3_000;
/** Managed-mode per-chunk ceiling (design doc §5.5, 复核 I4 -- this is
 * SAFETY_STOP_MS's managed-mode reincarnation, but kept as its own constant:
 * SAFETY_STOP_MS stops the bypass recording outright on timeout, whereas this
 * one just forces a split and keeps recording continuously). Armed the moment
 * a chunk opens; cleared/rearmed on every subsequent chunk open (idle split,
 * match-boundary split, or this timer itself firing). */
const MAX_CHUNK_MS = 40 * 60_000;
/** Absolute stuck-match ceiling (复核 C1, post-review Critical fix). A
 * solo-shuffle lobby is one continuous ARENA_MATCH_START..END spanning the
 * WHOLE lobby -- routinely 20-30 minutes -- so a chunk that opened only ~10
 * minutes before the lobby started will hit MAX_CHUNK_MS while still
 * genuinely mid-match. The hard invariant (never split during a match) means
 * that ordinary timeout must be DEFERRED to the match-end split, not executed
 * immediately -- but a deferral with no upper bound just reintroduces
 * unbounded chunk growth if segmentClose never arrives (worker died / log
 * stream stalled). This second, much larger ceiling is the escape hatch for
 * THAT case: past this point the choice is data-corruption-vs-runaway-growth,
 * not continuity-vs-match-boundary, so it force-splits with a loud warn --
 * the same role bypass mode's own SAFETY_STOP_MS plays ("the safety valve is
 * worse than staying up, but better than never"). */
const STUCK_MATCH_MAX_CHUNK_MS = 2 * MAX_CHUNK_MS;
/** 复核 I5 (post-review Important fix): bounded retry cadence for a managed
 * startContinuous()+probe() attempt that comes back unhealthy. Deliberately
 * mirrors wowProcessWatch's own default poll interval rather than inventing
 * a new cadence -- this is a single bounded retry (not an independent
 * scheduling subsystem with its own backoff/jitter/max-attempts machinery):
 * if that one retry is also unhealthy, the session simply waits for the next
 * genuine WoW up-transition to try again from scratch. */
const MANAGED_CONNECT_RETRY_MS = 2000;
/** Timeout for a single OBS request. All start/stop calls share one serialized
 * promise chain, so any bare await that hangs (OBS stop stuck on encoder/disk)
 * would queue the chain — including the 40-minute safety valve — to death and
 * let the recording run forever (2026-08-02 forensics: the only path that
 * explains "still recording past 40 minutes"). */
const OBS_CALL_TIMEOUT_MS = 15_000;

function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () =>
        reject(new Error(`${what} timed out after ${OBS_CALL_TIMEOUT_MS}ms`)),
      OBS_CALL_TIMEOUT_MS,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export interface RecorderStatus {
  enabled: boolean;
  connected: boolean;
  recording: boolean;
  lastError: string | null;
  /** Managed mode only (task-5b brief, 复核 NEW-9): backend.probe()'s
   * black-frame result, so the settings-page status row can eventually show
   * whether the capture source is actually producing a picture, not just
   * "connected". null in bypass mode (no such probe exists there) and before
   * the first managed probe has ever run. Captured once per attemptManagedStart
   * (i.e. once per WoW up-transition) — the underlying black-frame check
   * itself only actually re-runs inside configureSession's own captureProbe()
   * call (initial-evidence semantics, deliberately not re-polled on a timer;
   * task-5b brief explicitly allows leaving this as-is rather than adding a
   * probe-refresh timer). */
  sourceActive: boolean | null;
}

export interface RecorderService {
  onSegmentOpen(info: { startTime: number; bracket: string }): void;
  onSegmentClose(info: { endTime: number | null; aborted: boolean }): void;
  associate(meta: { id: string; startTime: number; endTime: number }): void;
  getForMatch(matchId: string): RecordingEntry | null;
  getStatus(): RecorderStatus;
  /** overrides = the current (possibly unsaved) inputs on the settings page:
   * url of null means use the default address; empty/absent/sentinel password
   * falls back to the saved real value. Real-machine gotcha: typing the
   * password and clicking Test without saving would test with an empty
   * password and report "missing authentication string". */
  testConnection(overrides?: {
    url?: string | null;
    password?: string | null;
  }): Promise<{ ok: boolean; error?: string }>;
  stop(): Promise<void>;
  /** Run retention immediately (double-gate prune: count + bytes). Never
   * throws -- retention must never break the caller (startup wiring,
   * failure-path recovery). */
  pruneNow(): void;
  /** Managed mode only (task-5 brief 5c); the future watcher (Task 5b) calls
   * this on a WoW-process up-transition. A no-op whenever isManagedActive()
   * is false or no managedBackend was injected -- belt-and-suspenders, since
   * the watcher itself is only ever started under the same gate. */
  onWowUp(): void;
  /** Managed mode only; mirrors onWowUp for the down-transition -- stops
   * continuous recording and closes the tail chunk. Same defensive gate. */
  onWowDown(): void;
  /** Proactively connect once at app startup when recording is enabled
   * (review Important #2, 2026-08-03): `connected` used to start false and
   * only flip true inside ensureConnected(), which was only ever reached from
   * onSegmentOpen / doClose's orphan branch -- so a user with recording
   * enabled and OBS already running healthily saw the "未连接" banner from
   * launch until their first match, even though nothing was actually wrong.
   * Serialized on the same chain as start/stop so it cannot race a match
   * opening concurrently. Never throws -- like pruneNow, a failed startup
   * connect must degrade to lastError + status only, never take down the
   * caller (app.whenReady's init sequence). */
  connectAtStartup(): Promise<void>;
}

interface RecorderSettings {
  recordingEnabled: boolean;
  obsWebsocketUrl: string | null;
  obsWebsocketPassword: string | null;
  recordingKeepCount: number;
  recordingMaxBytes: number;
  /** Task 6 landed this as a real, non-optional `GladlogSettings` field
   * (previously a structural/optional handoff type per task-5 brief 复核
   * NEW-2 -- that comment now goes, this is the real field). */
  recordingMode: "managed" | "external";
}

/** Single-source managed-mode gate (task-5 brief 复核 B2/NEW-2): every entry
 * point that might touch the managed CaptureBackend -- onWowUp/onWowDown,
 * onSegmentOpen/onSegmentClose's managed branch, the idle/max-chunk timers,
 * and the future Task 5b assembly layer's decision whether to even create a
 * watcher/backend at all -- imports and calls THIS, never hand-copies the
 * three-term conjunction (CLAUDE.md's shared-predicate rule: that class of
 * duplication is the #1 recurring bug source in this repo). */
export function isManagedActive(
  s: Pick<RecorderSettings, "recordingEnabled" | "recordingMode">,
): boolean {
  return (
    s.recordingEnabled &&
    s.recordingMode === "managed" &&
    process.platform === "win32"
  );
}

/** Externally drives OBS record start/stop (route C, phase 1). Iron rule: any
 * OBS failure only degrades into lastError, never throws upward — parsing,
 * ingestion, and the analysis main path must be unaffected by recording.
 * Start/stop are serialized on a single promise chain to prevent interleaving
 * of back-to-back matches. */
export function createRecorderService(deps: {
  getSettings: () => RecorderSettings;
  recordings: RecordingsStore;
  clientFactory: () => ObsClientLike;
  emit: (channel: string, payload: unknown) => void;
  now?: () => number;
  /** Managed mode only; injected by Task 5b's assembly layer once
   * isManagedActive() was true at startup. undefined = bypass-only (mac/CI/
   * external mode) -- every managed entry point defensively re-checks
   * isManagedActive() anyway (belt-and-suspenders), so a stale/mismatched
   * backend reference can never fire managed side effects on its own. */
  managedBackend?: CaptureBackend;
  /** Managed mode only; injected by Task 5b's assembly layer alongside
   * managedBackend. Called from stop()'s managed branch (task-5b exit
   * sequence, point 1) AFTER backend.shutdown() has already run — the actual
   * OBS process teardown (`handle.stop()`), which recorder.ts has no
   * business knowing how to construct itself (that lives in
   * managedObsProcess.ts, owned by the assembly layer). undefined = no
   * managed process to stop (same "belt-and-suspenders, every managed entry
   * point re-checks" posture as managedBackend). */
  managedProcessStop?: () => Promise<void>;
}): RecorderService {
  let client: ObsClientLike | null = null;
  let connected = false;
  let recording = false;
  /** Gotcha caught in review round: reconcileWithReality() cannot rely on
   * GetRecordStatus's outputActive alone — that only proves "OBS is
   * recording", not "gladlog told it to record". When the user has OBS open
   * and is recording manually (e.g. their own stream backup), gladlog
   * connects, sees outputActive=true with local recording=false, and blindly
   * wrapping it up as an orphan would stop the user's own recording — a
   * destructive operation; the original behavior of "leave it alone, just set
   * lastError" is actually safer.
   *
   * Hence this "positive evidence" bit: only when gladlog itself successfully
   * called startRecord and has not yet confirmed a successful stopRecord may
   * closeOrphanRecording() act. Semantically it records ownership of the
   * current round, not ownership of "this video".
   *
   * Deliberately kept in memory only, never persisted: onClosed (websocket
   * disconnect) does not clear it — that is exactly the scenario C1 fixes
   * (OBS keeps recording independently during the disconnect; after
   * reconnecting we must still recognize it as ours). But an app crash or
   * restart wipes memory, at which point even a genuine gladlog orphan
   * recording degrades to the old behavior (startRecord reports already
   * active → lastError, OBS is left untouched). This is a deliberate
   * trade-off: better that the rare "true orphan after app restart" needs a
   * one-time manual cleanup in OBS than that the common "user running their
   * own OBS recording" gets stopped by mistake — asymmetric risk; the
   * destructiveness of the latter far outweighs the inconvenience of the
   * former. */
  let weStartedRecording = false;
  let startedAt = 0;
  let lastError: string | null = null;
  let safetyTimer: ReturnType<typeof setTimeout> | null = null;
  const metaBuffer: Array<{ id: string; startTime: number; endTime: number }> =
    [];
  let chain: Promise<void> = Promise.resolve();
  const now = deps.now ?? Date.now;

  // -- Managed mode (task-5 brief 5c) -- entirely separate state machine from
  // the bypass one above; mode-branching, not unification (复核 I2). Runs on
  // its own serialized chain so a hung managed backend call can never wedge
  // the bypass chain or vice versa (they are mutually exclusive in practice --
  // isManagedActive() gates which one ever runs -- but keeping them on
  // separate chains means that stays true even if that invariant is ever
  // violated).
  let managedRunning = false; // WoW up ⇒ we intend to be continuously recording (desire state; onWowUp/onWowDown idempotency only)
  /** 复核 I4/I5: EVIDENCE-based, unlike managedRunning above -- only flips
   * true once startContinuous() has actually succeeded AND probe() confirms
   * the backend is healthy. status()'s connected/recording read THESE, not
   * managedRunning, in managed mode -- otherwise the phase-0 banner would
   * report "connected" the instant WoW is merely observed to be up, even if
   * OBS never actually started recording (a permanent false-positive, not
   * just a startup lag). recording tracks connected 1:1 at this stage (no
   * separate failure mode yet); kept as its own variable for status() clarity
   * and so 5b's finer-grained probe wiring has somewhere to diverge them. */
  let managedConnected = false;
  let managedRecording = false;
  /** 复核 NEW-9 (task-5b): backend.probe()'s black-frame result, captured
   * verbatim on every attemptManagedStart (health may be null on a thrown
   * exception -- belt-and-suspenders branch -- in which case this reads as
   * null, same as "no probe has ever run"). See RecorderStatus.sourceActive's
   * own doc comment for the initial-evidence-only semantics. */
  let managedSourceActive: boolean | null = null;
  let managedInMatch = false; // segmentOpen..segmentClose window: idle timer pauses here
  /** 复核 C1: MAX_CHUNK_MS fired while managedInMatch was true, so the split
   * was deferred instead of executed (never split during a match). Consumed
   * by onSegmentClose's managed branch, which logs the deferred-split fact
   * before running the match-end split that was always going to happen
   * anyway. Reset to false the moment a fresh chunk opens
   * (armManagedMaxChunkTimer). */
  let managedMaxChunkPending = false;
  let managedIdleTimer: ReturnType<typeof setTimeout> | null = null;
  let managedMaxChunkTimer: ReturnType<typeof setTimeout> | null = null;
  /** 复核 C1: the STUCK_MATCH_MAX_CHUNK_MS escape hatch, armed only while a
   * max-chunk split is pending (i.e. only while genuinely mid-match). */
  let managedStuckTimer: ReturnType<typeof setTimeout> | null = null;
  /** 复核 NEW-3 (re-review Minor fix, folded in): the one managed timer that
   * used to be a bare untracked setTimeout, unlike the other three
   * (managedIdleTimer/managedMaxChunkTimer/managedStuckTimer), which are all
   * held in a variable and cleared by onWowDown. A WoW down->up flap inside
   * the MANAGED_CONNECT_RETRY_MS window used to leave the old attempt's
   * retry armed to fire into a torn-down (or freshly-restarted) session --
   * harmless in practice (attemptManagedStart is idempotent and re-checks
   * managedRunning at fire time), but inconsistent with the other three and
   * a latent double-probe. Tracked and cleared in onWowDown now, same as the
   * others. */
  let managedStartRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let chunkOpenedUnsub: (() => void) | null = null;
  let managedChain: Promise<void> = Promise.resolve();
  const runManaged = (fn: () => Promise<void>) => {
    managedChain = managedChain.then(fn).catch(() => {});
  };

  const status = (): RecorderStatus => {
    const s = deps.getSettings();
    // 复核 I4: managed mode has its own evidence-based connected/recording
    // pair (see managedConnected/managedRecording's own comment) -- the
    // bypass `connected`/`recording` variables are never written to by any
    // managed code path, so reading them here in managed mode would leave
    // the phase-0 banner permanently stuck on "未连接" even while a managed
    // session is healthy and recording.
    //
    // 复核 NEW-1 (re-review Important fix): gated on `deps.managedBackend`
    // too, matching every OTHER managed entry point (onSegmentOpen,
    // onWowUp, onWowDown all require `isManagedActive(s) &&
    // deps.managedBackend`) -- this one used to be the sole one-term
    // exception. Without the second term: settings say managed+win32 but no
    // backend was actually injected (today's index.ts wiring, latent until
    // Task 6 lands the persisted setting ahead of Task 5b's injection) ->
    // the recorder silently falls through to actually running the BYPASS
    // state machine (managedBackend is undefined, so every managed branch's
    // own `&& deps.managedBackend` guard fails and control falls to the
    // bypass `run(...)` path) while THIS function still reported the never-
    // written managed flags (both permanently false) -- a real, working
    // bypass recording with the banner permanently screaming "未连接".
    if (isManagedActive(s) && deps.managedBackend) {
      return {
        enabled: s.recordingEnabled,
        connected: managedConnected,
        recording: managedRecording,
        lastError,
        sourceActive: managedSourceActive,
      };
    }
    return {
      enabled: s.recordingEnabled,
      connected,
      recording,
      lastError,
      sourceActive: null, // no such probe in bypass mode
    };
  };
  const pushStatus = () => deps.emit("gladlog:recorder:status", status());
  const run = (fn: () => Promise<void>) => {
    chain = chain.then(fn).catch(() => {});
  };

  /** Double-gate retention (design doc 4.2). Called from every path that ends
   * a segment -- success AND failure -- plus once at startup (main/index.ts),
   * so a run of stopRecord failures still reclaims disk instead of retention
   * living only on the success path (the bug this task fixes). Never throws:
   * retention must never break the main recording pipeline. */
  function pruneNow(): void {
    try {
      const s = deps.getSettings();
      deps.recordings.prune({
        keepCount: s.recordingKeepCount,
        maxBytes: s.recordingMaxBytes,
      });
    } catch {
      /* retention must never break the main pipeline */
    }
  }

  function isAlreadyActiveError(e: unknown): boolean {
    return /already active/i.test(String(e));
  }

  // -- Managed-mode helpers --

  function clearManagedIdleTimer(): void {
    if (managedIdleTimer) {
      clearTimeout(managedIdleTimer);
      managedIdleTimer = null;
    }
  }
  function armManagedIdleTimer(): void {
    clearManagedIdleTimer();
    managedIdleTimer = setTimeout(() => {
      runManaged(() => managedSplit("idle"));
    }, IDLE_SPLIT_MS);
  }
  function clearManagedMaxChunkTimer(): void {
    if (managedMaxChunkTimer) {
      clearTimeout(managedMaxChunkTimer);
      managedMaxChunkTimer = null;
    }
  }
  function clearManagedStuckTimer(): void {
    if (managedStuckTimer) {
      clearTimeout(managedStuckTimer);
      managedStuckTimer = null;
    }
  }
  function armManagedMaxChunkTimer(): void {
    clearManagedMaxChunkTimer();
    clearManagedStuckTimer();
    managedMaxChunkPending = false;
    managedMaxChunkTimer = setTimeout(onManagedMaxChunkTimeout, MAX_CHUNK_MS);
  }

  /** 复核 C1 (post-review Critical fix): the naive version of this callback
   * used to split unconditionally, which can cut a chunk mid-match (a
   * solo-shuffle lobby's single match routinely runs 20-30 minutes -- see
   * STUCK_MATCH_MAX_CHUNK_MS's comment) and hand `associate()` two halves of
   * one match, orphaning whichever half loses the overlap contest and letting
   * it age out and get deleted. The hard invariant -- never split during a
   * match -- means this must DEFER instead: mark the split as owed and let
   * onSegmentClose's always-runs match-end split actually perform it. The
   * STUCK_MATCH_MAX_CHUNK_MS timer is the bounded escape hatch for a match
   * that never ends at all. */
  function onManagedMaxChunkTimeout(): void {
    managedMaxChunkTimer = null;
    if (managedInMatch) {
      managedMaxChunkPending = true;
      console.warn(
        "[recorder] 单分片超 40 分钟但仍在对局中,推迟到对局结束后分片(斗内绝不切)",
      );
      clearManagedStuckTimer();
      managedStuckTimer = setTimeout(
        onManagedStuckMatchTimeout,
        STUCK_MATCH_MAX_CHUNK_MS - MAX_CHUNK_MS,
      );
      return;
    }
    runManaged(() => managedSplit("max-chunk"));
  }

  /** 复核 C1: the bounded escape hatch -- only ever armed while a max-chunk
   * split is pending (i.e. only while still mid-match after MAX_CHUNK_MS has
   * already elapsed once). Firing here means the match has now run past
   * STUCK_MATCH_MAX_CHUNK_MS (2×MAX_CHUNK_MS) without segmentClose ever
   * arriving -- past this point the tradeoff flips from "never split
   * mid-match" to "an unbounded chunk is worse than a mid-match cut", so this
   * forces the split anyway, loudly. */
  function onManagedStuckMatchTimeout(): void {
    managedStuckTimer = null;
    runManaged(async () => {
      console.warn(
        `[recorder] 单场对局超过 ${STUCK_MATCH_MAX_CHUNK_MS / 60_000} 分钟仍未结束(疑似卡死/日志流中断)—— 数据完整性优先于连续性,强制分片`,
      );
      await managedSplit("stuck-match");
    });
  }

  /** Wires the backend's persistent chunk-open listener exactly once (M9:
   * obs-websocket-js has no `off`, so this is deliberately never
   * unsubscribed for the life of the recorder -- it must keep tracking every
   * chunk across repeated WoW up/down cycles). Deferred to first use (inside
   * onWowUp's managedActive-gated branch) rather than at construction time,
   * so a recorder built with a managedBackend but never actually eligible to
   * run managed (isManagedActive()===false throughout) makes truly ZERO
   * backend calls -- not even a subscribe. */
  function ensureChunkOpenedSubscription(): void {
    if (chunkOpenedUnsub || !deps.managedBackend) return;
    chunkOpenedUnsub = deps.managedBackend.onChunkOpened((c: CaptureChunk) => {
      deps.recordings.openChunk(c.videoPath, c.startedAt);
      armManagedMaxChunkTimer();
      // A fresh chunk just opened; the idle-split clock only runs outside a
      // match window (the hard invariant: never split mid-match), so only
      // (re)arm it here when we are not currently between segmentOpen and
      // segmentClose.
      if (!managedInMatch) armManagedIdleTimer();
    });
  }

  /** Shared by stop()'s managed branch and onWowDown -- both need "ask the
   * backend to close whatever chunk is currently open and index it", with
   * identical closeChunk+pruneNow semantics; kept as one helper so the two
   * call sites can't drift (复核 Minor, task-5b review round 2). Does NOT
   * touch lastError itself -- callers decide their own error handling
   * around the await (stop()'s managed branch and onWowDown each have
   * slightly different surrounding try/catch shapes already). */
  async function closeManagedTailChunk(backend: CaptureBackend): Promise<void> {
    const closed = await backend.stopContinuous();
    if (closed) {
      deps.recordings.closeChunk(closed.videoPath, closed.stoppedAt ?? now());
      pruneNow();
    }
  }

  /** Shared by the idle timer, the max-chunk timer, and the post-match-close
   * split -- all three are "cut the current chunk now" with the same
   * closeChunk + pruneNow + idle-timer-restart tail. Never throws: backend
   * failures degrade to lastError only (iron rule, same as the bypass path).
   * Tolerates splitChunk() resolving null (Task 4's note: a split can cleanly
   * time out under rapid retries) by logging and re-arming both timers for
   * another attempt later, rather than retrying in a tight loop. */
  async function managedSplit(
    reason: "idle" | "max-chunk" | "match-end" | "match-open" | "stuck-match",
  ): Promise<void> {
    // Deliberately gated on backend presence alone, not isManagedActive(): by
    // the time this runs, a managed session is already under way (its timers
    // only ever get armed from inside an isManagedActive()-gated entry point
    // in the first place -- see onWowUp/ensureChunkOpenedSubscription), and a
    // settings flicker mid-session must not leave an already-open chunk
    // stranded forever. onWowDown remains the authoritative "actually stop"
    // signal.
    if (!deps.managedBackend) return;
    let closed: CaptureChunk | null = null;
    try {
      closed = await deps.managedBackend.splitChunk();
      lastError = null;
    } catch (e) {
      lastError = String(e);
      closed = null; // an exception and a clean null both mean "no new chunk
      // opened" -- both must fall into the same no-retry-storm handling below.
    }
    if (closed) {
      deps.recordings.closeChunk(closed.videoPath, closed.stoppedAt ?? now());
      pruneNow();
    } else {
      console.warn(`[recorder] splitChunk 未产出新分片,跳过(reason=${reason})`);
      // onChunkOpened will not fire for a failed split (no new chunk was
      // actually opened by the backend) -- without this, a failed split would
      // silently disable every future idle/max-chunk split for the rest of
      // the session. Re-arming here is "try again next window", not a tight
      // retry.
      if (!managedInMatch) armManagedIdleTimer();
      armManagedMaxChunkTimer();
    }
    if (reason === "max-chunk") {
      console.warn("[recorder] 单分片超 40 分钟,已强制分片");
    }
    pushStatus();
  }

  /** 复核 I5 (post-review Important fix): the REAL managed backend's contract
   * is to never throw out of startContinuous() -- it returns early and
   * surfaces its own failure via probe().lastError instead (task-4's
   * CaptureBackend design). A version of onWowUp that only wrapped
   * startContinuous() in try/catch would therefore see it "succeed" on a
   * real, failed attempt, latch managedRunning=true forever, and record
   * nothing for the rest of the session with a status the banner reports as
   * healthy -- silent and unrecoverable until the next full WoW restart.
   * Evidence (probe()) is the only trustworthy success signal; a thrown
   * exception is still handled defensively (belt-and-suspenders for a test
   * double or a future contract violation), not relied upon.
   *
   * 复核 NEW-2 (re-review Important fix): the ready check is `health.ready`
   * ALONE now -- the original also required `!health.lastError`, but
   * managedObsBackend.ts's `lastError` is STICKY (set by every failing
   * request across the whole backend's lifetime; cleared in exactly one
   * unrelated CreateInput recovery branch; never cleared by a later
   * successful call in general). Requiring it to be falsy meant one
   * transient failure anywhere in the session -- e.g. a SplitRecordFile
   * timeout under rapid retries, already documented as expected/tolerated in
   * managedSplit's own comment -- would permanently veto every LATER,
   * genuinely healthy WoW up-transition for the rest of the app's life
   * (pointless retry loop, permanent banner alarm, even while chunks kept
   * getting indexed correctly). `lastError` is still surfaced through
   * RecorderStatus below for diagnostics; it just no longer gates success.
   *
   * Assembly-order dependency (documented here for Task 5b, not enforced by
   * this function): the real backend's `probe().ready` is `connected &&
   * sessionConfigured`, and `startContinuous()` itself never calls
   * `configureSession()` -- so `health.ready` can only ever become true if
   * Task 5b's assembly layer has already called `backend.configureSession()`
   * at least once (stage-1 plan's startup sequence step 6) before this
   * recorder ever sees a WoW up-transition. If that ordering is violated,
   * `health.ready` stays false forever and this function's bounded retry
   * (see armManagedStartRetry) just keeps firing every 2s with no way for
   * this function to tell "assembly forgot a step" apart from "OBS genuinely
   * isn't ready yet" -- they are indistinguishable from in here by design. */
  async function attemptManagedStart(isRetry: boolean): Promise<void> {
    if (!deps.managedBackend) return;
    let health: BackendHealth | null = null;
    try {
      await deps.managedBackend.startContinuous();
      health = await deps.managedBackend.probe();
    } catch (e) {
      lastError = String(e);
    }
    // 复核 NEW-9: captured regardless of ready -- sourceActive is orthogonal
    // diagnostic info (did the capture source actually produce a picture the
    // last time configureSession's captureProbe ran), not a success gate.
    managedSourceActive = health ? health.sourceActive : null;
    if (health && health.ready) {
      managedConnected = true;
      managedRecording = true;
      lastError = null;
    } else {
      managedConnected = false;
      managedRecording = false;
      lastError = health?.lastError ?? lastError ?? "managed backend 未就绪";
      if (!isRetry) armManagedStartRetry();
    }
    pushStatus();
  }

  function clearManagedStartRetryTimer(): void {
    if (managedStartRetryTimer) {
      clearTimeout(managedStartRetryTimer);
      managedStartRetryTimer = null;
    }
  }
  function armManagedStartRetry(): void {
    clearManagedStartRetryTimer(); // 复核 NEW-3: track/clear like the other three managed timers
    managedStartRetryTimer = setTimeout(() => {
      managedStartRetryTimer = null;
      // WoW may have gone back down (or settings flipped away from managed)
      // before this fired -- nothing to retry in that case, and retrying
      // anyway would resurrect a session onWowDown already tore down.
      if (!managedRunning) return;
      runManaged(() => attemptManagedStart(true));
    }, MANAGED_CONNECT_RETRY_MS);
  }

  /** C1 state-mismatch cleanup: OBS is still recording while we locally think
   * we are not (typical trigger: OBS kept recording independently during a
   * websocket disconnect). The chosen semantics are "stop this orphan
   * recording and try to index it" rather than "adopt it as the new segment" —
   * adoption would pollute the new match's time window with the old recording,
   * and associate()'s overlap matching would get harder to align. We use the
   * startedAt we still remember (not cleared before the disconnect) as the
   * orphan's start; if even startedAt is missing (should be unreachable,
   * defensive fallback) we degrade to the current time rather than crash on
   * indexing. A stopRecord failure itself (e.g. OBS was manually stopped
   * between GetRecordStatus and StopRecord) is also swallowed so recovery does
   * not fail as a whole — the next startRecord's already-active fallback will
   * take another shot.
   *
   * Only invoked when weStartedRecording is true (see call-site comments and
   * the notes at the variable declaration); the extra guard here is purely
   * defensive (belt-and-suspenders), so a future change that forgets the
   * call-site check cannot mistakenly stop a recording gladlog did not
   * start. */
  async function closeOrphanRecording(): Promise<void> {
    if (!client || !weStartedRecording) return;
    try {
      const { outputPath } = await withTimeout(
        client.stopRecord(),
        "StopRecord",
      );
      const entry: RecordingEntry = {
        schema: RECORDING_SCHEMA,
        videoPath: outputPath,
        startedAt: startedAt || now(),
        stoppedAt: now(),
        matchIds: [],
      };
      deps.recordings.add(entry);
      for (const m of metaBuffer) deps.recordings.associate(m);
    } catch {
      /* best effort: see comment above */
    } finally {
      recording = false;
      // At this point we have connected to OBS and confirmed/attempted in
      // person (not guessing during a disconnect), so regardless of whether
      // stopRecord succeeded, this round's ownership is settled — keeping it
      // true carries no extra information; its only effect would be raising
      // the odds of a future misjudgment.
      weStartedRecording = false;
      if (safetyTimer) {
        clearTimeout(safetyTimer);
        safetyTimer = null;
      }
      // Failure path too (see comment above): a stopRecord failure here must
      // not mean retention silently skips this round.
      pruneNow();
    }
  }

  /** Reconcile once after every (re)connect: query OBS's real recording state
   * and compare with the local in-memory bit. Only done right after
   * connecting — once connected is true, later ensureConnected calls
   * short-circuit and do not reconcile again (no need; no new source of state
   * mismatch). */
  async function reconcileWithReality(): Promise<void> {
    if (!client) return;
    let obsRecording: boolean;
    try {
      obsRecording = (
        await withTimeout(client.getRecordStatus(), "GetRecordStatus")
      ).outputActive;
    } catch {
      return; // can't query — keep current state; startRecord's already-active fallback covers it
    }
    if (obsRecording && !recording) {
      if (weStartedRecording) {
        await closeOrphanRecording();
      }
      // else: OBS is recording, we are not, and there is no positive evidence
      // that gladlog started it — most likely the user started recording
      // manually (or it is a stale orphan from before a gladlog crash/restart;
      // weStartedRecording is not persisted, so it cannot be recovered). Never
      // touch it: let the upcoming startRecord() fail with "already active"
      // the old way and go through lastError — the only choice that cannot
      // damage the user's data (gotcha caught in review round; details at the
      // weStartedRecording declaration).
    } else if (!obsRecording && recording) {
      // Reverse mismatch: OBS already stopped (manual stop / crash-restart);
      // stop believing locally that we are recording.
      // I3 known gap (honestly labeled, not handled): this branch corresponds
      // to "the OBS process itself crashed and restarted" — not the websocket
      // disconnect case where OBS keeps recording (that one is covered by
      // closeOrphanRecording indexing via stopRecord()'s outputPath). When the
      // OBS process crashes, the half-written video file really exists, but
      // GetRecordStatus only returns outputActive with no file path — there is
      // no way to recover and index it here. Orphans that truly have no index
      // row at all can only be surfaced by RecordingsStore.prune()'s
      // unindexed-file visibility log (I3) for manual cleanup; no
      // auto-indexing or auto-deleting.
      recording = false;
      if (safetyTimer) {
        clearTimeout(safetyTimer);
        safetyTimer = null;
      }
    }
  }

  async function ensureConnected(): Promise<void> {
    if (connected && client) return;
    const s = deps.getSettings();
    client = deps.clientFactory();
    client.onClosed(() => {
      connected = false;
      // recording is still cleared to false — this is the signal "we no
      // longer trust ourselves to be managing this recording", not an
      // assertion "OBS actually stopped" (after a disconnect OBS is most
      // likely still recording on its own). Clearing it is necessary:
      // onSegmentOpen dedupes back-to-back DOUBLE_START via
      // `if (recording) return`; without clearing, the next match's open
      // would be blocked by that dedupe and not even attempt to reconnect.
      // The real OBS state is asked by reconcileWithReality() after
      // reconnecting; if it turns out "still recording", it is wrapped up as
      // an orphan (see closeOrphanRecording).
      recording = false;
      // Deliberately does NOT null `client` here (considered during the
      // testConnection re-review fix above). It would be a no-op for control
      // flow: every read of `client` is gated behind either `connected`
      // (already false the moment this fires, so ensureConnected()'s
      // short-circuit `if (connected && client) return;` already falls
      // through regardless of whether `client` itself is null or dead) or a
      // call site that runs ensureConnected() first and so gets a freshly
      // reassigned `client` before touching it (closeOrphanRecording via
      // doClose / reconcileWithReality). The one place a stale-but-non-null
      // `client` combined with connected=true actually broke the invariant
      // was testConnection flipping connected back to true independently --
      // fixed at that call site instead of here.
      pushStatus();
    });
    await withTimeout(
      client.connect(
        s.obsWebsocketUrl ?? DEFAULT_OBS_WS_URL,
        s.obsWebsocketPassword ?? undefined,
      ),
      "connect",
    );
    connected = true;
    await reconcileWithReality();
  }

  async function doClose(): Promise<void> {
    if (safetyTimer) {
      clearTimeout(safetyTimer);
      safetyTimer = null;
    }
    if (!recording) {
      // A disconnect cleared recording (needed by onClosed's dedupe) / a past
      // stopRecord failed — but weStartedRecording still remembers this debt
      // is ours. When play ends with no next match, this is the only chance
      // to stop recording: reconnect and collect the orphan. Previously this
      // returned immediately, so "last match disconnects → OBS never stops",
      // and the 40-minute safety valve and the quit path were disabled by the
      // same gate (main root cause of the 2026-08-02 real-machine "recording
      // never ends after playing").
      if (!weStartedRecording) return;
      await ensureConnected(); // reconcile on reconnect has likely collected it already
      await closeOrphanRecording(); // idempotent: no-op if collected; direct stop when never disconnected
      return;
    }
    if (!client) return;
    // Leave the "recording" state first: if stopRecord throws (OBS stopped
    // manually on its side, etc.), recording must not stay stuck at true, or
    // every later match would refuse to record (agy flash review #3).
    recording = false;
    try {
      const { outputPath } = await withTimeout(
        client.stopRecord(),
        "StopRecord",
      );
      // Clear weStartedRecording only after stopRecord is confirmed
      // successful — a mid-way failure (usually firing at an already-dead
      // client during a disconnect; see the onClosed comment in
      // ensureConnected) keeps it true, so the next reconcileWithReality()
      // still recognizes this as gladlog's own debt instead of misjudging a
      // true orphan as "not started by us" because we cleared too early.
      weStartedRecording = false;
      const entry: RecordingEntry = {
        schema: RECORDING_SCHEMA,
        videoPath: outputPath,
        startedAt,
        stoppedAt: now(),
        matchIds: [],
      };
      deps.recordings.add(entry);
      // One of the two-way fallbacks: the match message arrived before
      // segmentClose, so its meta is already in the buffer
      for (const m of metaBuffer) deps.recordings.associate(m);
      pruneNow();
    } catch (e) {
      // stopRecord (or something after it) failed: this segment couldn't be
      // indexed, but retention must not silently skip this round either -- a
      // run of failures used to mean disk was never reclaimed at all (the bug
      // this task fixes). Rethrow so callers still set lastError exactly as
      // before.
      pruneNow();
      throw e;
    }
  }

  return {
    onSegmentOpen(info) {
      const s = deps.getSettings();
      if (!s.recordingEnabled) return;
      if (isManagedActive(s) && deps.managedBackend) {
        // Hard invariant (task-5 brief): NEVER split during a match. Pausing
        // the idle timer here, synchronously, is deliberate -- it must not
        // wait for the managed chain to drain, or an idle timeout already
        // queued just ahead of this segmentOpen could still fire and split
        // mid-match.
        managedInMatch = true;
        clearManagedIdleTimer();
        // The match-OPEN split (user ruling 2026-09-05 "开局也切", option C).
        // This is the ONE split taken inside a match window, and it does not
        // violate the invariant above: it lands on the match's own opening
        // instant, not in its middle -- but only when the log was punctual
        // enough for "now" to still BE that instant. See
        // MATCH_OPEN_SPLIT_MAX_LAG_MS for why the gate exists and why every
        // way it can fail lands on "don't split".
        const logLagMs = now() - info.startTime;
        const splitAtOpen =
          logLagMs >= 0 && logLagMs <= MATCH_OPEN_SPLIT_MAX_LAG_MS;
        if (!splitAtOpen) {
          console.warn(
            `[recorder] 开局分片跳过:日志滞后 ${Math.round(logLagMs)}ms 超出 ${MATCH_OPEN_SPLIT_MAX_LAG_MS}ms —— ` +
              `此刻切会把开场前 ${Math.round(logLagMs)}ms 的开手留在上一个文件里,本场按连续录制处理(头部场外不超过 ${IDLE_SPLIT_MS / 1000}s)`,
          );
        }
        runManaged(async () => {
          // Order matters: split FIRST so the chapter marker lands at ~0s of
          // the match's own chunk rather than at the tail of the lobby's.
          if (splitAtOpen) await managedSplit("match-open");
          try {
            // U3: hybrid_mp4 chapter marker -- pure enhancement, failure is
            // silent by CaptureBackend's own contract and must never touch
            // lastError or block the match from being tracked.
            await deps.managedBackend!.markChapter(`match ${info.bracket}`);
          } catch {
            /* markChapter is enhancement-only; silent per interface contract */
          }
        });
        return;
      }
      run(async () => {
        if (recording) return; // back-to-back / DOUBLE_START: same recording keeps covering
        try {
          await ensureConnected();
          try {
            await withTimeout(client!.startRecord(), "StartRecord");
          } catch (e) {
            // Second line of defense: reconcileWithReality() is a snapshot at
            // connect time; there is still a tiny TOCTOU window between
            // GetRecordStatus and this startRecord (e.g. OBS just restarted
            // and state has not synced). On "already active", wrap up the
            // orphan and retry once instead of failing this match outright
            // and leaving lastError stuck until the next one (the core
            // consequence C1 addresses: retries failing forever) — but again
            // only act when weStartedRecording is true; otherwise it may be a
            // user-initiated recording, so let the error go to lastError as
            // before (caught in review round; same rationale as
            // reconcileWithReality).
            if (!isAlreadyActiveError(e) || !weStartedRecording) throw e;
            await closeOrphanRecording();
            await withTimeout(client!.startRecord(), "StartRecord");
          }
          startedAt = now();
          recording = true;
          weStartedRecording = true;
          lastError = null;
          safetyTimer = setTimeout(
            () =>
              run(async () => {
                try {
                  await doClose();
                } catch (e) {
                  lastError = String(e);
                } finally {
                  pushStatus();
                }
              }),
            SAFETY_STOP_MS,
          );
        } catch (e) {
          lastError = String(e);
        }
        pushStatus();
      });
    },
    onSegmentClose() {
      // Managed branch is keyed on managedInMatch (not isManagedActive()) --
      // if we entered this match via the managed markChapter path, the close
      // must mirror it regardless of any settings flicker in between; falling
      // through to the bypass branch here would silently strand the open
      // chunk (see managedSplit's comment on the same tradeoff).
      if (managedInMatch && deps.managedBackend) {
        managedInMatch = false;
        // 复核 C1: if MAX_CHUNK_MS fired while we were mid-match, the split it
        // wanted was deferred (see onManagedMaxChunkTimeout) rather than
        // dropped -- it is "consumed" here: the stuck-match escape hatch is no
        // longer needed (the match is actually ending on its own, on time),
        // and the split that follows below IS that deferred split, just run
        // at the correct moment instead of mid-match.
        const deferredMaxChunkSplit = managedMaxChunkPending;
        managedMaxChunkPending = false;
        clearManagedStuckTimer();
        runManaged(async () => {
          try {
            await deps.managedBackend!.markChapter("match end");
          } catch {
            /* enhancement-only; silent per interface contract */
          }
          if (deferredMaxChunkSplit) {
            console.warn(
              "[recorder] 对局结束,执行此前因 MAX_CHUNK_MS 推迟的分片",
            );
          }
          await managedSplit("match-end");
        });
        return;
      }
      // Not gated on recordingEnabled: turning the setting off mid-match must
      // still be able to stop the recording (doClose is a no-op when not
      // recording anyway; agy flash review #4).
      run(async () => {
        try {
          await doClose();
        } catch (e) {
          lastError = String(e);
        }
        pushStatus();
      });
    },
    associate(meta) {
      metaBuffer.push(meta);
      if (metaBuffer.length > META_BUFFER_CAP) metaBuffer.shift();
      try {
        const hit = deps.recordings.associate(meta);
        // 设计 §5.5「如实记录不许静默」(复核 I16): negative headroom -- the
        // match is reported as starting before the chunk that ended up
        // carrying it. TOLERANCE_MS's overlap window can legitimately absorb
        // this (log lag, or back-to-back matches whose gap is smaller than
        // that margin), so it must not fail ingestion; but silently accepting
        // it would hide a real timing anomaly if one is happening.
        //
        // Managed-mode ONLY (复核 I3, post-review Important fix): the backend
        // stamps a chunk's startedAt at the moment its file actually starts
        // (captureBackend.ts's own doc comment), so a managed chunk starting
        // AFTER its match's reported startTime really is an anomaly worth
        // flagging. In bypass mode, `startedAt` is stamped by `now()` only
        // AFTER StartRecord's round trip resolves, strictly later than the
        // match's own startTime by construction -- so `meta.startTime <
        // hit.startedAt` is the UNIVERSAL, expected case there (ordinary log
        // lag), not an anomaly, and warning on every single bypass match
        // would be pure noise that trains everyone to ignore the log line.
        if (
          hit &&
          meta.startTime < hit.startedAt &&
          isManagedActive(deps.getSettings())
        ) {
          console.warn(
            `[recorder] associate: meta.startTime(${meta.startTime}) < chunk.startedAt(${hit.startedAt}) -- 负 headroom`,
          );
        }
      } catch {
        /* a corrupted index must not affect ingestion */
      }
    },
    getForMatch: (id) => deps.recordings.getForMatch(id),
    getStatus: status,
    async testConnection(overrides) {
      try {
        const c = deps.clientFactory();
        const s = deps.getSettings();
        const url =
          overrides && "url" in overrides
            ? (overrides.url ?? DEFAULT_OBS_WS_URL)
            : (s.obsWebsocketUrl ?? DEFAULT_OBS_WS_URL);
        const typed = overrides?.password;
        const password =
          typed && typed !== OBS_PASSWORD_REDACTED
            ? typed
            : (s.obsWebsocketPassword ?? undefined);
        await c.connect(url, password);
        await c.disconnect();
        // Review Important #2: a successful test must be reflected in the
        // status the banner/settings row read, not just returned to the
        // caller -- otherwise "测试连接" can succeed while the row still says
        // 未连接 until the next match opens. This uses a throwaway client (not
        // the persistent `client`/`connected` pair ensureConnected manages),
        // so only flip `connected` on SUCCESS: a failed test with edited-but-
        // unsaved overrides must not stomp on a real, currently-connected
        // persistent session by reporting it disconnected.
        //
        // Re-review fix (2026-08-03): setting `connected = true` here broke
        // the invariant ensureConnected() relies on -- connected===true ⇒ the
        // persistent `client` is live. Reachable sequence: OBS restarts →
        // the persistent client's onClosed fires, sets connected=false but
        // leaves `client` pointed at the now-dead object (nothing nulls it
        // there) → user clicks 测试连接 (or 自动配置, which also routes
        // through here) → this throwaway probe succeeds → connected=true
        // again, with a dead persistent client. ensureConnected()'s
        // short-circuit `if (connected && client) return;` would then never
        // reconnect for the rest of the session. Drop the stale persistent
        // reference so the next ensureConnected() call is forced through the
        // real reconnect path.
        //
        // Guarded on "were we already connected" (read BEFORE this
        // assignment), not unconditional: if we were already connected,
        // `client` is presumably live and may be mid-recording -- doClose()
        // needs that exact reference to call stopRecord() on, and nulling it
        // out from under an active recording would leave `recording` stuck
        // true with no client to stop it. connected=false always implies
        // recording=false (see onClosed), so this guard can never null a
        // client an active recording still depends on.
        if (!connected) client = null;
        connected = true;
        pushStatus();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
    async connectAtStartup() {
      const s = deps.getSettings();
      // 复核 I1: in managed mode there is no user-run OBS on :4455 to dial --
      // doing so anyway just fails every startup and pollutes lastError with
      // a connection refusal that has nothing to do with managed recording.
      if (isManagedActive(s)) return;
      if (!s.recordingEnabled) return;
      await new Promise<void>((res) =>
        run(async () => {
          try {
            await ensureConnected();
            lastError = null;
          } catch (e) {
            // Degrade to lastError only -- never throw out of startup wiring
            // (same iron rule as pruneNow: recorder failures must not affect
            // the rest of app init).
            lastError = String(e);
          }
          pushStatus();
          res();
        }),
      );
    },
    async stop() {
      // Task-5b exit sequence, point 1: managed teardown lives HERE, not in
      // a separate assembly-layer function, so the existing before-quit
      // chain's stopRecorder closure (`() => recorder?.stop() ?? ...`)
      // covers managed automatically with no index.ts changes at quit time.
      //
      // Gated on `deps.managedBackend` presence ALONE, not
      // `isManagedActive(s) && deps.managedBackend` like status()/onWowUp/
      // onWowDown -- deliberately, mirroring managedSplit()'s own rationale:
      // once a managed session is under way (a backend was actually
      // injected), a late settings flicker (e.g. the user disables
      // recordingEnabled moments before quitting) must not silently skip
      // releasing the OBS process/websocket -- only THIS branch knows how.
      if (deps.managedBackend) {
        const backend = deps.managedBackend;
        await new Promise<void>((res) =>
          runManaged(async () => {
            clearManagedIdleTimer();
            clearManagedMaxChunkTimer();
            clearManagedStuckTimer();
            clearManagedStartRetryTimer();
            if (managedRunning) {
              try {
                await closeManagedTailChunk(backend);
              } catch (e) {
                lastError = String(e);
              }
            }
            try {
              await backend.shutdown();
            } catch (e) {
              lastError = String(e);
            }
            try {
              await deps.managedProcessStop?.();
            } catch (e) {
              lastError = String(e);
            }
            // 复核 C1 (task-5b review round 2): chunkOpenedUnsub was assigned
            // once (ensureChunkOpenedSubscription's own guard: `if
            // (chunkOpenedUnsub || !deps.managedBackend) return`) and never
            // cleared anywhere -- an off→on runtime toggle injects a BRAND
            // NEW managedBackend (a fresh OBS process), but the stale
            // subscription's non-null check silently skipped subscribing to
            // it. No race needed to hit this: enable (subscribes to
            // backend1) → disable (this branch runs, backend1 torn down) →
            // enable again (assembly spawns backend2) → the next onWowUp
            // sees a non-null chunkOpenedUnsub and never subscribes to
            // backend2 -- recordings.openChunk is never called again for the
            // rest of the session (video files exist on disk with no index
            // row: no association, no VOD, and the idle/max-chunk timers
            // that ensureChunkOpenedSubscription's callback arms never get
            // armed either -- one unbounded file). Unsubscribing from the
            // OLD backend and resetting to null here means the NEXT
            // onWowUp's ensureChunkOpenedSubscription() call is free to
            // subscribe to whatever backend is injected next.
            if (chunkOpenedUnsub) {
              chunkOpenedUnsub();
              chunkOpenedUnsub = null;
            }
            managedRunning = false;
            managedConnected = false;
            managedRecording = false;
            managedSourceActive = null;
            managedInMatch = false;
            managedMaxChunkPending = false;
            // 复核 I6 (task-5b review round 2): pushStatus was missing here
            // entirely (unlike onWowDown, which already pushes) -- after a
            // managed teardown the settings-page status row would keep
            // showing whatever the last managed status was (often
            // "connected"/"recording") until some unrelated later event
            // happened to push again. Runs while `deps.managedBackend` is
            // still non-null (the assembly layer only clears it AFTER this
            // whole stop() call resolves), so status() still takes the
            // managed branch and reports the just-reset false/false/null
            // triple -- exactly the clean "torn down" snapshot wanted.
            pushStatus();
            res();
          }),
        );
        return;
      }
      await new Promise<void>((res) =>
        run(async () => {
          if (safetyTimer) {
            clearTimeout(safetyTimer);
            safetyTimer = null;
          }
          try {
            await doClose();
          } catch {
            /* best effort on the quit path */
          }
          try {
            if (client) await withTimeout(client.disconnect(), "disconnect");
          } catch {
            /* same as above */
          }
          connected = false;
          res();
        }),
      );
    },
    pruneNow,
    onWowUp() {
      const s = deps.getSettings();
      if (!isManagedActive(s) || !deps.managedBackend) return;
      if (managedRunning) return; // idempotent: duplicate up-signal must not double-start
      managedRunning = true;
      ensureChunkOpenedSubscription();
      runManaged(() => attemptManagedStart(false));
    },
    onWowDown() {
      const s = deps.getSettings();
      if (!isManagedActive(s) || !deps.managedBackend) return;
      if (!managedRunning) return;
      managedRunning = false;
      managedConnected = false;
      managedRecording = false;
      managedSourceActive = null;
      managedInMatch = false;
      managedMaxChunkPending = false;
      clearManagedIdleTimer();
      clearManagedMaxChunkTimer();
      clearManagedStuckTimer();
      clearManagedStartRetryTimer();
      runManaged(async () => {
        try {
          await closeManagedTailChunk(deps.managedBackend!);
          lastError = null;
        } catch (e) {
          lastError = String(e);
        }
        pushStatus();
      });
    },
  };
}
