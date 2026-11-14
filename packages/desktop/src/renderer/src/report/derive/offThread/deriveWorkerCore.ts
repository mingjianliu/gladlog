import { ensureAnalysisData, type RawStreams } from "@gladlog/analysis";

import {
  type LazyDocPayload,
  parseLazyPayload,
  parseRoundBytes,
} from "../../../../../shared/parseLazyDoc";
import { buildAnalysisInputWith } from "../analysisInput";
import { forgetSource } from "../legacySource";
import { deriveMistakesUncached } from "../mistakes";
import type { ReportSource } from "../types";

/** Where a report source sits inside what its bytes parse to: a key path
 * (`["data"]`, `["data", "rounds", 2]`, or `[]` for a lazily loaded round). */
export type SourcePath = ReadonlyArray<string | number>;

export type DeriveWorkerRequest =
  | { op: "load"; token: number; kind: "lazy"; payload: LazyDocPayload }
  | { op: "load"; token: number; kind: "round"; bytes: Uint8Array }
  | { op: "mistakes"; id: number; token: number; path: SourcePath }
  | {
      op: "input";
      id: number;
      token: number;
      path: SourcePath;
      matchId: string;
      rawStreams: RawStreams | undefined;
    }
  | { op: "drop"; token: number };

export type DeriveWorkerReply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string };

/** Parsed docs the worker keeps at once. One open match is one doc (a lazily
 * loaded shuffle round is one more); two = the match on screen and the one
 * just left, the same bound as the page's legacy-copy cache. */
export const WORKER_DOCS_MAX = 2;

/** Resolve on a later event-loop task, so messages already delivered to the
 * worker are taken in before the runner picks its next job. */
const nextTask = (): Promise<void> =>
  new Promise((r) => {
    if (typeof MessageChannel !== "undefined") {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        ch.port1.close();
        r();
      };
      ch.port2.postMessage(0);
    } else setTimeout(r, 0);
  });

/**
 * The derive worker's logic, apart from the Worker plumbing so it can be
 * unit-tested in node (derive.worker.ts wraps it).
 *
 * It parses the SAME bytes the page parsed, with the same functions
 * (parseLazyPayload / parseRoundBytes), picks the same object out by its key
 * path, and runs the same bodies the page's sync path runs
 * (deriveMistakesUncached, buildAnalysisInputWith): what it answers is what
 * the page would have computed, without blocking the page.
 */
export function createDeriveWorkerCore() {
  const docs = new Map<number, unknown>();
  // sources resolved out of each doc, so dropping the doc also drops their
  // legacy copies and memo entries in this worker
  const resolved = new Map<number, Set<ReportSource>>();
  // Two lanes, one runner. A report's mistakes gate its fill (the page waits
  // for them), the prompt input only warms the AI tab, and one input costs
  // seconds on a long match: a mistakes request must not queue behind the
  // input warm-up of the match the user just left. Loads ride the fast lane
  // so a request never overtakes the load it needs. A drop is handled on
  // arrival: the page sends one when it is done with a doc or has let go of
  // it (an open the user left), and the doc's queued requests are answered
  // as failed rather than computed for nobody.
  //
  // The runner yields a task between jobs (`nextTask`): a job is one
  // synchronous computation, and without the yield every message that
  // arrived meanwhile would still be waiting in the event loop, not in a lane,
  // when the next job is picked (codex review 2026-11-14 #2: real message
  // delivery ran an old match's input before the new match's mistakes).
  type Job = {
    msg: DeriveWorkerRequest;
    done: (r: DeriveWorkerReply | null) => void;
  };
  const fast: Job[] = [];
  const slow: Job[] = [];
  let running = false;
  const pump = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      for (;;) {
        await nextTask();
        const job = fast.shift() ?? slow.shift();
        if (!job) return;
        let reply: DeriveWorkerReply | null = null;
        try {
          reply = await run(job.msg);
        } catch {
          reply = null;
        }
        job.done(reply);
      }
    } finally {
      running = false;
    }
  };

  const dropDoc = (token: number): void => {
    for (const s of resolved.get(token) ?? []) forgetSource(s);
    resolved.delete(token);
    docs.delete(token);
  };

  const sourceAt = (token: number, path: SourcePath): ReportSource => {
    const doc = docs.get(token);
    if (doc == null) throw new Error(`no doc for token ${token}`);
    let cur: unknown = doc;
    for (const k of path) {
      cur = (cur as Record<string | number, unknown> | null)?.[k];
    }
    if (cur == null || typeof cur !== "object")
      throw new Error(`nothing at ${path.join(".")} in token ${token}`);
    const src = cur as ReportSource;
    let set = resolved.get(token);
    if (!set) resolved.set(token, (set = new Set()));
    set.add(src);
    return src;
  };

  async function run(
    msg: DeriveWorkerRequest,
  ): Promise<DeriveWorkerReply | null> {
    if (msg.op === "load") {
      const doc =
        msg.kind === "lazy"
          ? parseLazyPayload(msg.payload)
          : parseRoundBytes(msg.bytes);
      if (doc == null) return null;
      docs.set(msg.token, doc);
      while (docs.size > WORKER_DOCS_MAX) dropDoc(docs.keys().next().value!);
      return null;
    }
    if (msg.op === "drop") return null; // handled on arrival (handle)
    try {
      // the prompt's spell names must never degrade (analysis data/ensure.ts)
      await ensureAnalysisData();
      const src = sourceAt(msg.token, msg.path);
      const value =
        msg.op === "mistakes"
          ? deriveMistakesUncached(src)
          : buildAnalysisInputWith(src, msg.matchId, msg.rawStreams);
      return { id: msg.id, ok: true, value };
    } catch (e) {
      return { id: msg.id, ok: false, error: String(e) };
    }
  }

  return {
    /** Messages run one at a time; within a lane in arrival order, the
     * fast lane (load, mistakes) first. */
    handle(msg: DeriveWorkerRequest): Promise<DeriveWorkerReply | null> {
      if (msg.op === "drop") {
        for (const lane of [fast, slow])
          for (let i = lane.length - 1; i >= 0; i--) {
            const j = lane[i]!;
            if (j.msg.op === "load" || j.msg.op === "drop") continue;
            if (j.msg.token !== msg.token) continue;
            lane.splice(i, 1);
            j.done({ id: j.msg.id, ok: false, error: "dropped" });
          }
        // a load of this doc still queued is skipped too
        for (let i = fast.length - 1; i >= 0; i--) {
          const j = fast[i]!;
          if (j.msg.op === "load" && j.msg.token === msg.token) {
            fast.splice(i, 1);
            j.done(null);
          }
        }
        dropDoc(msg.token);
        return Promise.resolve(null);
      }
      return new Promise((done) => {
        const lane = msg.op === "load" || msg.op === "mistakes" ? fast : slow;
        lane.push({ msg, done });
        void pump();
      });
    },
    /** Test seam. */
    docCount: () => docs.size,
  };
}
