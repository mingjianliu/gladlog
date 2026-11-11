import { type FlowBasis, forEachContribution, petsOf } from "./flowSeries";
import { sourceMemo } from "./sourceMemo";
import { eventInRange, rangeDurationS, type TimeRange } from "./timeRange";
import type { ReportSource } from "./types";

export interface UnitTotals {
  unitId: string;
  name: string;
  classId: number;
  specId: number;
  teamId: number;
  damageDone: number;
  healingDone: number;
  absorbsDone: number;
  damageTaken: number;
  deaths: number;
  dps: number;
}

/** range (time-window linkage ①): when a window is given, instantaneous
 * events are filtered by timestamp and the dps denominator is the window
 * duration — see derive/timeRange.ts for the predicate.
 *
 * *Which* events count toward each total (pets folded in or not,
 * effectiveAmount vs absorbedAmount) is deliberately not decided here: it comes
 * from flowSeries' forEachContribution, the same source the timeline's
 * per-second flow bars read — so a stack of bars can never drift from the
 * leaderboard number sitting next to it. */
function deriveSummaryUncached(
  m: ReportSource,
  range?: TimeRange | null,
): UnitTotals[] {
  const units = Object.values(m.units);
  const durationSec = rangeDurationS(m, range);
  const inR = eventInRange(m, range);
  const rows: UnitTotals[] = [];
  for (const u of units) {
    if (u.kind !== "Player" || !u.info) continue;
    const pets = petsOf(units, u.id);
    const total = (basis: FlowBasis): number => {
      let acc = 0;
      forEachContribution(u, pets, basis, (e, amount) => {
        if (inR(e)) acc += amount;
      });
      return acc;
    };
    const damageDone = total("damageDone");
    const healingDone = total("healingDone");
    const absorbsDone = total("absorbsDone");
    const damageTaken = total("damageTaken");
    const deaths = u.deaths.filter(inR).filter((d) => !d.unconscious).length;
    rows.push({
      unitId: u.id,
      name: u.name,
      classId: u.classId,
      specId: u.specId,
      teamId: u.info.teamId,
      damageDone,
      healingDone,
      absorbsDone,
      damageTaken,
      deaths,
      dps: durationSec > 0 ? damageDone / durationSec : 0,
    });
  }
  return rows.sort((a, b) => b.damageDone - a.damageDone);
}

/** deriveSummaryUncached; the whole-match call (no range) is kept per source object
 * across mounts (see sourceMemo.ts). */
export function deriveSummary(
  source: ReportSource,
  range?: TimeRange | null,
): ReturnType<typeof deriveSummaryUncached> {
  if (range != null) return deriveSummaryUncached(source, range);
  return sourceMemo(source, "deriveSummary", () => deriveSummaryUncached(source, range));
}
