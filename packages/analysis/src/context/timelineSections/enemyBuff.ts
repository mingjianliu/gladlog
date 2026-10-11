/**
 * [ENEMY BUFF] / [ENEMY BUFF END] (F67b) — enemies' major buff windows, minus the
 * intervals GH #99 Rules B & C folded into a cast line, with any missed-purge note
 * those rules attached.
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. Output is pinned by the 605-file
 * acceptanceCapture context hash.
 */
import { fmtTime } from "../../utils/renderGrid";
import { AURA_STILL_UP_AT_ROUND_END } from "../../utils/roundEnd";
import type { TimelineCtx } from "./ctx";

export function emitEnemyBuffEntries(
  ctx: Pick<
    TimelineCtx,
    | "enemyBuffIntervals"
    | "droppedBuffIntervals"
    | "buffPurgeAnnotations"
    | "addEntry"
    | "enemyPid"
    | "matchStartMs"
    | "roundEndAtMs"
  >,
): void {
  const {
    enemyBuffIntervals,
    droppedBuffIntervals,
    buffPurgeAnnotations,
    addEntry,
    enemyPid,
    matchStartMs,
    roundEndAtMs,
  } = ctx;
  const roundEndS = (roundEndAtMs - matchStartMs) / 1000;

  for (const [enemyName, intervals] of enemyBuffIntervals) {
    for (const interval of intervals) {
      if (!droppedBuffIntervals.has(interval)) {
        const purgeNote = buffPurgeAnnotations.get(interval) ?? "";
        addEntry(
          interval.startSeconds,
          `${fmtTime(interval.startSeconds)}  [ENEMY BUFF]   ${enemyPid(enemyName)}: ${interval.spellName}${purgeNote}`,
        );
      }
      // F02b: a buff the round ended on did not end — its REMOVED is logged
      // after the round (a Solo Shuffle log runs on past the ending death),
      // or the log has none and the interval was closed at the log's end.
      // The line sits at the round's end and says so; a buff that went up at
      // or after it has no end in the round at all.
      if (interval.startSeconds >= roundEndS) continue;
      const cut =
        Math.round(matchStartMs + interval.endSeconds * 1000) >= roundEndAtMs;
      const endS = cut ? roundEndS : interval.endSeconds;
      addEntry(
        endS,
        `${fmtTime(endS)}  [ENEMY BUFF END]   ${enemyPid(enemyName)}: ${interval.spellName}${cut ? ` (${AURA_STILL_UP_AT_ROUND_END})` : ""}`,
      );
    }
  }
}
