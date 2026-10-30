/**
 * [ENEMY BUFF] / [ENEMY BUFF END] (F67b) — enemies' major buff windows, minus the
 * intervals GH #99 Rules B & C folded into a cast line, with any missed-purge note
 * those rules attached. An `[ENEMY BUFF END]` line is a buff that ended inside
 * the round; a start line with no end line is a buff that did not.
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

  for (const [enemyName, intervals] of enemyBuffIntervals) {
    for (const interval of intervals) {
      if (!droppedBuffIntervals.has(interval)) {
        const purgeNote = buffPurgeAnnotations.get(interval) ?? "";
        addEntry(
          interval.startSeconds,
          `${fmtTime(interval.startSeconds)}  [ENEMY BUFF]   ${enemyPid(enemyName)}: ${interval.spellName}${purgeNote}`,
        );
      }
      // A buff the round ended on did not end in it — its REMOVED is logged
      // at or after the round's end (a Solo Shuffle log runs on past the
      // ending death and strips every aura there; F02b), or the log has none
      // and the interval was closed at the log's end. User ruling 2026-10-11:
      // it gets no end line — neither a bare end at the strip nor a `still
      // up` label.
      if (Math.round(matchStartMs + interval.endSeconds * 1000) >= roundEndAtMs)
        continue;
      // …and one whose REMOVED the log lost has no end line either: its end
      // is the official length's cap, not a logged fact
      if (interval.inferredEnd) continue;
      addEntry(
        interval.endSeconds,
        `${fmtTime(interval.endSeconds)}  [ENEMY BUFF END]   ${enemyPid(enemyName)}: ${interval.spellName}`,
      );
    }
  }
}
