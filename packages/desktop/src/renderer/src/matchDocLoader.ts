import type { LazyDocPayload } from "../../shared/parseLazyDoc";
import { parseLazyPayload, parseRoundBytes } from "../../shared/parseLazyDoc";
import { bridge } from "./bridge";
import {
  currentOpen,
  openIoArrived,
  openTimed,
  type OpenTraceToken,
} from "./openTrace";

/**
 * Open a stored match / one lazily loaded shuffle round (T93).
 *
 * The bytes are parsed HERE, in the page. Parsed in preload, the doc is
 * deep-copied value by value when it crosses the context bridge - 0.2-1.0 s of
 * main-thread time on 15-68 MB matches, more than the JSON.parse - and both
 * copies are alive for that long; a byte array crosses as one block. Bridge
 * stubs (fixture mode, tests) provide only get / getLazy and keep working.
 */
type Matches = {
  get(id: string): Promise<unknown | null>;
  getLazy?(id: string): Promise<unknown | null>;
  getLazyRaw?(id: string): Promise<LazyDocPayload | null>;
  getRound?(id: string, i: number): Promise<unknown | null>;
  getRoundRaw?(id: string, i: number): Promise<Uint8Array | null>;
};

export async function openMatchDoc(id: string): Promise<unknown | null> {
  const m = bridge().matches as Matches;
  if (m.getLazyRaw) {
    // the trace this request belongs to: its answer writes there or nowhere
    const trace = currentOpen();
    const payload = await m.getLazyRaw(id);
    openIoArrived(trace);
    if (!payload) return null;
    const doc = openTimed(
      "parse",
      () => parseLazyPayload(payload),
      false,
      trace,
    );
    return doc ?? m.get(id);
  }
  return m.getLazy ? m.getLazy(id) : m.get(id);
}

/** Whether a lazily omitted round can be asked for at all. */
export function canOpenRound(): boolean {
  const m = bridge().matches as Matches;
  return !!(m.getRoundRaw ?? m.getRound);
}

export async function openMatchRound(
  id: string,
  roundIndex: number,
  /** the trace this request's steps belong to when they end (`openOnce`);
   * by default the open in flight when it was asked */
  traceOf?: () => OpenTraceToken,
): Promise<unknown | null> {
  const m = bridge().matches as Matches;
  if (m.getRoundRaw) {
    const asked = currentOpen();
    const trace = traceOf ?? (() => asked);
    const buf = await m.getRoundRaw(id, roundIndex);
    openIoArrived(trace);
    return openTimed("parse", () => parseRoundBytes(buf), false, trace);
  }
  return m.getRound ? m.getRound(id, roundIndex) : null;
}

/** The whole doc, for the stale-sidecar fallback of a round open. */
export function openWholeDoc(id: string): Promise<unknown | null> {
  return (bridge().matches as Matches).get(id);
}

/**
 * The whole doc taking the place of a lazily opened one (the stale-sidecar
 * fallback): every round of it is a newly parsed object, and a round already
 * loaded keeps the object it had — the report on screen is keyed by it, and
 * so are the derive caches and the open trace (codex 85-tk-G-T93-1c #2: a
 * late fallback for round 1 tore down the report of round 2 mid-fill).
 */
export function keepLoadedRounds<T>(prev: unknown, full: T): T {
  const had = (prev as { data?: { rounds?: unknown } } | null)?.data?.rounds;
  const data = (full as { data?: { rounds?: unknown } } | null)?.data;
  if (!Array.isArray(had) || !data || !Array.isArray(data.rounds)) return full;
  return {
    ...full,
    data: { ...data, rounds: data.rounds.map((r, i) => had[i] ?? r) },
  };
}
