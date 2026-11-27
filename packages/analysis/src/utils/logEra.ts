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
  /** parser-compat `logRegion`: the region the match was played in */
  logRegion?: string;
  /** parser-compat `logLobbyStatedMs`: the instant its lobby opened */
  logLobbyStatedMs?: number;
}

/** A log timestamp carried with the instant its own line states
 * (`logInstantOf`): the same wherever the log is parsed, and exact to the
 * whole hours of the recorder's zone — a zone with a fractional offset
 * writes only its whole hours and states an instant late by the fraction
 * (`STATED_ZONE_UNCERTAINTY_MS`). */
export interface IStatedLogInstant {
  readonly statedMs: number;
  /** The region the match was played in (parser-compat `logRegion`), when
   * its players' names state one — a patch that went live region by region
   * reads it (`REGIONAL_GOLIVE_BANDS`). */
  readonly region?: string;
  /** The instant its lobby opened (parser-compat `logLobbyStatedMs`), with
   * `region`: a later region's band is decided once per lobby, so a Solo
   * Shuffle that crosses the band's end reads one side in every round
   * (codex 85-tk-L6-T268-1 #1: b7304f67, round 3 at 10-14 23:59:10 UTC). */
  readonly lobbyMs?: number;
}
/** What a dated rule is asked with: the instant the log states
 * (`logInstantOf` of a match that carries its clock offset) — or a bare
 * parsed epoch, for a log that states no offset, a document stored before
 * the parser kept it, and a reader with no unit or match in hand. The bare
 * epoch is uncertain by the parsing machine's zone
 * (`LOG_ZONE_UNCERTAINTY_MS`); the stated instant only by the fraction of
 * an hour its line cannot write (`STATED_ZONE_UNCERTAINTY_MS`). */
export type LogInstant = number | IStatedLogInstant;

/** No date at all (a unit that logged nothing): every dated rule reads its
 * `uncertainTakes` side. */
export const UNDATED_LOG_INSTANT: LogInstant = Number.NaN;

/** The instant of a parsed timestamp of `holder`'s match. */
export function logInstantOf(
  holder: ILogClock | object | null | undefined,
  parsedEpochMs: number,
): LogInstant {
  const clock = holder as ILogClock | null | undefined;
  const offset = clock?.logClockOffsetMs;
  if (typeof offset !== "number" || !Number.isFinite(parsedEpochMs))
    return parsedEpochMs;
  const region = clock?.logRegion;
  if (typeof region !== "string") return { statedMs: parsedEpochMs + offset };
  const lobbyMs = clock?.logLobbyStatedMs;
  return typeof lobbyMs === "number"
    ? { statedMs: parsedEpochMs + offset, region, lobbyMs }
    : { statedMs: parsedEpochMs + offset, region };
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
 * offset — every freshly parsed log; T90: all 1,333 archives of the 605
 * sample and the wide set state an offset on every line) is on one side or
 * the other unless it is less than `STATED_ZONE_UNCERTAINTY_MS` AFTER the
 * cutover: there it reads as a bare timestamp inside its own band does
 * (`zoneBandTakes`, else `uncertainTakes`), because the line of a
 * fractional-offset zone states an instant that much too late (codex
 * 85-tk-I-T90-1: an Adelaide line 15 min before the cutover stated 15 min
 * after it, and Doom Winds' aura stopped standing for a press). A stated
 * instant before the cutover is before it; the 14 h band below does not
 * apply. A stated instant of a region the change reached later reads the
 * band side too, up to that region's own instant (`REGIONAL_GOLIVE_BANDS`;
 * 12.1.5 on EU realms, pipeline T268).
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
  const band = (): T =>
    dated.zoneBandTakes !== undefined
      ? dated.zoneBandTakes === "before"
        ? dated.before
        : dated.since
      : uncertain;
  if (typeof at === "object" && at !== null) {
    if (!Number.isFinite(at.statedMs)) return uncertain;
    const fromCutover = at.statedMs - dated.cutoverEpochMs;
    if (fromCutover < 0) return dated.before;
    // a region the change reached later (`REGIONAL_GOLIVE_BANDS`), decided
    // by the instant the lobby opened
    const regionBandUntil =
      at.region === undefined
        ? undefined
        : REGIONAL_GOLIVE_BANDS.get(dated.cutoverEpochMs)?.[at.region];
    if (
      regionBandUntil !== undefined &&
      (at.lobbyMs ?? at.statedMs) < regionBandUntil
    )
      return band();
    if (fromCutover >= STATED_ZONE_UNCERTAINTY_MS) return dated.since;
    return band();
  }
  // anything that is not a number (a missing timestamp) is no date either
  const logEpochMs: number = at;
  if (!Number.isFinite(logEpochMs)) return uncertain;
  if (!logIsFrom(logEpochMs, dated.cutoverEpochMs - LOG_ZONE_UNCERTAINTY_MS))
    return dated.before;
  if (logIsFrom(logEpochMs, dated.cutoverEpochMs)) return dated.since;
  return band();
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

/**
 * How far the instant a line STATES can lie AFTER the instant it was
 * written: the line writes its zone's offset in whole hours, so a
 * fractional-offset zone states an instant late by its fraction. Measured
 * (parser `l1/statedInstant.ts`): all 164 Australia/Adelaide files, UTC+9:30,
 * write `9` — half an hour late. No file shows a :45 zone, so the bound is
 * the largest fraction any zone has (45 min: Nepal, Chatham, Eucla).
 *
 * One-sided on that measurement. A fractional zone WEST of UTC
 * (Newfoundland, Marquesas) would state an instant too EARLY if it drops
 * its fraction the same way; no such file exists in 18,134 to show how it
 * is written, and a band before the cutover would give the new value to
 * every whole-hour log of its last 45 minutes (of the 1,333 archives of the
 * 605 sample and the wide set, 2 open inside such a band — both whole-hour
 * zones, both truly before — and none opens inside the band after).
 */
export const STATED_ZONE_UNCERTAINTY_MS = 45 * 60 * 1000;

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

/**
 * 12.1.5 go-live: NA maintenance 2026-10-13 (≈ 15:00–23:00 UTC), EU 10-14
 * (cooldown mastery round, eval-private research/builds.md: no file before
 * 10-13 23:17 UTC carries a 12.1.5-only spell id; 20 after). The instant is
 * NA's; EU's is `PATCH_1215_REGION_BANDS`.
 */
export const PATCH_1215_GOLIVE_EPOCH_MS = Date.UTC(2026, 9, 13, 15, 0, 0);

/**
 * Where 12.1.5 went live later than `PATCH_1215_GOLIVE_EPOCH_MS`: region →
 * the instant up to which a log of that region, stated after the NA
 * go-live, reads the go-live's band side (`zoneBandTakes`, else
 * `uncertainTakes` — `PATCH_1215_ZONE_BAND_TAKES`, before, for every reader
 * of this cutover). EU realms went live on 10-14 (Blizzard); the corpus
 * pins it no closer than after 10-13 23:30 UTC (pipeline T268: an EU Solo
 * Shuffle file of that instant, acc115f2, still reads 12.1.0 — its Holy
 * Priest, whom the 12.1.5 talent map calls an Ultimate Serenity holder,
 * presses Holy Word: Sanctify 11 times, which that talent replaces;
 * research/holyword.md §1) and before 10-14 23:54 (the next EU file). User
 * ruling 2026-11-27: the whole of EU's 10-14 is the band, to 10-15 00:00
 * UTC — no instant inside it is pinned.
 */
export const PATCH_1215_REGION_BANDS: Readonly<Record<string, number>> = {
  EU: Date.UTC(2026, 9, 15, 0, 0, 0),
};

/** Dated changes that went live region by region: cutover → its
 * `PATCH_1215_REGION_BANDS`-shaped table. Keyed by the cutover instant so
 * every rule of one change reads the same band — no reader can leave it
 * out. A bare parsed epoch carries no region and does not read it. */
const REGIONAL_GOLIVE_BANDS: ReadonlyMap<
  number,
  Readonly<Record<string, number>>
> = new Map([[PATCH_1215_GOLIVE_EPOCH_MS, PATCH_1215_REGION_BANDS]]);
