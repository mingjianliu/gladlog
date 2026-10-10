/**
 * Dampening milestone alerts (F149) — `[DAMPENING ALERT: n%]` at 0:00 for every
 * milestone (30 / 50 / 70 / 90 %) already reached when the match starts, then at
 * the first crossing of each remaining one.
 *
 * "Already reached when the match starts" needs a value stated at 0:00. A 2v2
 * round has none before its first logged stack (`getInitialDampening`, FT-T13
 * D11), so its 30 % alert sits at the second of the first logged stack at or
 * above 30 — the first stack itself with a healer on both teams (it reads 42,
 * inside the round's first 20 s), a later one otherwise (the first reads 22) —
 * instead of the `0:00` a hand value put it at. The thresholds and the
 * alert's meaning are unchanged.
 *
 * Cut out of buildMatchTimeline (GH #116); its closure inputs arrive through
 * `ctx`.
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
    if (initialDampening !== null && initialDampening >= milestone) {
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
