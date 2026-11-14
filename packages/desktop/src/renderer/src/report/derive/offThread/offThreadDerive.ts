import type { RawStreams } from "@gladlog/analysis";

import type { LazyDocPayload } from "../../../../../shared/parseLazyDoc";
import { analysisInputKey, type AnalysisRunInput } from "../analysisInput";
import { idMemoGet, idMemoPut } from "../idMemo";
import type { Mistake } from "../mistakes";
import { getRawStreamsSync } from "../rawStreamsCache";
import {
  sourceMemoHas,
  sourceMemoPut,
  sourceMemoWithPeek,
  sourceMemoWithPut,
} from "../sourceMemo";
import type { ReportSource } from "../types";
import {
  type DeriveWorkerReply,
  type DeriveWorkerRequest,
  type SourcePath,
  WORKER_DOCS_MAX,
} from "./deriveWorkerCore";

/**
 * The two derives that froze the page when a long match opened, computed in
 * a Web Worker instead (derive.worker.ts).
 *
 * Windows field run 2026-11-14 (main 40e2de6e, production bundle, a 778 s
 * 3v3): the report's mistake step was a 2.1 s long task, and the first visit
 * to 「AI 分析」 froze the page for 6.8 s building the prompt input. Neither
 * can be split into steps (each is one analysis pass), so they move off the
 * main thread: the page gets the same values a little later and stays
 * responsive meanwhile.
 *
 * The worker gets the very bytes the page parsed (adoptLazyDoc /
 * adoptRound, called by matchDocLoader.ts right after its parse, the
 * buffers transferred, not copied) and runs the same parse and the same
 * derive bodies (deriveWorkerCore.ts), so a value it answers is the value the
 * page's sync path would compute. Answers are filed where the sync path
 * looks first (sourceMemo for this object, idMemo for this match), so every
 * other reader — the AI tab, the video tab, the export page — hits them.
 *
 * Everything degrades to the old in-place computation: no Worker (tests,
 * jsdom), a source the worker was never given (a doc parsed in preload by a
 * fallback path), or a worker that failed. Then prepare* returns null and
 * the caller computes in place, as before.
 */

/** How long the worker may go without answering anything while requests
 * wait before it is taken for hung: terminated, every waiting caller falls
 * back to computing in place, and the rest of the session derives in place
 * (codex review 2026-11-14 #2: a worker that stops answering without an error
 * event would otherwise hold the report at its mistake step and the AI button
 * disabled for good). Measured from the last answer, not from each request's
 * post — the worker runs one job at a time, so a healthy backlog answers
 * every few seconds however long the queue (re-review #1: a per-request
 * deadline timed out the fifth of five long opens). The slowest single job
 * is a long match's prompt input, ~7 s on the 778 s field match. */
export const WORKER_DEADLINE_MS = 30_000;

type Ref = { token: number; path: SourcePath };
const refs = new WeakMap<object, Ref>();

/** Per adopted doc: its sources, and which of them have both results filed
 * (the doc is dropped from the worker once all have). */
const tokens = new Map<
  number,
  { sources: Set<object>; complete: Set<object> }
>();

let worker: Worker | null | undefined;
let nextToken = 1;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: unknown) => void }
>();
const inflightMistakes = new WeakMap<object, Promise<void>>();
/** Sources whose prompt input was built against their settled raw streams:
 * one built before they arrived is rebuilt once they land, so it does not
 * count towards letting the worker drop the doc. */
const inputSettled = new WeakSet<object>();
const inflightInput = new WeakMap<
  object,
  { inputs: readonly unknown[]; p: Promise<AnalysisRunInput | null> }
>();

let watchdog: ReturnType<typeof setTimeout> | null = null;

/** (Re)start the silence clock from now while anything waits; stop it when
 * nothing does. Called on every request and every answer. */
function armWatchdog(): void {
  if (watchdog !== null) clearTimeout(watchdog);
  watchdog = null;
  if (pending.size === 0 || !worker) return;
  watchdog = setTimeout(() => {
    watchdog = null;
    console.warn(
      `[derive-worker] no answer in ${WORKER_DEADLINE_MS} ms, deriving in place`,
    );
    fail("derive worker timed out");
  }, WORKER_DEADLINE_MS);
}

function settleReply(r: DeriveWorkerReply): void {
  const p = pending.get(r.id);
  if (p) {
    pending.delete(r.id);
    if (r.ok) p.resolve(r.value);
    else p.reject(new Error(r.error));
  }
  armWatchdog();
}

function fail(why: string): void {
  if (watchdog !== null) clearTimeout(watchdog);
  watchdog = null;
  try {
    worker?.terminate();
  } catch {
    /* already gone */
  }
  // null, not undefined: for the rest of the session every derive runs in
  // place, as before the worker existed
  worker = null;
  for (const p of pending.values()) p.reject(new Error(why));
  pending.clear();
  // nothing will be asked of these docs any more: let the page's sources go
  tokens.clear();
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  worker = null;
  if (typeof Worker === "undefined") return null;
  try {
    const w = new Worker(new URL("./derive.worker.ts", import.meta.url), {
      type: "module",
    });
    w.onmessage = (e: MessageEvent<DeriveWorkerReply>) =>
      settleReply(e.data);
    w.onerror = (ev) => {
      ev.preventDefault();
      console.warn(`[derive-worker] failed, deriving in place: ${ev.message}`);
      fail(ev.message || "derive worker error");
    };
    worker = w;
  } catch (e) {
    console.warn(
      `[derive-worker] could not start, deriving in place: ${String(e)}`,
    );
    worker = null;
  }
  return worker;
}

/** Post with the given byte arrays' buffers transferred (they are the
 * page's own copies, unused once parsed); when a buffer cannot be
 * transferred, post a copy instead. */
function postLoad(
  w: Worker,
  msg: DeriveWorkerRequest,
  views: readonly Uint8Array[],
): boolean {
  const buffers = [
    ...new Set(
      views
        .map((v) => v.buffer)
        // by tag, not instanceof: a buffer made in another realm (the
        // preload's, a test's) is still transferable
        .filter(
          (b): b is ArrayBuffer =>
            Object.prototype.toString.call(b) === "[object ArrayBuffer]",
        ),
    ),
  ];
  try {
    w.postMessage(msg, buffers);
    return true;
  } catch {
    try {
      w.postMessage(msg);
      return true;
    } catch {
      return false;
    }
  }
}

function adopt(sources: ReadonlyArray<[object, SourcePath]>, token: number) {
  const info = { sources: new Set<object>(), complete: new Set<object>() };
  for (const [s, path] of sources) {
    refs.set(s, { token, path });
    info.sources.add(s);
  }
  tokens.set(token, info);
  // The worker keeps the newest WORKER_DOCS_MAX docs (deriveWorkerCore.ts);
  // past that the oldest is gone there, so let go of it here too — an open
  // the user left before its report ran (codex review 2026-11-14 #1) would
  // otherwise keep its whole parsed match alive. Its sources then derive in
  // place if they are ever shown.
  while (tokens.size > WORKER_DOCS_MAX) {
    const [oldest, old] = tokens.entries().next().value!;
    for (const s of old.sources) refs.delete(s);
    tokens.delete(oldest);
    // and the worker drops it too, with whatever is still queued for it
    // (re-review #1: posted work for a doc nobody will show kept the queue
    // long)
    try {
      worker?.postMessage({
        op: "drop",
        token: oldest,
      } satisfies DeriveWorkerRequest);
    } catch {
      /* the worker's own bound evicts it anyway */
    }
  }
}

/** A doc openMatchDoc parsed from `payload`: hand the same bytes to the
 * worker. Call it after the page's parse — the buffers are transferred. */
export function adoptLazyDoc(doc: unknown, payload: LazyDocPayload): void {
  const w = getWorker();
  if (!w) return;
  const data = (doc as { data?: unknown } | null)?.data;
  if (data == null || typeof data !== "object") return;
  const rounds = (data as { rounds?: unknown }).rounds;
  const sources: Array<[object, SourcePath]> = [];
  if (Array.isArray(rounds)) {
    rounds.forEach((r, i) => {
      if (r != null && typeof r === "object")
        sources.push([r as object, ["data", "rounds", i]]);
    });
  } else {
    sources.push([data, ["data"]]);
  }
  if (sources.length === 0) return;
  const token = nextToken++;
  const views =
    payload.mode === "full" ? [payload.bytes] : [payload.shell, payload.round0];
  if (!postLoad(w, { op: "load", token, kind: "lazy", payload }, views)) return;
  adopt(sources, token);
}

/** A shuffle round openMatchRound parsed from `bytes`. */
export function adoptRound(round: unknown, bytes: Uint8Array): void {
  const w = getWorker();
  if (!w || round == null || typeof round !== "object") return;
  const token = nextToken++;
  if (!postLoad(w, { op: "load", token, kind: "round", bytes }, [bytes]))
    return;
  adopt([[round as object, []]], token);
}

function call(msg: DeriveWorkerRequest & { id: number }): Promise<unknown> {
  const w = worker;
  if (!w) return Promise.reject(new Error("no derive worker"));
  return new Promise((resolve, reject) => {
    pending.set(msg.id, { resolve, reject });
    try {
      w.postMessage(msg);
    } catch (e) {
      pending.delete(msg.id);
      reject(e);
      return;
    }
    // a request posted while others wait does not restart their clock
    if (watchdog === null) armWatchdog();
  });
}

/** Whether `source`'s derives can run off the main thread. */
export function canDeriveOffThread(source: ReportSource): boolean {
  return !!worker && refs.has(source);
}

function noteComplete(source: ReportSource): void {
  const ref = refs.get(source);
  if (!ref) return;
  const info = tokens.get(ref.token);
  if (!info) return;
  if (!sourceMemoHas(source, "deriveMistakes") || !inputSettled.has(source))
    return;
  info.complete.add(source);
  if (info.complete.size < info.sources.size) return;
  // every source of this doc has both results: the worker can let it go
  tokens.delete(ref.token);
  try {
    worker?.postMessage({
      op: "drop",
      token: ref.token,
    } satisfies DeriveWorkerRequest);
  } catch {
    /* the worker's own bound evicts it anyway */
  }
}

/**
 * Get `source`'s whole-match mistakes into the caches without computing
 * them here. Resolves once deriveMistakes(source) is a cache hit; null when
 * this cannot be done off the main thread (the caller computes in place).
 */
export function prepareMistakes(source: ReportSource): Promise<void> | null {
  if (sourceMemoHas(source, "deriveMistakes")) return Promise.resolve();
  const kept = idMemoGet<Mistake[]>(source, "deriveMistakes", []);
  if (kept !== undefined) {
    sourceMemoPut(source, "deriveMistakes", kept);
    return Promise.resolve();
  }
  const ref = refs.get(source);
  if (!ref || !worker) return null;
  let p = inflightMistakes.get(source);
  if (!p) {
    p = call({
      op: "mistakes",
      id: nextId++,
      token: ref.token,
      path: ref.path,
    }).then((v) => {
      const mistakes = v as Mistake[];
      idMemoPut(source, "deriveMistakes", [], mistakes);
      sourceMemoPut(source, "deriveMistakes", mistakes);
      noteComplete(source);
    });
    inflightMistakes.set(source, p);
    p.catch(() => inflightMistakes.delete(source));
  }
  return p;
}

/** The prompt input buildAnalysisInput(source, matchId) would return right
 * now without computing, or undefined when it is not cached. */
export function peekAnalysisInput(
  source: ReportSource,
  matchId: string,
): AnalysisRunInput | null | undefined {
  const inputs = analysisInputKey(matchId, getRawStreamsSync(source.id));
  const hit = sourceMemoWithPeek<AnalysisRunInput | null>(
    source,
    "buildAnalysisInput",
    inputs,
  );
  if (hit !== undefined) return hit;
  const kept = idMemoGet<AnalysisRunInput | null>(
    source,
    "buildAnalysisInput",
    inputs,
  );
  if (kept !== undefined)
    sourceMemoWithPut(source, "buildAnalysisInput", inputs, kept);
  return kept;
}

/**
 * buildAnalysisInput(source, matchId), built in the worker against the raw
 * streams the page holds now, and filed so the sync call hits. null when
 * this cannot be done off the main thread (the caller computes in place).
 */
export function prepareAnalysisInput(
  source: ReportSource,
  matchId: string,
  /** the raw streams the page holds now are the final ones (MatchReport,
   * after they settled — possibly to none: a match with no raw.txt): an
   * input built now is not rebuilt, so it counts towards dropping the doc */
  rawFinal = false,
): Promise<AnalysisRunInput | null> | null {
  const rawStreams: RawStreams | undefined = getRawStreamsSync(source.id);
  const inputs = analysisInputKey(matchId, rawStreams);
  const settle = rawFinal || rawStreams !== undefined;
  const hit = peekAnalysisInput(source, matchId);
  if (hit !== undefined) {
    if (settle) {
      inputSettled.add(source);
      noteComplete(source);
    }
    return Promise.resolve(hit);
  }
  const ref = refs.get(source);
  if (!ref || !worker) return null;
  const inflight = inflightInput.get(source);
  if (
    inflight &&
    inflight.inputs.length === inputs.length &&
    inflight.inputs.every((v, i) => Object.is(v, inputs[i]))
  ) {
    if (settle)
      inflight.p.then(
        () => {
          inputSettled.add(source);
          noteComplete(source);
        },
        () => {},
      );
    return inflight.p;
  }
  const p = call({
    op: "input",
    id: nextId++,
    token: ref.token,
    path: ref.path,
    matchId,
    rawStreams,
  }).then((v) => {
    const value = v as AnalysisRunInput | null;
    idMemoPut(source, "buildAnalysisInput", inputs, value);
    sourceMemoWithPut(source, "buildAnalysisInput", inputs, value);
    if (settle) inputSettled.add(source);
    noteComplete(source);
    return value;
  });
  inflightInput.set(source, { inputs, p });
  p.catch(() => inflightInput.delete(source));
  return p;
}

/** Test seam: forget the worker (undefined = try again on next use) or pin
 * a stand-in. */
export function setDeriveWorkerForTest(w: Worker | null | undefined): void {
  if (watchdog !== null) clearTimeout(watchdog);
  watchdog = null;
  worker = w;
  if (w) {
    w.onmessage = (e: MessageEvent<DeriveWorkerReply>) =>
      settleReply(e.data);
  }
  pending.clear();
  tokens.clear();
}
