import type { OpenTraceIo, OpenTraceRecord } from "../../shared/openTrace";
import { bridge } from "./bridge";

/**
 * Collector for the open-a-match stage timings (T93, see shared/openTrace.ts).
 * One open at a time: a new click replaces the trace in flight. Every entry
 * point is a no-op without an active trace, so a report rendered outside the
 * app shell (tests, export page, dev harness) pays nothing.
 */
interface Active extends OpenTraceRecord {
  t0: number;
  observer: PerformanceObserver | null;
}
let active: Active | null = null;
const KEEP = 20;
const done: OpenTraceRecord[] = [];

const now = (): number => performance.now();

export function beginOpen(id: string, what: "match" | "round"): void {
  active?.observer?.disconnect();
  const t: Active = {
    id,
    what,
    t0: now(),
    at: {},
    dur: {},
    longTasks: { n: 0, sumMs: 0, maxMs: 0 },
    observer: null,
  };
  try {
    t.observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        t.longTasks.n++;
        t.longTasks.sumMs += e.duration;
        t.longTasks.maxMs = Math.max(t.longTasks.maxMs, e.duration);
      }
    });
    t.observer.observe({ entryTypes: ["longtask"] });
  } catch {
    /* no longtask support (jsdom): the record simply has none */
  }
  active = t;
}

/** A point in time, ms after the click. The first reading of a name wins. */
export function openAt(name: string): void {
  if (active && !(name in active.at)) active.at[name] = now() - active.t0;
}

/** True once the doc this open asked for is in the page: report-side marks
 * before that belong to the report being left. */
function docIn(): boolean {
  return active != null && "docArrived" in active.at;
}

/** openAt for the report's own stages. */
export function openReportAt(name: string): void {
  if (docIn()) openAt(name);
}

/** Run `fn`, adding its duration to `name`. Report-side stages (the default)
 * count only once the doc of this open is in. */
export function openTimed<T>(name: string, fn: () => T, reportSide = true): T {
  if (reportSide ? !docIn() : !active) return fn();
  const t = active!;
  const s = now();
  try {
    return fn();
  } finally {
    t.dur[name] = (t.dur[name] ?? 0) + (now() - s);
  }
}

export function openTraceActive(): boolean {
  return active != null;
}

/** The answer of the open's IPC call is in the page (bytes, or a parsed doc
 * on the old path): record preload's timings and the bridge crossing. */
export function openIoArrived(): void {
  if (!active || active.io !== undefined) return;
  let io: OpenTraceIo | null = null;
  try {
    io =
      (
        bridge().debug as { lastOpenIo?: () => OpenTraceIo | null }
      ).lastOpenIo?.() ?? null;
  } catch {
    /* stub without the surface */
  }
  active.io = io;
  if (io) active.dur["bridgeCopy"] = now() - io.handedAt;
}

/** The parsed doc is about to be handed to React. */
export function openDocArrived(): void {
  openIoArrived();
  openAt("docArrived");
}

/** The report is complete: stamp `name`, then wait for two frames and a quiet
 * task so the paint is inside, and send the record to main's log. */
export function endOpen(name = "settled"): void {
  const t = active;
  if (!t || !docIn() || name in t.at) return;
  openAt(name);
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (active !== t) return;
      t.at[`${name}Painted`] = now() - t.t0;
      setTimeout(() => {
        if (active !== t) return;
        active = null;
        t.observer?.disconnect();
        const rec: OpenTraceRecord = {
          id: t.id,
          what: t.what,
          at: t.at,
          dur: t.dur,
          longTasks: t.longTasks,
          io: t.io ?? null,
        };
        done.push(rec);
        while (done.length > KEEP) done.shift();
        (
          window as unknown as { __gladlogOpenTraces?: unknown }
        ).__gladlogOpenTraces = done;
        try {
          void (
            bridge().debug as {
              openTrace?: (r: OpenTraceRecord) => Promise<void>;
            }
          )
            .openTrace?.(rec)
            ?.catch(() => {});
        } catch {
          /* stub without the surface */
        }
      }, 120);
    }),
  );
}

/** Stamp a paint: `name` at the second frame after the call. */
export function openPaintAt(name: string, reportSide = false): void {
  const t = active;
  if (!t || name in t.at || (reportSide && !docIn())) return;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (active === t && !(name in t.at)) t.at[name] = now() - t.t0;
    }),
  );
}
