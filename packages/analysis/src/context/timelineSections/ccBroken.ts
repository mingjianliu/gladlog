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
  ctx: Pick<TimelineCtx, "params" | "addEntry" | "actorLabel" | "enemyPid">,
): void {
  const { params, addEntry, actorLabel, enemyPid } = ctx;

  for (const ev of params.ccBreakEvents ?? []) {
    const early =
      ev.remainingSeconds != null
        ? ` — ${ev.remainingSeconds.toFixed(1)}s of CC wasted`
        : "";
    // the breaker by the row's own source GUID: a pet's break reads
    // `2(BMHunter)'s pet's Kill Command` — `breakerName` is the owner's name
    // with a marker, which the roster label read as the owner alone and
    // without his spec tag (430 lines of the 605-file capture, 2026-10-11)
    const breaker = actorLabel(
      ev.breakerUnitName ?? ev.breakerName,
      "friendly",
      ev.breakerUnitId,
    );
    addEntry(
      ev.atSeconds,
      `${fmtTime(ev.atSeconds)}  [CC BROKEN]   ${breaker}'s ${ev.breakSpellName} broke own team's ${ev.ccSpellName} on ${enemyPid(ev.holderName)}${early}`,
    );
  }
}
