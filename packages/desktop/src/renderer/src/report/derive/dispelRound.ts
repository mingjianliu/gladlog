/**
 * The round the report's dispel readers hand `reconstructDispelSummary`.
 *
 * That function reads where the round ends off the combat it is given
 * (`roundEndMs(combat)`: a Solo Shuffle round's ending death, else the log's
 * end) and stops every missed-purge and uncleansed window there. The prompt
 * hands it the round itself (`buildMatchContext`). The dispel panel
 * (`dispelDash.ts`) and the `missed-purge-kill-window` card (`mistakes.ts`)
 * used to hand it `{startTime, endTime}`, so for them a Solo Shuffle round
 * ended where its log does — up to 2 s after the death: `Ns 未被驱散` /
 * `Ns 未被解` read longer than the prompt's `unpurged for Ns` /
 * `[UNCLEANSED DEBUFF] … Ns` for the same aura, and listed windows the prompt
 * drops (under 3 s inside the round, or applied after the death).
 *
 * This is the span plus the two things `roundEndMs` reads — the bracket and
 * the round's units — and nothing else of the match: the zone stays out, so
 * the reach reading is range alone, as it was for these two readers
 * (docs/predicate-index.md, "Not yet unified"). The units are also the roster
 * the function asks a pet-cast removal's lockout and a damage row's side of.
 * `predicateIndex.test.ts` holds `roundEndMs` of this to `roundEndMs` of the
 * round, and both readers to this function.
 */
export function dispelRoundOf<U>(legacy: {
  startTime: number;
  endTime: number;
  startInfo?: { bracket?: string };
  units: Record<string, U>;
}): {
  startTime: number;
  endTime: number;
  startInfo: { bracket: string | undefined };
  units: Record<string, U>;
} {
  return {
    startTime: legacy.startTime,
    endTime: legacy.endTime,
    startInfo: { bracket: legacy.startInfo?.bracket },
    units: legacy.units,
  };
}
