/**
 * [CC BROKEN] (#36(e)) — our own damage breaking our own CC, with the CC time
 * wasted when the remaining duration is known.
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. Output is pinned by the 605-file
 * acceptanceCapture context hash.
 */
import { fmtTime } from "../../utils/renderGrid";
import type { TimelineCtx } from "./ctx";

export function emitCcBrokenEntries(
  ctx: Pick<TimelineCtx, "params" | "addEntry" | "pid" | "enemyPid">,
): void {
  const { params, addEntry, pid, enemyPid } = ctx;

  for (const ev of params.ccBreakEvents ?? []) {
    const early =
      ev.remainingSeconds != null
        ? ` — ${ev.remainingSeconds.toFixed(1)}s of CC wasted`
        : "";
    addEntry(
      ev.atSeconds,
      `${fmtTime(ev.atSeconds)}  [CC BROKEN]   ${pid(ev.breakerName)}'s ${ev.breakSpellName} broke own team's ${ev.ccSpellName} on ${enemyPid(ev.holderName)}${early}`,
    );
  }
}
