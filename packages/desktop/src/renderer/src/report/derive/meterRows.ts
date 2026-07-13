import type { UnitTotals } from "./summary";
import { classColor } from "../data/gameConstants";

export type MeterMode = "damage" | "healing" | "taken";

export interface MeterRow {
  unitId: string;
  name: string;
  classId: number;
  value: number;
  widthPct: number;
  label: string;
  color: string;
}

export function meterValue(r: UnitTotals, mode: MeterMode): number {
  return mode === "damage"
    ? r.damageDone
    : mode === "healing"
      ? r.healingDone + r.absorbsDone
      : r.damageTaken;
}

export function meterRows(rows: UnitTotals[], mode: MeterMode): MeterRow[] {
  const sorted = [...rows].sort(
    (a, b) => meterValue(b, mode) - meterValue(a, mode),
  );
  const max = Math.max(1, ...sorted.map((r) => meterValue(r, mode)));
  return sorted.map((r) => {
    const value = meterValue(r, mode);
    return {
      unitId: r.unitId,
      name: r.name,
      classId: r.classId,
      value,
      widthPct: (value / max) * 100,
      label: Math.round(value).toLocaleString("en-US"),
      color: classColor(r.classId),
    };
  });
}
