import { ensureAnalysisData, type Finding } from "@gladlog/analysis";

import { bridge } from "../bridge";
import {
  buildAnalysisInput,
  buildDeepenPacks,
} from "../report/derive/analysisInput";
import { ensureRawStreams } from "../report/derive/rawStreamsCache";
import type { ReportSource } from "../report/derive/types";

/** One entry in the batch queue (computed from the meta list on the UI side;
 * the driver knows nothing about meta). */
export type BatchItem = { id: string; label: string };

export type BatchStatus = {
  running: boolean;
  total: number;
  /** Matches processed so far (including skipped/failed). */
  done: number;
  ok: number;
  skipped: number;
  failed: number;
  currentLabel: string | null;
  cancelled: boolean;
  /** End time of the most recent batch (drives showing/hiding the completion
   * summary); cleared when a new batch starts. */
  finishedAt: number | null;
};

type CachedResult = {
  findings: Finding[];
  hadNarration: boolean;
  deepened?: boolean;
  /** Language the result was generated in (spec §6.13); absent from older
   * stubs, read as the current language. */
  contentLang?: string;
} | null;

const status: BatchStatus = {
  running: false,
  total: 0,
  done: 0,
  ok: 0,
  skipped: 0,
  failed: 0,
  currentLabel: null,
  cancelled: false,
  finishedAt: null,
};

/** Concurrency (2026-08-01 production feedback "batch is too slow": switched
 * from serial to concurrent). 3 lanes is the compromise between speeding up the
 * local CLI backends (claude -p takes minutes per match) and API backend rate
 * limits / renderer memory (each lane independently holds a doc plus its
 * inflated legacy copy). Safety basis: CLI temp files are already isolated by
 * pid + incrementing sequence number (localAiBackends.ts), and main's
 * run/deepen buckets generations per matchId, so several matches in flight
 * never invalidate each other; shuffle rounds and cross-match units share one
 * queue, so rounds run in parallel too. */
const BATCH_CONCURRENCY = 3;

/** Ids of the analysis units currently in flight (used for targeted cancel);
 * empty when idle. */
const inFlight = new Set<string>();

const subscribers = new Set<() => void>();
const notify = () => {
  // Subscribers are React setState calls: hand out a shallow snapshot, never
  // the mutable singleton
  for (const cb of subscribers) cb();
};

export function getBatchStatus(): BatchStatus {
  return { ...status };
}

export function subscribeBatch(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

export function cancelBatch(): void {
  if (!status.running) return;
  status.cancelled = true;
  // Cancel each in-flight unit individually (main judges staleness by
  // generation, the run invoke resolves in place, and the worker then sees
  // cancelled and exits). NEVER call cancel with no argument — that would abort
  // an analysis the user started manually on another match (agy flash review
  // F1).
  for (const mid of inFlight) {
    try {
      void bridge().analysis.cancel(mid);
    } catch {
      /* the test stub has no such surface */
    }
  }
  notify();
}

/** Dismissing the completion summary must live on the singleton: kept in
 * component state, switching views would remount and pop it up again. */
export function dismissBatchSummary(): void {
  status.finishedAt = null;
  notify();
}

/**
 * Run one source (a whole match, or a single shuffle round) through the full
 * single-match pipeline: getState for cache/running → buildAnalysisInput → run
 * → read the cache for the result → deep dive.
 * The output is identical to clicking "AI analysis" manually (it shares the
 * build predicates in analysisInput.ts, main's same run/deepen service, and the
 * same on-disk cache).
 */
async function processSource(
  source: ReportSource,
  matchId: string,
  skipAnalyzed: boolean,
  /** Intent guard (BACKLOG #26 Task 2): the on-disk storage id (`item.id` —
   * for a shuffle, the lobby directory; for a regular match, identical to
   * `matchId`) raw.txt actually lives under. Awaited (not fire-and-forget)
   * here: the batch driver has nothing better to do while it waits, and an
   * awaited guard is deterministic (no race with the main run) — unlike
   * MatchReport.tsx's UI path, where a user always takes seconds to click
   * "Analyze" after the report opens. */
  storageId: string,
): Promise<"ok" | "skipped" | "failed"> {
  const ai = bridge().analysis;
  const {
    cached: anyLangCached,
    running,
    lang,
  } = (await ai.getState(matchId)) as {
    cached: CachedResult;
    running: boolean;
    lang?: string;
  };
  // getState hands back the other language's result when the current one has
  // no hit (display only, spec §6.13). For the batch it is "not analyzed" --
  // the same per-language judgment as listAnalyzed.
  const inCurrentLang = (r: CachedResult): CachedResult =>
    r && (lang === undefined || (r.contentLang ?? lang) === lang) ? r : null;
  const cached = inCurrentLang(anyLangCached);
  // Running elsewhere (the user clicked it manually): never double-run,
  // whatever the mode — two concurrent runs on one match id would race the
  // same cache file.
  if (running) return "skipped";
  // Already cached: skipped in the default mode; in re-analyze mode
  // (skipAnalyzed=false, the batch bar's 跳过已分析 unchecked) the run
  // proceeds and main overwrites the slot — same semantics as the panel's
  // 重新分析 button.
  if (skipAnalyzed && cached) return "skipped";

  await ensureRawStreams(source, storageId);
  const input = buildAnalysisInput(source, matchId);
  if (!input) return "failed";
  inFlight.add(matchId);
  try {
    // invoke only resolves once the whole round is done (including the disk
    // write and the done emit)
    await ai.run(input);
  } catch {
    return "failed";
  }
  if (status.cancelled) return "failed";
  // A failed run leaves no current-language cache; the other language's
  // result getCached may fall back to must not be counted, or deep-dived.
  const result = inCurrentLang((await ai.getCached(matchId)) as CachedResult);
  // No cache = error path or cancelled; run already emitted the error, this
  // only counts it
  if (!result) return "failed";

  // Deep-dive round: same trigger conditions as the panel (narration present,
  // findings present, not yet deepened)
  if (result.hadNarration && result.findings.length > 0 && !result.deepened) {
    const packs = buildDeepenPacks(
      source,
      result.findings,
      input.candidates,
      input.ownerName,
    );
    try {
      await ai.deepen({
        matchId,
        findings: result.findings,
        packs,
        spec: input.spec,
        ownerName: input.ownerName,
      });
    } catch {
      /* a failed deep dive isn't fatal; keep the first round */
    }
  }
  return "ok";
}

/** Bookkeeping for one batch entry (a whole match, or one shuffle match): with
 * round-level concurrency an entry's units may be spread across several
 * workers, so the entry is only settled when its last unit lands. */
type ItemState = {
  item: BatchItem;
  pendingUnits: number;
  anyOk: boolean;
  anyFailed: boolean;
  settled: boolean;
};

/**
 * Batch analysis: a unit-level concurrency pool (BATCH_CONCURRENCY units in
 * flight at once). An analysis unit = a whole match or a single shuffle round;
 * cross-match units and same-match rounds share one queue, so the rounds of a
 * single shuffle run in parallel too. The output is identical to opening each
 * round manually (it shares processSource's single-match pipeline). A
 * module-level singleton: switching views does not interrupt it, and a repeated
 * start is simply ignored. The progress unit is unchanged:
 * done/ok/skipped/failed are still counted per **match**.
 */
export async function startBatch(
  items: BatchItem[],
  opts?: {
    /** Default true (the behavior before the option existed). False = 重新分析:
     * cached units run again and overwrite; in-flight units are still never
     * doubled. */
    skipAnalyzed?: boolean;
  },
): Promise<void> {
  if (status.running || items.length === 0) return;
  const skipAnalyzed = opts?.skipAnalyzed ?? true;
  status.running = true;
  status.total = items.length;
  status.done = 0;
  status.ok = 0;
  status.skipped = 0;
  status.failed = 0;
  status.cancelled = false;
  status.finishedAt = null;
  status.currentLabel = null;
  notify();

  // Display: the labels of the matches in flight (several rounds of the same
  // match show up only once)
  const activeLabels = new Set<string>();
  const updateLabel = () => {
    status.currentLabel =
      activeLabels.size > 0 ? [...activeLabels].join(" / ") : null;
  };

  const settleItem = (st: ItemState) => {
    if (st.settled) return;
    st.settled = true;
    activeLabels.delete(st.item.label);
    updateLabel();
    if (st.anyFailed) status.failed++;
    else if (st.anyOk) status.ok++;
    else status.skipped++;
    status.done++;
    notify();
  };

  // Pending-unit queue + lazy per-match loading: match.json is tens of MB at
  // the median, so never preload everything; the next match is only loaded once
  // the queue drains, keeping resident memory to "units in flight + the match
  // just loaded".
  type MatchDoc = { kind?: string; data?: unknown };
  const unitQueue: Array<{
    st: ItemState;
    source: ReportSource;
    mid: string;
  }> = [];
  let nextItem = 0;
  const touched: ItemState[] = [];

  const takeUnit = async (): Promise<(typeof unitQueue)[number] | null> => {
    for (;;) {
      const u = unitQueue.shift();
      if (u) return u;
      if (status.cancelled || nextItem >= items.length) return null;
      const item = items[nextItem++];
      let doc: MatchDoc | null = null;
      try {
        doc = (await bridge().matches.get(item.id)) as MatchDoc | null;
      } catch {
        doc = null;
      }
      const st: ItemState = {
        item,
        pendingUnits: 0,
        anyOk: false,
        anyFailed: false,
        settled: false,
      };
      touched.push(st);
      if (!doc?.data) {
        st.anyFailed = true;
        settleItem(st);
        continue;
      }
      // A shuffle's analysis unit is a round (round.id is the cache key); a
      // whole match's unit is itself
      const units: Array<{ source: ReportSource; mid: string }> =
        doc.kind === "shuffle"
          ? (
              (doc.data as { rounds?: Array<ReportSource & { id: string }> })
                .rounds ?? []
            ).map((r) => ({ source: r, mid: r.id }))
          : [{ source: doc.data as ReportSource, mid: item.id }];
      if (units.length === 0) {
        settleItem(st); // no units (empty shuffle) = nothing to do, count skipped
        continue;
      }
      st.pendingUnits = units.length;
      for (const u of units) unitQueue.push({ st, ...u });
    }
  };

  // Load mutex: when several workers drain the queue at once, each match is
  // loaded exactly once and its units are never enqueued twice. A promise chain
  // serializes takeUnit; errors on the chain are swallowed so later callers
  // never inherit an already-rejected chain.
  let loadChain: Promise<unknown> = Promise.resolve();
  const takeUnitLocked = (): Promise<(typeof unitQueue)[number] | null> => {
    const p = loadChain.then(takeUnit, takeUnit);
    loadChain = p.catch(() => null);
    return p;
  };

  const worker = async (): Promise<void> => {
    while (!status.cancelled) {
      const u = await takeUnitLocked();
      if (!u) return;
      activeLabels.add(u.st.item.label);
      updateLabel();
      notify();
      let r: "ok" | "skipped" | "failed";
      try {
        r = await processSource(u.source, u.mid, skipAnalyzed, u.st.item.id);
      } catch {
        // An unexpected reject at the IPC layer only kills this one unit, not
        // the whole batch (agy flash review F3)
        r = "failed";
      } finally {
        inFlight.delete(u.mid);
      }
      if (r === "ok") u.st.anyOk = true;
      else if (r === "failed") u.st.anyFailed = true;
      if (--u.st.pendingUnits === 0) settleItem(u.st);
      else notify();
    }
  };

  try {
    // Spell names in the prompt must never degrade: the tables have to be ready
    // before candidates are built (contract in analysis/data/ensure.ts)
    await ensureAnalysisData();
    await Promise.all(
      Array.from({ length: Math.min(BATCH_CONCURRENCY, items.length) }, () =>
        worker(),
      ),
    );
    // Cancellation cleanup: matches that were worked on (any success/failure
    // recorded) settle as usual under the old accounting; untouched ones are
    // not counted.
    if (status.cancelled) {
      for (const st of touched) {
        if (!st.settled && (st.anyOk || st.anyFailed)) settleItem(st);
      }
    }
  } finally {
    inFlight.clear();
    status.running = false;
    status.currentLabel = null;
    status.finishedAt = Date.now();
    notify();
  }
}
