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
 * The instant such a line states for ITSELF is `rawLineInstantMs`
 * (utils/rawStreams.ts — the parser's `logLineInstantMs`, whose header has
 * the measured grammar). The dated rules are NOT asked with it: they are
 * asked with event timestamps of the parsed match, dozens of call sites away
 * from anything that knows how far that match's clock is from the stated
 * one, and the parsed document does not carry the number (its timestamps
 * must stay what they are — a recording is joined to a match on them, and a
 * raw.txt line is subtracted from them). So a rule is only as sharp as the
 * parsing machine's zone: another player's match within a day of a cutover
 * may land on the wrong side of it — 2 of the 605 new-season files on a US
 * Eastern machine, both at the Storm Conduit cutover (docs/predicate-index.md,
 * "Not yet unified"; `kickLockoutScan.ts` prints both readings of every pair
 * it dates).
 */

/**
 * Is a log timestamp at or after a dated game change? The cutover instant
 * itself is already the new rule. A timestamp that is not a number is on
 * neither side and reads `false` — a rule that must not take such a log for
 * an old one says so itself (`logDatedNumberAt`).
 */
export function logIsFrom(logEpochMs: number, cutoverEpochMs: number): boolean {
  return logEpochMs >= cutoverEpochMs;
}

/** A number the game changed at `cutoverEpochMs` (a wall-clock epoch, asked
 * through `logIsFrom`): `before` for a log timestamp earlier than it,
 * `since` from it on. */
export interface ILogDatedNumber {
  cutoverEpochMs: number;
  before: number;
  since: number;
}

/**
 * What a dated number is at a log timestamp — the one reading for every
 * number that moved in a dated change, so two halves of one hotfix (Storm
 * Conduit's cooldown give-back and its lockout multiplier) cannot put the
 * same timestamp on different sides.
 *
 * A timestamp that is not a number is not a date and takes the CURRENT value
 * (`since`), never the old one: the dated value is a past exception. A rule
 * for which that is the less careful direction must not use this.
 *
 * So does a timestamp inside `LOG_ZONE_UNCERTAINTY_MS` BEFORE the cutover:
 * the parser dates a line without a signed offset in the parsing machine's
 * zone (header), so such a match may really be up to that much later — a
 * post-hotfix log must never be given the old number (codex review
 * 45-FT-101, 2026-10-11: recorded east of UTC, imported further east, a
 * match hours after the cutover read 4 s and a ×0.35 lockout). The old value
 * is taken only for a timestamp that is before the cutover in every zone.
 */
export function logDatedNumberAt(
  dated: ILogDatedNumber,
  logEpochMs: number,
): number {
  return Number.isFinite(logEpochMs) &&
    !logIsFrom(logEpochMs, dated.cutoverEpochMs - LOG_ZONE_UNCERTAINTY_MS)
    ? dated.before
    : dated.since;
}

/**
 * How far the parser's date of a line can lie BEFORE the instant the line
 * states: a line without a signed offset was recorded at UTC+0…+14 and is
 * read in the parsing machine's zone (UTC−12…+14), so the parsed epoch is
 * early by (machine − recorder) hours at most — 14.
 */
export const LOG_ZONE_UNCERTAINTY_MS = 14 * 60 * 60 * 1000;
