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

type Dated = { startTime?: unknown; statedStartTime?: number | null };

/**
 * Write `statedStartTime` onto the match, or every round of the shuffle, in
 * `doc.data` that has none (`undefined`; a stored value, null included, is
 * kept). `openings` = `openingInstantsOf(raw.txt)`; the k-th opening line is
 * the k-th earliest round's. Nothing is written unless there is exactly one
 * opening line per stored round and every round has a start to order by.
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
  const items: Dated[] = Array.isArray(rounds)
    ? rounds.filter((r): r is Dated => r != null && typeof r === "object")
    : [data as Dated];
  const carried = () =>
    items.length > 0 && items.every((x) => x.statedStartTime !== undefined);
  const ordered =
    items.every(
      (x) => typeof x.startTime === "number" && Number.isFinite(x.startTime),
    ) && new Set(items.map((x) => x.startTime)).size === items.length;
  if (!openings || !ordered || openings.length !== items.length)
    return { changed: false, complete: carried() };
  const byStart = [...items].sort(
    (a, b) => (a.startTime as number) - (b.startTime as number),
  );
  let changed = false;
  byStart.forEach((x, k) => {
    if (x.statedStartTime !== undefined) return;
    x.statedStartTime = openings[k]!;
    changed = true;
  });
  return { changed, complete: carried() };
}
