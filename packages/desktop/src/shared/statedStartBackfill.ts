/**
 * Backfill of `statedStartTime` on a stored document parsed before the parser
 * kept it (2026-11-11, pipeline T90).
 *
 * `statedStartTime` is the instant the match's opening line states for itself
 * (its wall clock by the UTC offset written on the line); analysis asks dated
 * game rules with it and, for a document without it, falls back to a 14 h
 * uncertainty band around every cutover (`utils/logEra.ts`). The stored
 * document has no log line left to read it from — raw.txt, kept beside it,
 * does: its first line is the opening line (the lobby's first round's, for a
 * shuffle).
 *
 * One offset per file (T90's measurement: 0 of 1,333 archives change shape or
 * offset between their first and last line), so every round of a shuffle
 * states `stated(first line) + (its parsed start − the first round's parsed
 * start)`: the two parsed starts were read by one machine in one zone when
 * the document was stored, so their difference does not depend on the
 * machine reading the document now.
 */
type Dated = { startTime?: unknown; statedStartTime?: number | null };

/**
 * Write `statedStartTime` onto the match, or every round of the shuffle, in
 * `doc.data` that has none (`undefined`; a stored `null` — the line stated no
 * offset — is kept). `firstLineStated` is `logLineInstantMs` of raw.txt's
 * first line: a number, or null when that line states no offset. Returns
 * whether anything was written.
 */
export function backfillStatedStart(
  doc: unknown,
  firstLineStated: number | null,
): boolean {
  const data = (doc as { data?: unknown } | null)?.data;
  if (data == null || typeof data !== "object") return false;
  const rounds = (data as { rounds?: unknown }).rounds;
  const items: Dated[] = Array.isArray(rounds)
    ? rounds.filter((r): r is Dated => r != null && typeof r === "object")
    : [data as Dated];
  // the opening line is the earliest start's
  const starts = items
    .map((x) => x.startTime)
    .filter((t): t is number => typeof t === "number" && Number.isFinite(t));
  if (starts.length !== items.length || items.length === 0) return false;
  const first = Math.min(...starts);
  let changed = false;
  for (const x of items) {
    if (x.statedStartTime !== undefined) continue;
    x.statedStartTime =
      firstLineStated === null
        ? null
        : firstLineStated + ((x.startTime as number) - first);
    changed = true;
  }
  return changed;
}
