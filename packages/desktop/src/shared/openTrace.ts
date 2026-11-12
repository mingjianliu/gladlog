/**
 * Stage timings of one "open a match" (T93): where the time between the click
 * on a list row and the settled report goes. The renderer collects the record
 * (renderer/src/openTrace.ts), preload adds the IPC round trip and the JSON
 * parse, main adds the disk read and writes one `[open] {...}` line to
 * main.log, so a user's log shows the same split a local probe measures.
 * Ids and sizes only, never names.
 */
export interface OpenTraceIo {
  /** preload: ipcRenderer.invoke start → payload received (disk + IPC copy). */
  invokeMs: number;
  /** preload: bytes → text → JSON.parse → slim fallback. */
  parseMs: number;
  /** preload: performance.now() when the parsed doc was handed to the page. */
  handedAt: number;
}

export interface OpenTraceRecord {
  id: string;
  what: "match" | "round";
  /** Milliseconds after the click, in the order the stages happened. */
  at: Record<string, number>;
  /** Durations, ms. `derive:*` are the whole-match derives of the report. */
  dur: Record<string, number>;
  /** Main-thread tasks over 50 ms seen during the open: count, sum, longest. */
  longTasks: { n: number; sumMs: number; maxMs: number };
  io?: OpenTraceIo | null;
}

/** What main measured for the last read of an id. */
export interface OpenTraceRead {
  readMs: number;
  bytes: number;
  mode: "full" | "perRound" | "round" | "miss";
}

export const OPEN_TRACE_CHANNEL = "gladlog:debug:openTrace";

/** One log line; kept in shared so a test can pin its shape. */
export function formatOpenTrace(
  rec: OpenTraceRecord,
  read: OpenTraceRead | null,
): string {
  const r = (n: number) => Math.round(n);
  const round = (o: Record<string, number>) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r(v)]));
  return `[open] ${JSON.stringify({
    id: rec.id,
    what: rec.what,
    read: read
      ? { ms: r(read.readMs), bytes: read.bytes, mode: read.mode }
      : null,
    io: rec.io
      ? { invokeMs: r(rec.io.invokeMs), parseMs: r(rec.io.parseMs) }
      : null,
    at: round(rec.at),
    dur: round(rec.dur),
    longTasks: {
      n: rec.longTasks.n,
      sumMs: r(rec.longTasks.sumMs),
      maxMs: r(rec.longTasks.maxMs),
    },
  })}`;
}
