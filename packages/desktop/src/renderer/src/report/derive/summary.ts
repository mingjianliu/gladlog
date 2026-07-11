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

export function deriveSummary(m: ReportSource): UnitTotals[] {
  const units = Object.values(m.units);
  const durationSec = (m.endTime - m.startTime) / 1000;
  const rows: UnitTotals[] = [];
  for (const u of units) {
    if (u.kind !== "Player" || !u.info) continue;
    const pets = units.filter((p) => p.ownerId === u.id);
    const damageDone =
      sum(u.damageOut) + pets.reduce((a, p) => a + sum(p.damageOut), 0);
    const healingDone =
      sum(u.healOut) + pets.reduce((a, p) => a + sum(p.healOut), 0);
    const absorbsDone = u.absorbsOut.reduce((a, e) => a + e.absorbedAmount, 0);
    const damageTaken = sum(u.damageIn);
    const deaths = u.deaths.filter((d) => !d.unconscious).length;
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
