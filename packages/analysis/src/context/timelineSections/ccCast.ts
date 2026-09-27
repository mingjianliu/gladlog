/**
 * [CC CAST] — AoE CC cast by friendly players on enemies that no cast line
 * already carries (the owner / teammate cast lines consume the events they fold
 * in, through the shared `consumedAoeEvents`, so this runs after them).
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. Output is pinned by the 605-file
 * acceptanceCapture context hash.
 */
import { fmtTime } from "../../utils/renderGrid";
import type { TimelineCtx } from "./ctx";

export function emitCcCastEntries(
  ctx: Pick<
    TimelineCtx,
    "aoeCCEvents" | "consumedAoeEvents" | "pid" | "enemyPid" | "addEntry"
  >,
): void {
  const { aoeCCEvents, consumedAoeEvents, pid, enemyPid, addEntry } = ctx;

  if (aoeCCEvents.length > 0) {
    for (const event of aoeCCEvents) {
      if (consumedAoeEvents.has(event)) continue;
      const casterLabel = pid(event.casterName);
      const targetLabels = event.targets
        .map((t) => enemyPid(t.name))
        .join(", ");
      const countNote =
        event.targets.length > 1 ? ` [${event.targets.length} enemies]` : "";
      addEntry(
        event.atSeconds,
        `${fmtTime(event.atSeconds)}  [CC CAST]   ${event.spellName} (by ${casterLabel}) → ${targetLabels}${countNote}`,
      );
    }
  }
}
