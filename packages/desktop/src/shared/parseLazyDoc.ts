import { docBytesToText, parseDocBytes } from "./parseDocBytes";
import { slimStoredDoc, slimStoredRound } from "./slimDoc";

/** What main's matches:getLazy answers with (MatchStore.getLazy), as it
 * arrives on the consumer side. */
export type LazyDocPayload =
  | { mode: "full"; bytes: Uint8Array }
  | {
      mode: "perRound";
      shell: Uint8Array;
      round0: Uint8Array;
      roundCount: number;
    };

/** Parse a getLazy payload. Null when the per-round compose fails: the
 * caller then re-opens through the whole-doc path (fail-open). */
export function parseLazyPayload(payload: LazyDocPayload): unknown | null {
  return payload.mode === "perRound"
    ? composeLazyDoc(payload.shell, payload.round0, payload.roundCount)
    : parseDocBytes(payload.bytes);
}

/**
 * Consumer-side composition for the lazy per-round doc path (perf-1): main
 * sends shell bytes (the doc with every rounds element replaced by `null`)
 * plus round 0's bytes, and the parse of both happens here in preload — the
 * same single-materialization contract as parseDocBytes. Unloaded rounds stay
 * `null` in data.rounds; the renderer requests them via matches.getRound and
 * splices parseRoundBytes' result in.
 *
 * Returns null on any parse failure — the preload caller falls back to the
 * whole-doc path (fail-open, same corrupt-file semantics as parseDocBytes).
 */
export function composeLazyDoc(
  shell: unknown,
  round0: unknown,
  roundCount: number,
): unknown | null {
  if (shell == null || round0 == null || roundCount < 1) return null;
  try {
    const doc = JSON.parse(docBytesToText(shell)) as {
      data?: { rounds?: unknown[] };
    };
    const rounds = doc?.data?.rounds;
    if (!Array.isArray(rounds) || rounds.length !== roundCount) return null;
    const r0: unknown = JSON.parse(docBytesToText(round0));
    if (r0 == null || typeof r0 !== "object") return null;
    rounds[0] = r0;
    // The shared slim fallback (foreign fat docs), same as parseDocBytes; null
    // placeholder rounds are skipped and slimmed at their own load time.
    try {
      slimStoredDoc(doc);
    } catch {
      /* a failed fallback must not block loading */
    }
    return doc;
  } catch {
    return null;
  }
}

/** Parse + slim one lazily-loaded round (matches what the whole-doc path would
 * have produced for this round). Null on failure — the renderer keeps the
 * placeholder and the round simply stays unloadable. */
export function parseRoundBytes(buf: unknown): unknown | null {
  if (buf == null) return null;
  try {
    const round: unknown = JSON.parse(docBytesToText(buf));
    if (round == null || typeof round !== "object") return null;
    try {
      slimStoredRound(round);
    } catch {
      /* keep the parsed round */
    }
    return round;
  } catch {
    return null;
  }
}
