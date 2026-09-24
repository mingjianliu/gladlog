/**
 * Byte-offset scanner for the stored shuffle doc's `data.rounds` array
 * (perf-1, 2026-08-12): locating each round's byte range inside match.json
 * lets the open path parse ONLY the active round (median 49MB / max 277MB
 * whole-doc JSON.parse measured 129ms/733ms on the renderer thread — rounds
 * are ~1/6 of the bytes each).
 *
 * Single source (shared): the sidecar-building worker (main/roundsIdxWorker),
 * MatchStore's positional-read assembly, and the tests all consume these
 * functions. The scanner is a plain byte state machine — it tracks JSON string
 * boundaries (with escapes) and brace/bracket depth, and matches the key
 * `"rounds"` only at depth 2 (the `data` object's keys; only ever invoked for
 * kind==="shuffle" docs, whose shape is {schemaVersion,storedAt,kind,data}).
 * Any structural surprise returns null and callers fall back to the whole-doc
 * path (fail-open).
 */

interface RoundOffsets {
  /** Byte offset one past the rounds array's opening `[`. */
  arrayOpenEnd: number;
  /** Byte offset of the rounds array's closing `]`. */
  arrayClose: number;
  /** Per-round [start, end) byte ranges of each array element. */
  rounds: Array<[number, number]>;
}

const QUOTE = 34; // "
const BACKSLASH = 92; // \
const OPEN_BRACE = 123; // {
const CLOSE_BRACE = 125; // }
const OPEN_BRACKET = 91; // [
const CLOSE_BRACKET = 93; // ]
const COLON = 58; // :
const COMMA = 44; // ,

const isWs = (c: number) =>
  c === 32 || c === 9 || c === 10 || c === 13; /* space \t \n \r */

/** Scan forward past a JSON string; `i` points at the opening quote. Returns
 * the index one past the closing quote, or -1 on EOF. */
function skipString(buf: Uint8Array, i: number): number {
  i++;
  while (i < buf.length) {
    const c = buf[i]!;
    if (c === BACKSLASH) i += 2;
    else if (c === QUOTE) return i + 1;
    else i++;
  }
  return -1;
}

export function scanRoundOffsets(buf: Uint8Array): RoundOffsets | null {
  const n = buf.length;
  let depth = 0;
  let i = 0;
  // Phase 1: find `"rounds"` as a key (followed by `:`) at depth 2.
  let arrayOpenEnd = -1;
  while (i < n) {
    const c = buf[i]!;
    if (c === QUOTE) {
      const start = i;
      i = skipString(buf, i);
      if (i === -1) return null;
      // Candidate key match: "rounds" is 8 bytes with quotes.
      if (depth === 2 && i - start === 8) {
        if (
          buf[start + 1] === 114 && // r
          buf[start + 2] === 111 && // o
          buf[start + 3] === 117 && // u
          buf[start + 4] === 110 && // n
          buf[start + 5] === 100 && // d
          buf[start + 6] === 115 // s
        ) {
          let j = i;
          while (j < n && isWs(buf[j]!)) j++;
          if (buf[j] === COLON) {
            j++;
            while (j < n && isWs(buf[j]!)) j++;
            if (buf[j] !== OPEN_BRACKET) return null; // rounds 不是数组:放弃
            arrayOpenEnd = j + 1;
            i = j + 1;
            break;
          }
        }
      }
    } else {
      if (c === OPEN_BRACE || c === OPEN_BRACKET) depth++;
      else if (c === CLOSE_BRACE || c === CLOSE_BRACKET) depth--;
      i++;
    }
  }
  if (arrayOpenEnd === -1) return null;

  // Phase 2: element ranges. `i` is just past `[`; elements are whole JSON
  // values — track depth back to zero, then a `,` or `]` at element depth
  // closes it.
  const rounds: Array<[number, number]> = [];
  while (i < n) {
    while (i < n && isWs(buf[i]!)) i++;
    if (i >= n) return null;
    if (buf[i] === CLOSE_BRACKET) {
      return { arrayOpenEnd, arrayClose: i, rounds };
    }
    const start = i;
    let elemDepth = 0;
    let end = -1;
    while (i < n) {
      const c = buf[i]!;
      if (c === QUOTE) {
        i = skipString(buf, i);
        if (i === -1) return null;
        continue;
      }
      if (c === OPEN_BRACE || c === OPEN_BRACKET) elemDepth++;
      else if (c === CLOSE_BRACE || c === CLOSE_BRACKET) {
        if (c === CLOSE_BRACKET && elemDepth === 0) {
          // `]` right after an element: element ended at previous byte
          end = i;
          break;
        }
        elemDepth--;
      } else if (c === COMMA && elemDepth === 0) {
        end = i;
        break;
      }
      i++;
    }
    if (end === -1) return null;
    // Trim trailing whitespace off the element range (JSON.stringify emits
    // none, but stay robust).
    let e = end;
    while (e > start && isWs(buf[e - 1]!)) e--;
    rounds.push([start, e]);
    if (buf[i] === COMMA) i++;
    // On `]` the loop re-enters and returns at the CLOSE_BRACKET branch.
  }
  return null;
}

/** The `null,null,…` filler standing in for unloaded rounds in the shell.
 * Single source: MatchStore's positional-read assembly and the worker/test
 * whole-buffer assembly must produce byte-identical shells. */
export function nullFiller(roundCount: number): string {
  if (roundCount === 0) return "";
  return "null" + ",null".repeat(roundCount - 1);
}

/** Whole-buffer shell assembly (worker validation + tests; the production
 * open path assembles the same three pieces from positional reads). */
export function buildShellText(buf: Uint8Array, off: RoundOffsets): string {
  const dec = new TextDecoder();
  return (
    dec.decode(buf.subarray(0, off.arrayOpenEnd)) +
    nullFiller(off.rounds.length) +
    dec.decode(buf.subarray(off.arrayClose))
  );
}
