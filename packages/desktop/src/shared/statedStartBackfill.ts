import { logLineInstantMs, splitLine } from "@gladlog/parser";

/**
 * Backfill of `statedStartTime` on a stored document parsed before the parser
 * kept it (2026-11-11, pipeline T90).
 *
 * `statedStartTime` is the instant a match's opening line states for itself
 * (its wall clock by the UTC offset written on the line); analysis asks dated
 * game rules with it and, for a document without it, falls back to a 14 h
 * uncertainty band around every cutover (`utils/logEra.ts`). The stored
 * document has no log line left to read it from — raw.txt, kept beside it,
 * does: it is the concatenation of the stored rounds' own lines, so it holds
 * one opening line per stored match / round, in order.
 *
 * Each round is read from ITS line with the parser's own reader
 * (`logLineInstantMs`) — the same predicate as a fresh parse, nothing
 * extrapolated: an offset that changes inside the file (a DST switch between
 * two rounds) is read as written (codex 85-tk-ENG-T200-1 #1; the first cut
 * added parsed-start differences to the first line's instant).
 */
const OPENING = "  ARENA_MATCH_START,";

/** What every opening line of a raw.txt states, in file order: a number, or
 * null for a line that states no offset. */
export function openingInstantsOf(rawText: string): Array<number | null> {
  const out: Array<number | null> = [];
  for (
    let at = rawText.indexOf(OPENING);
    at !== -1;
    at = rawText.indexOf(OPENING, at + OPENING.length)
  ) {
    const start = rawText.lastIndexOf("\n", at) + 1;
    let end = rawText.indexOf("\n", at);
    if (end === -1) end = rawText.length;
    const parts = splitLine(rawText.slice(start, end).replace(/\r$/, ""));
    if (parts?.eventName === "ARENA_MATCH_START")
      out.push(logLineInstantMs(parts.datePart));
  }
  return out;
}

type Dated = {
  sequenceNumber?: unknown;
  statedStartTime?: number | null;
};

/**
 * Write `statedStartTime` onto the match, or every round of the shuffle, in
 * `doc.data` that has none (`undefined`; a stored value, null included, is
 * kept). `openings` = `openingInstantsOf(raw.txt)`. The k-th opening line is
 * the round with `sequenceNumber` k — the order the parser cut the rounds in
 * and wrote their lines in. Not the order of their parsed starts: a clock
 * set back between two rounds (the autumn DST hour) reverses those (codex
 * 85-tk-ENG-T200-1b). Nothing is written unless there is exactly one opening
 * line per stored round and the rounds are numbered 0..n-1.
 *
 * `complete` = every match / round carries the field now (whether or not
 * this call wrote it) — what the store's `statedInstant` mark means.
 */
export function backfillStatedStart(
  doc: unknown,
  openings: ReadonlyArray<number | null> | null,
): { changed: boolean; complete: boolean } {
  const data = (doc as { data?: unknown } | null)?.data;
  if (data == null || typeof data !== "object")
    return { changed: false, complete: false };
  const rounds = (data as { rounds?: unknown }).rounds;
  const isShuffle = Array.isArray(rounds);
  const items: Dated[] = isShuffle
    ? rounds.filter((r): r is Dated => r != null && typeof r === "object")
    : [data as Dated];
  const carried = () =>
    items.length > 0 && items.every((x) => x.statedStartTime !== undefined);
  // which opening line is whose
  const lineOf = (x: Dated): number =>
    isShuffle ? (x.sequenceNumber as number) : 0;
  const numbered =
    !isShuffle ||
    (items.length === (rounds as unknown[]).length &&
      new Set(items.map((x) => x.sequenceNumber)).size === items.length &&
      items.every(
        (x) =>
          Number.isInteger(x.sequenceNumber) &&
          (x.sequenceNumber as number) >= 0 &&
          (x.sequenceNumber as number) < items.length,
      ));
  if (!openings || !numbered || openings.length !== items.length)
    return { changed: false, complete: carried() };
  let changed = false;
  for (const x of items) {
    if (x.statedStartTime !== undefined) continue;
    x.statedStartTime = openings[lineOf(x)]!;
    changed = true;
  }
  return { changed, complete: carried() };
}
