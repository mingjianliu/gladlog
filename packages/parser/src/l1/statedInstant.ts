/**
 * The instant a log line states for itself.
 *
 * The date part of a retail combat-log line is the recording client's wall
 * clock followed, with no separator, by that client's UTC offset in hours:
 *
 *   `8/18/2026 18:56:32.167-4`   US Eastern  — milliseconds `.167`, offset −4
 *   `8/18/2026 18:56:32.16710`   Australia   — milliseconds `.167`, offset +10
 *   `8/18/2026 18:56:32.1672`    Central Europe — `.167` and +2
 *
 * An offset WEST of UTC carries its minus sign; an offset EAST of UTC is
 * written with no sign at all, so its digits run straight on from the
 * milliseconds. Measured 2026-10-11 on the 12.1 archive (text scans, no
 * parser):
 *
 * - every line of 605 files (20,896,781 lines): the tail after the seconds'
 *   dot is `ddd-d` (379 files), `ddd-dd` (1), `dddd` (201) or `ddddd` (24) —
 *   never a bare `ddd`, never a `+`, never a second dot. One shape and one
 *   offset per file, start to end.
 * - the millisecond field is exactly three digits: before a minus sign it is
 *   three digits on all 12,825,745 signed lines, and in the unsigned files
 *   whatever follows the third digit is the same on every line of the file
 *   (a fourth fraction digit would vary).
 * - the first 200 lines of all 18,134 files: 11,052 files signed (−10, −8 …
 *   −3), 7,082 unsigned (1, 2, 3, 4, 5, 8, 9, 10, 12); none without an
 *   offset, none with offset 0.
 * - against what the uploading client reported for each file: the suffix,
 *   an unsigned one read as `+N`, is the gap between the line's wall clock
 *   and the client's UTC start of the match in 18,134 of 18,134 files, and
 *   the offset of the client's IANA zone in 17,970 of them (the client's
 *   start may itself be read off this suffix; its zone is not).
 * - the other 164 are a half-hour zone, which is written as a WHOLE hour:
 *   every Australia/Adelaide file (UTC+9:30) says `9`. So the stated instant
 *   of such a line is half an hour late, where the recording machine's own
 *   zone reads it exactly. No India, Nepal or Newfoundland file exists to
 *   show a :30 west of UTC or a :45.
 *
 * `parseTimestamp` does not read the unsigned form: it takes those digits for
 * more fraction and reads the wall clock in the zone it was given (by
 * default the parsing machine's). That reading is left exactly as it is —
 * every stored document's timestamps, and the join of a match to a recording
 * by the machine's own clock, were made with it, and on the recording
 * machine it is the same instant (to the minute even in a half-hour zone,
 * where this one is not). This function is the other reading, for the one
 * question the machine's zone must not answer: WHEN, on the calendar, a log
 * was played (analysis `utils/logEra.ts`).
 */
import { parseTimestamp } from "./timestamp";

/** `ddd` milliseconds, then an unsigned whole-hour offset of one or two
 * digits. */
const UNSIGNED_TAIL_RE = /^(\d{3})(\d{1,2})$/;
/** The largest UTC offset any zone has (Line Islands, +14). */
const MAX_EAST_OFFSET_H = 14;

/**
 * Epoch ms of a line's date part by the UTC offset the line itself states —
 * signed (west), or unsigned (east) — independent of the machine doing the
 * parsing. `null` when the line states no offset (three fraction digits or
 * fewer and nothing after), when what follows the milliseconds is not an
 * offset (three or more digits, or more than +14), or when the date part is
 * malformed.
 *
 * A signed line is `parseTimestamp`'s own reading (that branch never asks for
 * a zone), so for those the two functions cannot disagree; an unsigned line is
 * handed to the same branch with its sign written in.
 */
export function logLineInstantMs(datePart: string): number | null {
  const dot = datePart.indexOf(".", datePart.lastIndexOf(":") + 1);
  if (dot === -1) return null;
  const tail = datePart.slice(dot + 1);
  if (tail.includes("-") || tail.includes("+")) return parseTimestamp(datePart);
  const m = UNSIGNED_TAIL_RE.exec(tail);
  if (!m || Number(m[2]) > MAX_EAST_OFFSET_H) return null;
  return parseTimestamp(`${datePart.slice(0, dot + 1)}${m[1]}+${m[2]}`);
}
