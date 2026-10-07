/**
 * [INACTIVITY] — the healer owner's healing gaps (healer owners only).
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. Output is pinned by the 605-file
 * acceptanceCapture context hash.
 */
import { fmtTime } from "../../utils/renderGrid";
import type { TimelineCtx } from "./ctx";

export function emitHealerInactivityEntries(
  ctx: Pick<
    TimelineCtx,
    "isHealer" | "healingGaps" | "addEntry" | "pid" | "owner"
  >,
): void {
  const { isHealer, healingGaps, addEntry, pid, owner } = ctx;

  if (isHealer) {
    for (const gap of healingGaps) {
      addEntry(
        gap.fromSeconds,
        `${fmtTime(gap.fromSeconds)}  [INACTIVITY]   ${pid(owner.name)} inactive ${gap.durationSeconds.toFixed(1)}s (${gap.freeCastSeconds.toFixed(1)}s of it un-CC'd/free to cast) while ${pid(gap.mostDamagedName)} under pressure`,
      );
    }
  }
}
