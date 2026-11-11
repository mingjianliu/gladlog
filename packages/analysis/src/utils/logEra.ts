/**
 * Rules that depend on WHEN a match was played ask one question, here.
 *
 * A dated game change is an exported epoch constant (`Date.UTC(…)`) next to
 * the rule it gates — 12.1 go-live (`PATCH_121_GOLIVE_EPOCH_MS`,
 * drAnalysis.ts: the DR reset window, the Stellar Protection dispel penalty),
 * Storm Conduit's 2026-08-18 hotfix (`STORM_CONDUIT_HOTFIX_EPOCH_MS`,
 * data/talentScriptedCooldowns.ts) — and "what date is this log" is always a
 * wall-clock epoch from the log itself: the match start or the timestamp of
 * the event the rule is about.
 *
 * What that epoch is: the parser turns a log line's `M/D/YYYY HH:MM:SS.mmm`
 * into epoch ms (`parseTimestamp`, packages/parser/src/l1/timestamp.ts). A
 * line whose UTC offset is written with a sign (`…46.400-5`, a log recorded
 * west of UTC) is an exact instant. A log recorded EAST of UTC writes its
 * offset with no sign (`…03.5013`: .501 and a +3 — 7,082 of the 18,134 files
 * of the new-season archive), and the parser reads such a line in the zone
 * it was given, by default the zone of the machine doing the parsing: the
 * same instant on the machine that recorded the log, and off by the gap
 * between the two zones on any other (a Central European log parsed on a US
 * Eastern machine is dated 6 hours late, an Oceanic one 14).
 *
 * The instant such a line states for ITSELF is the parser's
 * `logLineInstantMs` (its header has the measured grammar), and since T90
 * (2026-11-11) the dated rules ARE asked with it: the parser keeps the
 * instant the match's opening line states (`statedStartTime`), parser-compat
 * hands the gap to the parsed `startTime` to the converted match and to each
 * of its units (`logClockOffsetMs` — one UTC offset per file, so one number
 * per match), and a reader turns the parsed timestamp it has into the stated
 * instant with `logInstantOf(unit or match, timestamp)`. The parsed
 * timestamps themselves stay what they are — a recording is joined to a
 * match on them, and a raw.txt line is subtracted from them.
 *
 * Measured for T90 on the 605-file sample: all 20,896,781 lines state an
 * offset (379 files signed, 226 unsigned), no file changes shape or offset
 * from its first line to its last, and stated − parsed is 0 on every signed
 * file and exactly (parsing machine's offset − recorder's offset) on every
 * unsigned one.
 *
 * What is left on the bare parsed epoch: a match that states no offset
 * (none seen), a document stored before the parser kept the instant, a
 * reader with neither unit nor match in hand — those keep the zone
 * uncertainty below (`LOG_ZONE_UNCERTAINTY_MS`) — and the two `logIsFrom`
 * readers of the 12.1 go-live (`drResetMsAt`, the Stellar Protection gate;
 * docs/predicate-index.md, "Not yet unified").
 */

/**
 * Is a log timestamp at or after a dated game change? The cutover instant
 * itself is already the new rule. A timestamp that is not a number is on
 * neither side and reads `false` — a rule that must not take such a log for
 * an old one says so itself (`logDatedNumberAt`).
 */
export function logIsFrom(at: LogInstant, cutoverEpochMs: number): boolean {
  return (
    (typeof at === "object" && at !== null ? at.statedMs : at) >= cutoverEpochMs
  );
}

/** What carries a match's clock offset: the converted match and each of its
 * units (parser-compat `logClockOffsetMs`). */
export interface ILogClock {
  logClockOffsetMs?: number | null;
}

/** A log timestamp carried with the instant its own line states
 * (`logInstantOf`): exact, wherever the log is parsed. */
export interface IStatedLogInstant {
  readonly statedMs: number;
}
/** What a dated rule is asked with: the instant the log states
 * (`logInstantOf` of a match that carries its clock offset) — or a bare
 * parsed epoch, for a log that states no offset, a document stored before
 * the parser kept it, and a reader with no unit or match in hand. Only the
 * bare epoch is uncertain by the parsing machine's zone
 * (`LOG_ZONE_UNCERTAINTY_MS`). */
export type LogInstant = number | IStatedLogInstant;

/** No date at all (a unit that logged nothing): every dated rule reads its
 * `uncertainTakes` side. */
export const UNDATED_LOG_INSTANT: LogInstant = Number.NaN;

/** The instant of a parsed timestamp of `holder`'s match. */
export function logInstantOf(
  holder: ILogClock | object | null | undefined,
  parsedEpochMs: number,
): LogInstant {
  const offset = (holder as ILogClock | null | undefined)?.logClockOffsetMs;
  return typeof offset === "number" && Number.isFinite(parsedEpochMs)
    ? { statedMs: parsedEpochMs + offset }
    : parsedEpochMs;
}

/** A value the game changed at `cutoverEpochMs` (a wall-clock epoch, asked
 * through `logIsFrom`): `before` for a log timestamp earlier than it,
 * `since` from it on — a number (a modifier, a lockout multiplier) or any
 * other reading of the log (fact11, user 2026-11-05: "以后这种都按日期分版本
 * 如果是版本改动的话" — whether two buttons share a cooldown, whether an aura
 * stands for a press).
 *
 * `uncertainTakes` is the side a timestamp that cannot be placed reads — not
 * a number, or inside `LOG_ZONE_UNCERTAINTY_MS` before the cutover. It is
 * `since` (the current value: the dated value is a past exception) unless
 * the rule names `before` because that is its careful direction (a reading
 * that spends a cooldown rather than call it ready). */
export interface ILogDated<T> {
  cutoverEpochMs: number;
  before: T;
  since: T;
  uncertainTakes?: "before" | "since";
  /** The side of a timestamp inside `LOG_ZONE_UNCERTAINTY_MS` before the
   * cutover alone, when it differs from `uncertainTakes` (which then only
   * speaks for a timestamp that is not a number). The 12.1.5 go-live names
   * `before` here (`PATCH_1215_ZONE_BAND_TAKES`, below, with the
   * measurement); the hotfix cutovers leave it unset and keep the reading
   * codex 45-FT-101 asked for. */
  zoneBandTakes?: "before" | "since";
}
/** A number the game changed at a dated cutover (`ILogDated`). */
export type ILogDatedNumber = ILogDated<number>;

/**
 * What a dated value is at a log timestamp — the one reading for every value
 * that moved in a dated change, so two halves of one change (Storm Conduit's
 * cooldown give-back and its lockout multiplier) cannot put the same
 * timestamp on different sides.
 *
 * A stated instant (`logInstantOf` of a match that carries its clock
 * offset — every freshly parsed log) is on one side or the other, exactly:
 * nothing below applies to it (T90: all 1,333 archives of the 605 sample
 * and the wide set state an offset on every line).
 *
 * A bare timestamp that is not a number is not a date and takes
 * `uncertainTakes` (by default the CURRENT value, `since`: the dated value
 * is a past exception).
 *
 * So does a bare timestamp inside `LOG_ZONE_UNCERTAINTY_MS` BEFORE the cutover:
 * the parser dates a line without a signed offset in the parsing machine's
 * zone (header), so such a match may really be up to that much later — by
 * default a post-hotfix log must never be given the old value (codex review
 * 45-FT-101, 2026-10-11: recorded east of UTC, imported further east, a
 * match hours after the cutover read 4 s and a ×0.35 lockout). The old value
 * is then taken only for a timestamp that is before the cutover in every
 * zone; a rule whose careful side is the old one (`uncertainTakes:
 * "before"`) takes the new value only for one after it in every zone.
 */
export function logDatedAt<T>(dated: ILogDated<T>, at: LogInstant): T {
  const uncertain =
    dated.uncertainTakes === "before" ? dated.before : dated.since;
  if (typeof at === "object" && at !== null)
    return logIsFrom(at, dated.cutoverEpochMs) ? dated.since : dated.before;
  // anything that is not a number (a missing timestamp) is no date either
  const logEpochMs: number = at;
  if (!Number.isFinite(logEpochMs)) return uncertain;
  if (!logIsFrom(logEpochMs, dated.cutoverEpochMs - LOG_ZONE_UNCERTAINTY_MS))
    return dated.before;
  if (logIsFrom(logEpochMs, dated.cutoverEpochMs)) return dated.since;
  if (dated.zoneBandTakes !== undefined)
    return dated.zoneBandTakes === "before" ? dated.before : dated.since;
  return uncertain;
}

/** `logDatedAt` of a dated number. */
export function logDatedNumberAt(
  dated: ILogDatedNumber,
  at: LogInstant,
): number {
  return logDatedAt(dated, at);
}

/**
 * How far the parser's date of a line can lie BEFORE the instant the line
 * states: a line without a signed offset was recorded at UTC+0…+14 and is
 * read in the parsing machine's zone (UTC−12…+14), so the parsed epoch is
 * early by (machine − recorder) hours at most — 14.
 */
export const LOG_ZONE_UNCERTAINTY_MS = 14 * 60 * 60 * 1000;

/** The side a log takes when its date is inside the zone uncertainty before
 * the 12.1.5 go-live (`ILogDated.zoneBandTakes`; the instant is
 * `PATCH_1215_GOLIVE_EPOCH_MS`, utils/talents.ts): BEFORE. Measured, not
 * assumed: of the 1,333 archives of the 605-file sample and the wide set,
 * the 4 dated inside the window all state an instant before the go-live
 * (`rawLineInstantMs` of their first line), one of them under a
 * `BUILD_VERSION,12.1.0` header with The Hunt and Predator's Wake pressed
 * 9–13 s apart, which the shared 12.1.5 cooldown forbids (T85; the
 * coordinator's reading of the 2026-11-05 "split by date" ruling for a date
 * that cannot decide). Every default-`since` reader of this cutover names
 * it, so two halves of the patch cannot disagree about one log. */
export const PATCH_1215_ZONE_BAND_TAKES = "before" as const;
