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
import type { TimelineCtx } from "./ctx";

export function emitEnemyBuffEntries(
  ctx: Pick<
    TimelineCtx,
    | "enemyBuffIntervals"
    | "droppedBuffIntervals"
    | "buffPurgeAnnotations"
    | "addEntry"
    | "enemyPid"
  >,
): void {
  const {
    enemyBuffIntervals,
    droppedBuffIntervals,
    buffPurgeAnnotations,
    addEntry,
    enemyPid,
  } = ctx;

  for (const [enemyName, intervals] of enemyBuffIntervals) {
    for (const interval of intervals) {
      if (!droppedBuffIntervals.has(interval)) {
        const purgeNote = buffPurgeAnnotations.get(interval) ?? "";
        addEntry(
          interval.startSeconds,
          `${fmtTime(interval.startSeconds)}  [ENEMY BUFF]   ${enemyPid(enemyName)}: ${interval.spellName}${purgeNote}`,
        );
      }
      addEntry(
        interval.endSeconds,
        `${fmtTime(interval.endSeconds)}  [ENEMY BUFF END]   ${enemyPid(enemyName)}: ${interval.spellName}`,
      );
    }
  }
}
