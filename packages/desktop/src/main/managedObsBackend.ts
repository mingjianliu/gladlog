import { readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BlackFrameJudgment, judgeBlackFrame } from "../shared/blackFrame";
import { PINNED_ENCODER } from "../shared/obsAsset";
import type {
  BackendHealth,
  CaptureBackend,
  CaptureChunk,
} from "./captureBackend";
import {
  DESKTOP_AUDIO_INPUT_KIND,
  MANAGED_CANVAS,
  MIC_AUDIO_INPUT_KIND,
  SCENE_NAME,
} from "./obsConfigWriter";
import type { ManagedObsWs } from "./managedObsClient";
import { realManagedObsWs } from "./managedObsClient";

/** 每次 websocket 调用的超时(task-4 brief 规则 4)。 */
const CALL_TIMEOUT_MS = 15_000;
/** splitChunk() 等 RecordFileChanged 的超时(brief 规则 3)。 */
const SPLIT_EVENT_TIMEOUT_MS = 5_000;
/** startContinuous() 等首分片 RecordStateChanged(STARTED)事件的超时——超了才
 * 兜底扫描 recDir(brief 规则 1)。取值与 split 等待一致,同属"等一次 websocket
 * 事件往返"的量级,没有独立依据要求不同的数字。 */
const FIRST_CHUNK_EVENT_TIMEOUT_MS = 5_000;

/** 托管实例里 game_capture 输入的固定名字——不进场景 JSON(design doc §5.4:
 * "采集源不写进场景 JSON"),运行时用 CreateInput 现建。 */
const GAME_CAPTURE_INPUT_NAME = "gladlog-capture";
/** Throwaway inputs created by listAudioDevices() (one per audio input
 * kind), removed again in the same call. Prefixed so they can never collide
 * with the real channel sources (Desktop Audio / Mic/Aux) or the capture
 * input above. */
const AUDIO_PROBE_INPUT_PREFIX = "gladlog-audio-probe-";
/** Repair inputs created by `ensureAudioWired()` when the scene collection's
 * global audio channels came up empty — see that function's doc comment. */
const DESKTOP_AUDIO_FALLBACK_INPUT_NAME = "gladlog-desktop-audio";
const MIC_AUDIO_FALLBACK_INPUT_NAME = "gladlog-mic-audio";

/** OBS_ALIGN_LEFT (1) | OBS_ALIGN_TOP (4) — where the scene item's position
 * point sits on the item. `libobs/obs-defs.h`. */
const OBS_ALIGN_TOP_LEFT = 5;
/** OBS_ALIGN_CENTER (0) — how the source is placed INSIDE its bounding box,
 * which is a different axis from `alignment` above. */
const OBS_ALIGN_CENTER = 0;

// 编码器 stage 1 PINNED(brief 规则 5:没有 websocket 编码器枚举 API,design doc
// §2.5 源码级事实)。NVENC 选择是 stage 2 项。PINNED_ENCODER 定义在
// shared/obsAsset.ts,与 obsConfigWriter 的 basic.ini 写入共享同一常量
// (shared-predicate rule, CLAUDE.md)。

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 给一个 promise 包 15s(或调用方指定)超时——超时/失败都不让异常越过这层抛给
 * CaptureBackend 的调用方(brief 规则 7:"recording failures never throw into
 * the caller")。 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} 超时(${ms}ms)`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** 目录下最新的 mp4 —— 首分片路径的兜底(brief 规则 1)。目录只有我们写,取最新
 * mtime 是安全的(design doc §5.5)。 */
function scanNewestMp4(dir: string): string | null {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  let newest: { path: string; mtimeMs: number } | null = null;
  for (const name of entries) {
    if (!/\.mp4$/i.test(name)) continue;
    const p = join(dir, name);
    let mtimeMs: number;
    try {
      mtimeMs = statSync(p).mtimeMs;
    } catch {
      continue;
    }
    if (!newest || mtimeMs > newest.mtimeMs) newest = { path: p, mtimeMs };
  }
  return newest ? newest.path : null;
}

/**
 * 极简 24bpp 未压缩 BMP 解码器,只取逐像素亮度。选 BMP(而不是 PNG)是本任务的
 * 实现决定,不是设计文档强制的格式:PNG 要走 DEFLATE 解压,零依赖(任务约束:
 * 不加新包)下要么自己写一个 inflate,要么引入库;BMP 是无压缩位图,首部 54
 * 字节定长、像素按行倒序排列、行按 4 字节对齐补零,几十行就能吃透,SaveSourceScreenshot
 * 的 imageFormat 参数本来就允许任意 Qt 支持的格式,bmp 在列。
 */
function decodeBmpLuminance(buf: Buffer): number[] {
  if (buf.length < 54 || buf[0] !== 0x42 || buf[1] !== 0x4d) {
    throw new Error("不是有效的 BMP(缺 'BM' 幻数或文件过短)");
  }
  const dataOffset = buf.readUInt32LE(10);
  const width = buf.readInt32LE(18);
  const heightRaw = buf.readInt32LE(22);
  const bitCount = buf.readUInt16LE(28);
  const compression = buf.readUInt32LE(30);
  if (bitCount !== 24 || compression !== 0) {
    throw new Error(
      `不支持的 BMP 格式(bitCount=${bitCount}, compression=${compression});captureProbe 只请求 24bpp 无压缩`,
    );
  }
  const height = Math.abs(heightRaw);
  const bottomUp = heightRaw > 0;
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const out: number[] = new Array(width * height);
  for (let row = 0; row < height; row++) {
    const y = bottomUp ? height - 1 - row : row;
    const rowStart = dataOffset + row * rowSize;
    for (let x = 0; x < width; x++) {
      const off = rowStart + x * 3;
      const b = buf[off]!;
      const g = buf[off + 1]!;
      const r = buf[off + 2]!;
      // Standard luma weights.
      out[y * width + x] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }
  return out;
}

export interface ManagedObsBackendDeps {
  ensureProcess: () => Promise<{ wsUrl: string; wsPassword: string }>;
  recDir: string;
  /** The SAME two device ids handed to `writeObsConfig` (assembly reads both
   * from one settings snapshot). The config writer puts them in the scene
   * collection's global audio channels; `ensureAudioWired()` re-checks at
   * runtime that OBS actually came up with those channels populated, and
   * repairs them from these values if it did not — so the two sides can
   * never disagree about which device is supposed to be recording.
   * `undefined` (not `null`) = caller predates this field and wants the old
   * "trust the scene collection" behaviour with no repair. */
  desktopAudioDeviceId?: string | null;
  micDeviceId?: string | null;
  clientFactory?: () => ManagedObsWs;
  now?: () => number;
}

/** One enumerable audio endpoint, as OBS reports it for a `device_id`
 * property: `id` is what goes into the scene collection / settings, `name`
 * is the human label the settings page shows. */
export interface ObsAudioDevice {
  id: string;
  name: string;
}

export type ManagedObsBackend = CaptureBackend & {
  configureSession(): Promise<void>;
  captureProbe(): Promise<{ shotPath: string; black: boolean }>;
  /** Managed-OBS prefs (2026-09-04): the devices the settings page can
   * offer. `output` = desktop-audio candidates (wasapi_output_capture),
   * `input` = microphone candidates (wasapi_input_capture). Empty lists
   * when not connected or when a request fails — never throws, and never
   * leaves a recording-status error behind (enumeration is not recording). */
  listAudioDevices(): Promise<{
    output: ObsAudioDevice[];
    input: ObsAudioDevice[];
  }>;
};

export function createManagedObsBackend(
  deps: ManagedObsBackendDeps,
): ManagedObsBackend {
  const nowFn = deps.now ?? Date.now;
  const makeClient = deps.clientFactory ?? realManagedObsWs;

  let client: ManagedObsWs | null = null;
  let connected = false;
  let listenersAttached = false;
  let continuousActive = false;
  let sessionConfigured = false;
  let encoder: string | null = null;
  let sourceActive = false;
  let lastError: string | null = null;
  let currentChunk: CaptureChunk | null = null;
  // Review fix (Important #1): while a stopContinuous() await is in flight,
  // an event that would open/replace currentChunk must be a pure no-op — a
  // spontaneous open belongs to nothing once we've committed to stopping,
  // and stopContinuous() itself snapshots currentChunk before its await as a
  // second, independent line of defense (belt-and-braces: even if a future
  // edit adds a path that mutates currentChunk without checking this flag,
  // the snapshot still protects the returned chunk's identity).
  let stopInFlight = false;

  const openChunkListeners = new Set<(c: CaptureChunk) => void>();
  const pendingFirstChunkWaiters = new Set<() => void>();
  // Review fix (Important #2): waiters are keyed by the videoPath they
  // expect the NEXT RecordFileChanged to close, captured from currentChunk
  // at the moment their splitChunk() call issued SplitRecordFile. A waiter
  // returns `true` from its callback once it has consumed a matching event;
  // handleChunkSplitEvent only removes waiters that return true, so a
  // mismatched/orphan event (e.g. a late arrival from a split whose client
  // side already timed out) leaves a still-pending waiter armed instead of
  // silently satisfying it with the wrong chunk.
  const pendingSplitWaiters = new Set<
    (closed: CaptureChunk | null) => boolean
  >();
  // Review fix (Important #2, hardening beyond the reviewer's literal
  // suggestion): pure identity matching alone is NOT sufficient. If a split
  // times out client-side while currentChunk hasn't moved yet, and a SECOND
  // split is then issued before the first one's real (late) answer shows up,
  // the second split captures the SAME expected identity as the abandoned
  // first one (nothing else has changed currentChunk in between) — so a
  // plain videoPath match would let the late orphan satisfy the wrong
  // waiter. obs-websocket gives no per-request correlation id on
  // RecordFileChanged, so the client-side fix is: once a wait times out,
  // remember that an answer for that exact identity is still "owed" by OBS.
  // When that answer finally arrives, let it update the ledger (it's a real
  // transition) but do NOT offer it to any currently-pending waiter — that
  // waiter's own request is a logically different ask, even if it happens to
  // expect the same string right now.
  const staleExpectedClosingPaths = new Set<string | null>();

  function notifyOpened(c: CaptureChunk): void {
    for (const cb of openChunkListeners) cb(c);
  }

  function openFirstChunk(path: string): void {
    if (stopInFlight) return; // 规则(review #1):stop 途中的开启事件不算数
    if (currentChunk) return; // race between event and fallback scan — first wins
    currentChunk = { videoPath: path, startedAt: nowFn(), stoppedAt: null };
    const waiters = [...pendingFirstChunkWaiters];
    pendingFirstChunkWaiters.clear();
    for (const w of waiters) w();
    notifyOpened(currentChunk);
  }

  function handleChunkSplitEvent(newPath: string): void {
    if (stopInFlight) return; // 规则(review #1):stop 途中的分片事件不算数——
    // 无论是"正在录的分片被意外关闭"还是"冒出一个没人管的新分片",在我们已经
    // 决定要停止的这段时间里都不应该改写账本。
    // Review minor: 只取一次墙钟,新旧分片共用同一个时间点——否则两次 nowFn()
    // 调用之间有微小间隙,上一个分片的 stoppedAt 与下一个分片的 startedAt 就不
    // 严格相邻了(账本上出现一道不存在的空隙)。
    const splitAt = nowFn();
    const closed: CaptureChunk | null = currentChunk
      ? { ...currentChunk, stoppedAt: splitAt }
      : null;
    const closedPath = closed ? closed.videoPath : null;
    currentChunk = { videoPath: newPath, startedAt: splitAt, stoppedAt: null };
    // If this event pays off a stale (already-timed-out) split's debt, the
    // ledger update above still stands (it's a real OBS transition), but the
    // event is not eligible to satisfy anyone else's wait — see
    // staleExpectedClosingPaths' doc comment.
    const paysStaleDebt = staleExpectedClosingPaths.delete(closedPath);
    if (!paysStaleDebt) {
      // Review fix (Important #2): offer the event to every pending waiter,
      // but only remove the ones that actually claim it (closed chunk's path
      // matches what they're waiting for). Iterate a snapshot since a waiter
      // callback mutates the live Set.
      for (const waiterFn of [...pendingSplitWaiters]) {
        if (waiterFn(closed)) pendingSplitWaiters.delete(waiterFn);
      }
    }
    notifyOpened(currentChunk);
  }

  function attachListeners(c: ManagedObsWs): void {
    if (listenersAttached) return;
    listenersAttached = true;
    // 规则 1:监听必须在 StartRecord 之前挂好 —— attachListeners() 的所有调用点
    // 都在任何 call("StartRecord") 之前(ensureConnected 里),这里不重复断言,
    // fake 测试按调用顺序断言。
    c.on("RecordStateChanged", (data) => {
      const outputState = data.outputState;
      const outputPath = data.outputPath;
      if (
        typeof outputState === "string" &&
        /STARTED/i.test(outputState) &&
        typeof outputPath === "string" &&
        outputPath.length > 0
      ) {
        openFirstChunk(outputPath);
      }
    });
    c.on("RecordFileChanged", (data) => {
      const newOutputPath = data.newOutputPath;
      if (typeof newOutputPath === "string" && newOutputPath.length > 0) {
        handleChunkSplitEvent(newOutputPath);
      }
    });
  }

  /** 等首分片事件到达,超时返回(不 reject——调用方随后走兜底扫描)。 */
  function waitForFirstChunkEvent(ms: number): {
    promise: Promise<void>;
    cancel: () => void;
  } {
    let settled = false;
    let resolveFn!: () => void;
    const promise = new Promise<void>((res) => {
      resolveFn = res;
    });
    const waiterFn = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pendingFirstChunkWaiters.delete(waiterFn);
      resolveFn();
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      pendingFirstChunkWaiters.delete(waiterFn);
      resolveFn();
    }, ms);
    pendingFirstChunkWaiters.add(waiterFn);
    return {
      promise,
      cancel: () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pendingFirstChunkWaiters.delete(waiterFn);
      },
    };
  }

  /** 等 RecordFileChanged **关闭 `expectedClosingPath` 这一个分片**,超时返回
   * `undefined`(超时哨兵,区别于事件带来的合法 `null`——currentChunk 恰好为空
   * 时的关闭结果)。`expectedClosingPath` 是发起 SplitRecordFile 那一刻
   * currentChunk 的路径(review #2 的关联字段)——不匹配的事件(比如上一个已经
   * 超时的 split 迟到的回声)会被 waiterFn 拒收(返回 false),继续挂着等真正
   * 匹配的那次,而不是被随便一个事件喂饱。 */
  function waitForSplitEvent(
    ms: number,
    expectedClosingPath: string | null,
  ): {
    promise: Promise<CaptureChunk | null | undefined>;
    cancel: () => void;
  } {
    let settled = false;
    let resolveFn!: (v: CaptureChunk | null | undefined) => void;
    const promise = new Promise<CaptureChunk | null | undefined>((res) => {
      resolveFn = res;
    });
    // Returns true iff this event was consumed (matched) — the caller
    // (handleChunkSplitEvent) only removes the waiter from the pending set
    // when this returns true, so a mismatch leaves it armed.
    const waiterFn = (closed: CaptureChunk | null): boolean => {
      if (settled) return true; // already resolved by our own timeout — detach
      const closedPath = closed ? closed.videoPath : null;
      if (closedPath !== expectedClosingPath) return false; // orphan/late event, not ours
      settled = true;
      clearTimeout(timer);
      resolveFn(closed);
      return true;
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      pendingSplitWaiters.delete(waiterFn);
      // The request itself succeeded (only a wait, not the SplitRecordFile
      // call, timed out) — OBS may still deliver the real event later. Mark
      // the debt so that late arrival updates the ledger but can't be
      // mistaken for a DIFFERENT, subsequently-issued split's own answer.
      staleExpectedClosingPaths.add(expectedClosingPath);
      resolveFn(undefined);
    }, ms);
    pendingSplitWaiters.add(waiterFn);
    return {
      promise,
      cancel: () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pendingSplitWaiters.delete(waiterFn);
      },
    };
  }

  async function callWithTimeout(
    req: string,
    data?: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    if (!client) {
      lastError = `${req} 失败: 未连接`;
      return null;
    }
    try {
      return await withTimeout(client.call(req, data), CALL_TIMEOUT_MS, req);
    } catch (err) {
      lastError = `${req} 失败: ${errMessage(err)}`;
      return null;
    }
  }

  /** 确保 process 已就绪 + client 已连接 + 监听器已挂好。configureSession() 和
   * startContinuous() 都可能是"第一个真正建立连接的调用",谁先调用谁做这份工作,
   * 幂等。 */
  async function ensureConnected(): Promise<boolean> {
    if (connected && client) {
      attachListeners(client);
      return true;
    }
    let proc: { wsUrl: string; wsPassword: string };
    try {
      proc = await deps.ensureProcess();
    } catch (err) {
      lastError = `ensureProcess 失败: ${errMessage(err)}`;
      return false;
    }
    if (!client) client = makeClient();
    attachListeners(client);
    try {
      await withTimeout(
        client.connect(proc.wsUrl, proc.wsPassword),
        CALL_TIMEOUT_MS,
        "connect",
      );
    } catch (err) {
      lastError = `连接失败: ${errMessage(err)}`;
      return false;
    }
    connected = true;
    return true;
  }

  async function startContinuous(): Promise<void> {
    if (continuousActive) return; // 幂等(规则 10)
    const ok = await ensureConnected();
    if (!ok) return;

    const firstChunkWait = currentChunk
      ? null
      : waitForFirstChunkEvent(FIRST_CHUNK_EVENT_TIMEOUT_MS);
    const result = await callWithTimeout("StartRecord");
    if (result === null) {
      firstChunkWait?.cancel();
      return;
    }
    continuousActive = true;

    if (firstChunkWait) {
      await firstChunkWait.promise;
      if (!currentChunk) {
        const scanned = scanNewestMp4(deps.recDir);
        if (scanned) {
          openFirstChunk(scanned);
        } else {
          lastError = `首个分片路径未知:STARTED 事件未带 outputPath 且 ${deps.recDir} 下没有 mp4 文件`;
        }
      }
    }
  }

  async function stopContinuous(): Promise<CaptureChunk | null> {
    if (!client) return null;
    // Review fix (Important #1): snapshot BEFORE the await, and gate the
    // event handlers with stopInFlight for the duration — a RecordFileChanged
    // that lands while StopRecord is in flight (e.g. a split whose event was
    // late past its own 5s timeout, then WoW exits right after) must not
    // silently swap in a fresh, essentially-empty chunk as "the" chunk we
    // report back. Both defenses are independent on purpose: the flag stops
    // the mutation from happening at all; the snapshot means even if some
    // future path mutated currentChunk anyway, this function still returns
    // the chunk that was actually open when the stop was requested.
    const chunkAtStopStart = currentChunk;
    stopInFlight = true;
    try {
      // 规则 1:StopRecord 的响应体绝不读取(分片后 outputPath 恒返回第一个分片)
      // —— 下面只调用,完全不触碰返回值。
      await callWithTimeout("StopRecord");
    } finally {
      stopInFlight = false;
    }
    continuousActive = false;
    if (!chunkAtStopStart) return null;
    const closed: CaptureChunk = { ...chunkAtStopStart, stoppedAt: nowFn() };
    currentChunk = null;
    return closed;
  }

  // Review fix (Important #2, serialization half): a promise chain acting as
  // a mutex. Two concurrent splitChunk() calls must not both read
  // currentChunk and both wait for "the next RecordFileChanged" at the same
  // time — the second call's request only goes out once the first has fully
  // resolved (event received or timed out), so each call's expected-closing
  // identity (captured in doSplitOnce, below) is always accurate for what it
  // actually asked for.
  let splitQueue: Promise<void> = Promise.resolve();

  async function doSplitOnce(): Promise<CaptureChunk | null> {
    if (!client || !connected) {
      lastError = "splitChunk: 未连接";
      return null;
    }
    // Review fix (Important #2, correlation half): capture what THIS split
    // expects to close, at the moment it actually issues the request — not
    // at some earlier point where another queued call could have moved
    // currentChunk on already.
    const expectedClosingPath = currentChunk ? currentChunk.videoPath : null;
    // 先注册等待者,再发请求 —— 避免事件比"开始等待"更早到达导致漏接(brief 规则
    // 3 的等待顺序,也是让这条路径在同步 fake 与异步真实事件下都不出竞态的关键)。
    const wait = waitForSplitEvent(SPLIT_EVENT_TIMEOUT_MS, expectedClosingPath);
    const result = await callWithTimeout("SplitRecordFile");
    if (result === null) {
      wait.cancel();
      return null;
    }
    const closed = await wait.promise;
    if (closed === undefined) {
      lastError = `SplitRecordFile: 等待 RecordFileChanged 超时(${SPLIT_EVENT_TIMEOUT_MS}ms)`;
      return null;
    }
    return closed;
  }

  async function splitChunk(): Promise<CaptureChunk | null> {
    const previous = splitQueue;
    let release!: () => void;
    splitQueue = new Promise<void>((res) => {
      release = res;
    });
    await previous; // wait for any split already in flight to fully settle
    try {
      return await doSplitOnce();
    } finally {
      release();
    }
  }

  function onChunkOpened(cb: (c: CaptureChunk) => void): () => void {
    openChunkListeners.add(cb);
    return () => openChunkListeners.delete(cb);
  }

  async function markChapter(name: string): Promise<void> {
    // 规则 6:纯增强,失败静默 —— 不设 lastError,不抛出。
    if (!client || !connected) return;
    try {
      await withTimeout(
        client.call("CreateRecordChapter", { chapterName: name }),
        CALL_TIMEOUT_MS,
        "CreateRecordChapter",
      );
    } catch {
      // 静默吞掉——hybrid_mp4 之外的容器本来就会失败,这是预期路径。
    }
  }

  async function probe(): Promise<BackendHealth> {
    return {
      ready: connected && sessionConfigured,
      encoder,
      sourceActive,
      lastError,
    };
  }

  async function shutdown(): Promise<void> {
    const c = client;
    if (c && connected) {
      try {
        await withTimeout(c.disconnect(), CALL_TIMEOUT_MS, "disconnect");
      } catch (err) {
        lastError = `disconnect 失败: ${errMessage(err)}`;
      }
    }
    client = null;
    connected = false;
    listenersAttached = false;
    continuousActive = false;
    sessionConfigured = false;
    encoder = null;
    currentChunk = null;
  }

  async function configureSession(): Promise<void> {
    const ok = await ensureConnected();
    if (!ok) return;
    const gameCaptureSettings = {
      capture_mode: "any_fullscreen",
      // priority 存的是枚举值 CLASS=0/TITLE=1/EXE=2,不是下拉框位置——
      // design doc §5.4;2 = 按 exe 匹配,插件默认。
      priority: 2,
      anti_cheat_hook: true,
    };
    const created = await callWithTimeout("CreateInput", {
      sceneName: SCENE_NAME,
      inputName: GAME_CAPTURE_INPUT_NAME,
      inputKind: "game_capture",
      inputSettings: gameCaptureSettings,
    });
    if (created === null) {
      // Review fix (Important #3): CreateInput's most common failure mode is
      // "this input already exists" — reconnecting to a managed OBS instance
      // that's still running from an earlier connect() (the process outlives
      // any one websocket session) hits exactly this, since the input was
      // created the first time around and never got removed. Previously
      // this branch just gave up: sessionConfigured/encoder stayed
      // permanently unset and probe().ready stayed permanently false even
      // though the capture source is perfectly fine. Probe with
      // GetInputSettings instead of trying to pattern-match CreateInput's
      // error text (which obs-websocket doesn't give us a stable code for)
      // — if the input answers, it exists, and we proceed.
      const existing = await callWithTimeout("GetInputSettings", {
        inputName: GAME_CAPTURE_INPUT_NAME,
      });
      if (existing === null) return; // 真失败——lastError 已经是 GetInputSettings 的错误
      lastError = null; // CreateInput 的报错是假警报(已恢复),别让它赖在 lastError 里
      // Best-effort: push our settings shape back onto the existing input in
      // case it drifted (e.g. a user or a previous gladlog version touched
      // it). Failure here is NOT fatal — the input existing is already
      // enough to proceed; SetInputSettings failing just leaves its own
      // lastError visible via probe() for later diagnosis, but doesn't
      // block sessionConfigured.
      await callWithTimeout("SetInputSettings", {
        inputName: GAME_CAPTURE_INPUT_NAME,
        inputSettings: gameCaptureSettings,
      });
    }
    await fitCaptureToCanvas();
    await ensureAudioWired();
    sessionConfigured = true;
    encoder = PINNED_ENCODER;
    await captureProbe();
  }

  /**
   * 真机症状(2026-09-05,4K 显示器):录像里只有游戏画面左上角的一小块。
   *
   * 根因是构造性的,不是偶发:`CreateInput` 建出来的场景项**没有任何
   * transform**,OBS 于是按源的原始像素尺寸把它摆在 (0,0) 且不缩放,而画布被
   * basic.ini 固定成 MANAGED_CANVAS。3840×2160 的游戏画面因此被
   * 画布裁掉,只剩左上角 1920×1080 —— 正好是 1/4 面积。1080p 显示器上这个 bug
   * 完全不可见,所以之前的真机 gate 没抓到。
   *
   * 修法是给场景项设**边界框**而不是去猜显示器尺寸:`OBS_BOUNDS_SCALE_INNER`
   * 让 OBS 自己把源等比缩放到塞进这个框。这对任何游戏分辨率都成立,包括玩家
   * 中途改分辨率(源尺寸变了,bounds 不变,OBS 重新算缩放),也包括带鱼屏
   * (等比缩放后上下留黑边,而不是裁掉两侧)。
   *
   * 画布尺寸取 `GetVideoSettings` 的实测值,只有拿不到时才回落到
   * MANAGED_CANVAS 常量 —— 同一个事实两个消费者,取值单源(CLAUDE.md
   * 共享谓词规则),而实测值还能兜住"profile 漂了"的情况。
   *
   * 失败不致命:transform 设不上只是画面还是老样子,不该让整个 session 判死
   * (与 configureSession 里 SetInputSettings 的处置一致)。
   */
  async function fitCaptureToCanvas(): Promise<void> {
    const video = await callWithTimeout("GetVideoSettings");
    const baseW = video?.["baseWidth"];
    const baseH = video?.["baseHeight"];
    const canvasW =
      typeof baseW === "number" && baseW > 0 ? baseW : MANAGED_CANVAS.width;
    const canvasH =
      typeof baseH === "number" && baseH > 0 ? baseH : MANAGED_CANVAS.height;
    const item = await callWithTimeout("GetSceneItemId", {
      sceneName: SCENE_NAME,
      sourceName: GAME_CAPTURE_INPUT_NAME,
    });
    const sceneItemId = item?.["sceneItemId"];
    if (typeof sceneItemId !== "number") return;
    await callWithTimeout("SetSceneItemTransform", {
      sceneName: SCENE_NAME,
      sceneItemId,
      sceneItemTransform: {
        positionX: 0,
        positionY: 0,
        alignment: OBS_ALIGN_TOP_LEFT,
        boundsType: "OBS_BOUNDS_SCALE_INNER",
        boundsAlignment: OBS_ALIGN_CENTER,
        boundsWidth: canvasW,
        boundsHeight: canvasH,
        // Reset any crop a previous version / stray edit left on the item:
        // a stale crop would survive the bounds fit and re-crop the frame.
        cropLeft: 0,
        cropRight: 0,
        cropTop: 0,
        cropBottom: 0,
      },
    });
  }

  /**
   * 真机症状(2026-09-05):录像完全没有声音。
   *
   * 音频有两条独立的失效链,这个函数只管第二条:
   *   (1) profile 侧压根没有录制音频编码器 —— 见 obsConfigWriter 的
   *       `RecAudioEncoder`,那是配置层的修法;
   *   (2) 场景集合 JSON 里的全局音频通道(DesktopAudioDevice1 / AuxAudioDevice1)
   *       没被 OBS 真的装上。视频那条链是运行时 `CreateInput` 建的,已被真机
   *       证明可用;音频那条链全靠"OBS 会正确加载我们手写的 JSON 顶层键"这个
   *       从未在真机上验证过的假设。
   *
   * 所以这里不再假设,而是**问一遍再修**:`GetSpecialInputs` 直接回答通道
   * 1/3 上到底有没有源。有 → 什么都不做(绝不能重复建,否则同一设备被采两次,
   * 音量翻倍带回声)。没有 → 用与游戏画面完全相同的机制(`CreateInput` 建进
   * 场景)补一个,设备 id 用 assembly 交下来的那一个。
   *
   * 场景项必须是**可见的**:libobs 只混活跃树里的源,隐藏的场景项不持有
   * active 引用因而是静音的(见 `enumerateAudioDevices` 里对同一事实的引用)。
   * 所以这里刻意不传 `sceneItemEnabled: false`。
   */
  async function ensureAudioWired(): Promise<void> {
    // undefined = 调用方没提供设备口径(老调用方/测试),没有可信的修复值,
    // 保持旧行为不动。null 是有意义的取值("这一路不录"),不触发修复。
    if (deps.desktopAudioDeviceId === undefined) return;
    const special = await callWithTimeout("GetSpecialInputs");
    if (special === null) return; // 问不到就别猜,更别重复建
    await ensureAudioChannel(
      special["desktop1"],
      deps.desktopAudioDeviceId,
      DESKTOP_AUDIO_FALLBACK_INPUT_NAME,
      DESKTOP_AUDIO_INPUT_KIND,
    );
    await ensureAudioChannel(
      special["mic1"],
      deps.micDeviceId ?? null,
      MIC_AUDIO_FALLBACK_INPUT_NAME,
      MIC_AUDIO_INPUT_KIND,
    );
  }

  /** One channel's worth of ensureAudioWired(). `channelSource` is what
   * GetSpecialInputs reported for that channel (an input name, or null/absent
   * when the channel is unassigned). */
  async function ensureAudioChannel(
    channelSource: unknown,
    wantDeviceId: string | null,
    fallbackInputName: string,
    inputKind: string,
  ): Promise<void> {
    if (wantDeviceId === null) return; // 用户就是不想录这一路
    if (typeof channelSource === "string" && channelSource !== "") return;
    // 通道空着但用户要录 —— 场景集合那条路没生效,补建。已存在(上一次
    // 会话建过、进程比 websocket 会话活得长)时 CreateInput 会以
    // "already exists" 失败,那正是我们想要的状态,静默即可。
    await callQuiet("CreateInput", {
      sceneName: SCENE_NAME,
      inputName: fallbackInputName,
      inputKind,
      inputSettings: { device_id: wantDeviceId },
    });
    // 已存在时上面那次 create 不会更新设备,补一次 set;新建时是幂等重写。
    await callQuiet("SetInputSettings", {
      inputName: fallbackInputName,
      inputSettings: { device_id: wantDeviceId },
    });
  }

  async function captureProbe(): Promise<{ shotPath: string; black: boolean }> {
    if (!client || !connected) {
      lastError = "captureProbe: 未连接";
      sourceActive = false;
      return { shotPath: "", black: true };
    }
    const shotPath = join(tmpdir(), `gladlog-obs-probe-${nowFn()}.bmp`);
    const result = await callWithTimeout("SaveSourceScreenshot", {
      sourceName: GAME_CAPTURE_INPUT_NAME,
      imageFormat: "bmp",
      imageFilePath: shotPath,
    });
    if (result === null) {
      sourceActive = false;
      return { shotPath, black: true };
    }
    let judgment: BlackFrameJudgment;
    try {
      const luminances = decodeBmpLuminance(readFileSync(shotPath));
      judgment = judgeBlackFrame(luminances);
    } catch (err) {
      lastError = `captureProbe: 读取/解码截图失败: ${errMessage(err)}`;
      sourceActive = false;
      return { shotPath, black: true };
    }
    sourceActive = !judgment.black;
    return { shotPath, black: judgment.black };
  }

  /**
   * Device enumeration goes through obs-websocket's
   * GetInputPropertiesListPropertyItems, which needs an EXISTING input of the
   * right kind to ask about — so for each kind a throwaway probe input is
   * created in the gladlog scene, queried, and removed. The probe is created
   * with `sceneItemEnabled: false`: libobs only mixes audio from sources in
   * the ACTIVE tree, and a hidden scene item holds no active reference on
   * its source (obs-scene.c: `scene_enum_sources(active=true)` skips items
   * whose `active_refs` is 0; `obs_sceneitem_set_visible(false)` drops that
   * ref), so a hidden probe is silent. Belt-and-braces on top of that, the
   * whole enumeration is refused while `continuousActive` — see below.
   *
   * Every call goes through `callQuiet`, not `callWithTimeout`: "could not
   * list devices" is a settings-page fact, not a recording fault, and must
   * neither show up on the recorder status row nor mask a real failure.
   */
  async function listAudioDevices(): Promise<{
    output: ObsAudioDevice[];
    input: ObsAudioDevice[];
  }> {
    const empty = { output: [], input: [] };
    // Never while a recording is running (agy review #1): even a hidden
    // probe input has to initialise the capture device, and the recording
    // must not carry a trace of a microphone the user set to "不录". The
    // settings page then offers 系统默认 / 不录 / the saved id only; prefs
    // changed during a recording are applied after it ends anyway.
    if (continuousActive) return empty;
    const ok = await ensureConnected();
    if (!ok) return empty;
    const output = await enumerateAudioDevices(DESKTOP_AUDIO_INPUT_KIND);
    const input = await enumerateAudioDevices(MIC_AUDIO_INPUT_KIND);
    return { output, input };
  }

  /** callWithTimeout minus the lastError write: device enumeration is a
   * settings-page fact, not a recording fault, and a snapshot/restore of
   * lastError around it would clobber a genuine failure (websocket drop,
   * split timeout) that lands mid-enumeration (agy review #4). */
  async function callQuiet(
    req: string,
    data?: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    if (!client) return null;
    try {
      return await withTimeout(client.call(req, data), CALL_TIMEOUT_MS, req);
    } catch {
      return null;
    }
  }

  async function enumerateAudioDevices(
    inputKind: string,
  ): Promise<ObsAudioDevice[]> {
    const inputName = `${AUDIO_PROBE_INPUT_PREFIX}${inputKind}`;
    // A leftover probe from an earlier interrupted enumeration makes
    // CreateInput fail with "already exists"; the query below works either
    // way, so the create result is deliberately not gated on.
    await callQuiet("CreateInput", {
      sceneName: SCENE_NAME,
      inputName,
      inputKind,
      inputSettings: {},
      sceneItemEnabled: false,
    });
    try {
      const r = await callQuiet("GetInputPropertiesListPropertyItems", {
        inputName,
        propertyName: "device_id",
      });
      const items = Array.isArray(r?.["propertyItems"])
        ? (r["propertyItems"] as Array<Record<string, unknown>>)
        : [];
      const out: ObsAudioDevice[] = [];
      for (const it of items) {
        if (it["itemEnabled"] === false) continue;
        const id = it["itemValue"];
        const name = it["itemName"];
        if (typeof id !== "string" || id === "") continue;
        out.push({ id, name: typeof name === "string" && name ? name : id });
      }
      return out;
    } finally {
      await callQuiet("RemoveInput", { inputName });
    }
  }

  return {
    startContinuous,
    stopContinuous,
    splitChunk,
    onChunkOpened,
    markChapter,
    probe,
    shutdown,
    configureSession,
    captureProbe,
    listAudioDevices,
  };
}
