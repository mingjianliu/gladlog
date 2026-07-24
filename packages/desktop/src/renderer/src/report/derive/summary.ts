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
  hps: number;
}

const sum = (events: { effectiveAmount: number }[]): number =>
  events.reduce((acc, e) => acc + e.effectiveAmount, 0);

/** range(时间窗联动①):给定时窗口时,瞬时事件按 timestamp 过滤,
 * dps/hps 分母用窗口时长 —— 谓词见 derive/timeRange.ts。 */
export function deriveSummary(
  m: ReportSource,
  range?: TimeRange | null,
): UnitTotals[] {
  const units = Object.values(m.units);
  const durationSec = rangeDurationS(m, range);
  const inR = eventInRange(m, range);
  const rows: UnitTotals[] = [];
  for (const u of units) {
    if (u.kind !== "Player" || !u.info) continue;
    const pets = units.filter((p) => p.ownerId === u.id);
    const damageDone =
      sum(u.damageOut.filter(inR)) +
      pets.reduce((a, p) => a + sum(p.damageOut.filter(inR)), 0);
    const healingDone =
      sum(u.healOut.filter(inR)) +
      pets.reduce((a, p) => a + sum(p.healOut.filter(inR)), 0);
    const absorbsDone =
      u.absorbsOut.filter(inR).reduce((a, e) => a + e.absorbedAmount, 0) +
      pets.reduce(
        (a, p) =>
          a + p.absorbsOut.filter(inR).reduce((x, e) => x + e.absorbedAmount, 0),
        0,
      );
    const damageTaken = sum(u.damageIn.filter(inR));
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
      hps: durationSec > 0 ? healingDone / durationSec : 0,
    });
  }
  return rows.sort((a, b) => b.damageDone - a.damageDone);
}
