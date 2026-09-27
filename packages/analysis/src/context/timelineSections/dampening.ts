/**
 * Dampening milestone alerts (F149) — `[DAMPENING ALERT: n%]` at 0:00 for every
 * milestone (30 / 50 / 70 / 90 %) already reached when the match starts, then at
 * the first crossing of each remaining one.
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. Output is pinned by the 605-file
 * acceptanceCapture context hash.
 */
import {
  buildDampeningEvents,
  getDampeningPercentage,
} from "../../utils/dampening";
import { fmtTime } from "../../utils/renderGrid";
import type { TimelineCtx } from "./ctx";

export function emitDampeningEntries(
  ctx: Pick<
    TimelineCtx,
    "bracket" | "allPlayers" | "matchStartMs" | "addEntry"
  >,
): void {
  const { bracket, allPlayers, matchStartMs, addEntry } = ctx;

  const initialDampening = getDampeningPercentage(
    bracket ?? "3v3",
    allPlayers,
    matchStartMs,
  );
  const emittedMilestones = new Set<number>();
  const milestones = [30, 50, 70, 90];

  for (const milestone of milestones) {
    if (initialDampening >= milestone) {
      addEntry(0, `${fmtTime(0)}  [DAMPENING ALERT: ${milestone}%]`);
      emittedMilestones.add(milestone);
    }
  }

  const events = buildDampeningEvents(allPlayers);
  const dampeningEvents = events.map((e) => ({
    timeSeconds: (e.timestamp - matchStartMs) / 1000,
    stacks: e.stacks,
  }));

  for (const milestone of milestones) {
    if (emittedMilestones.has(milestone)) continue;
    const firstCrossing = dampeningEvents.find((e) => e.stacks >= milestone);
    if (firstCrossing) {
      addEntry(
        firstCrossing.timeSeconds,
        `${fmtTime(firstCrossing.timeSeconds)}  [DAMPENING ALERT: ${milestone}%]`,
      );
      emittedMilestones.add(milestone);
    }
  }
}
