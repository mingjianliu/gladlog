import type { LazyDocPayload } from "../../shared/parseLazyDoc";
import { parseLazyPayload, parseRoundBytes } from "../../shared/parseLazyDoc";
import { bridge } from "./bridge";
import { openIoArrived, openTimed } from "./openTrace";

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
    const payload = await m.getLazyRaw(id);
    openIoArrived();
    if (!payload) return null;
    const doc = openTimed("parse", () => parseLazyPayload(payload), false);
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
): Promise<unknown | null> {
  const m = bridge().matches as Matches;
  if (m.getRoundRaw) {
    const buf = await m.getRoundRaw(id, roundIndex);
    openIoArrived();
    return openTimed("parse", () => parseRoundBytes(buf), false);
  }
  return m.getRound ? m.getRound(id, roundIndex) : null;
}

/** The whole doc, for the stale-sidecar fallback of a round open. */
export function openWholeDoc(id: string): Promise<unknown | null> {
  return (bridge().matches as Matches).get(id);
}
