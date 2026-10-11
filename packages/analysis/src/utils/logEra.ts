/**
 * Rules that depend on WHEN a match was played ask one question, here.
 *
 * A dated game change is an exported epoch constant (`Date.UTC(…)`) next to
 * the rule it gates — 12.1 go-live (`PATCH_121_GOLIVE_EPOCH_MS`,
 * drAnalysis.ts: the DR reset window, the Stellar Protection dispel penalty)
 * — and "what date is this log" is always a wall-clock epoch from the log
 * itself: the match start or the timestamp of the event the rule is about.
 *
 * What that epoch is: the parser turns a log line's `M/D/YYYY HH:MM:SS.mmm`
 * into epoch ms (`parseTimestamp`, packages/parser/src/l1/timestamp.ts). A
 * line whose UTC offset is written with a sign (`…46.400-5`) is an exact
 * instant. Any other line — no offset, or one written with no sign
 * (`…03.5013` in the new-season archive: .501 and a +3) — is read in the
 * zone the parser was given, by default the zone of the machine doing the
 * parsing. For another player's log that can be many hours off, so a rule is
 * only as sharp as that: a match within a day of a cutover may land on the
 * wrong side of it.
 */

/**
 * Is a log timestamp at or after a dated game change? The cutover instant
 * itself is already the new rule. A timestamp that is not a number is on
 * neither side and reads `false`.
 */
export function logIsFrom(logEpochMs: number, cutoverEpochMs: number): boolean {
  return logEpochMs >= cutoverEpochMs;
}
