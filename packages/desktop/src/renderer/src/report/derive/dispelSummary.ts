import { reconstructDispelSummary } from "@gladlog/analysis";

import type { toLegacySafe } from "./legacySource";

type LegacyMatch = ReturnType<typeof toLegacySafe>;
type Side = Parameters<typeof reconstructDispelSummary>[0];

/**
 * The dispel summary the report's window readers show — the dispel panel
 * (`dispelDash.ts`) and the `missed-purge-kill-window` card (`mistakes.ts`) —
 * asked for exactly as the prompt asks (`buildMatchContext`):
 * `reconstructDispelSummary(us, them, <the round itself>, <our pets>, <their
 * pets>)`.
 *
 * The function reads three things off the round it is handed: where it ends
 * (`roundEndMs`: a Solo Shuffle round's ending death, else the log's end),
 * the zone its reach reading asks line of sight in (`startInfo.zoneId`;
 * without one reach is range alone), and the round's units. The two readers
 * used to hand it less — first `{startTime, endTime}` (a Solo Shuffle window
 * ran to the log's end, up to 2 s past the death), then the span with the
 * bracket and the units but no zone, so a window the prompt calls `no purger
 * had range/line of sight — not actionable` carried no `无视线/超射程` on the
 * panel; and the card handed no pets, so a purge by our pet was not in its
 * summary. Handing the round itself leaves nothing to keep in step by hand.
 *
 * The pets of a side are the units its players own, in the round's unit
 * order — as `buildMatchContext` builds `friendlyPets` / `enemyPets`.
 */
export function dispelSummaryOf(
  legacy: LegacyMatch,
  us: Side,
  them: Side,
): ReturnType<typeof reconstructDispelSummary> {
  const units = Object.values(legacy.units);
  const petsOf = (owners: Side) => {
    const ids = new Set(owners.map((o) => o.id));
    return units.filter((u) => u.ownerId && ids.has(u.ownerId));
  };
  return reconstructDispelSummary(us, them, legacy, petsOf(us), petsOf(them));
}
