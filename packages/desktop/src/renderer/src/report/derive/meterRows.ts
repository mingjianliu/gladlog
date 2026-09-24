import { classColor } from "../data/gameConstants";
import type { UnitTotals } from "./summary";
import type { TeamSide } from "./teamSide";

// "stats" is a fourth meter mode (the statistics table) and does not go through
// the numeric meterRows path.
export type MeterMode = "damage" | "healing" | "taken" | "stats";

export interface MeterRow {
  unitId: string;
  name: string;
  classId: number;
  /** For the row's spec icon (UI review 2026-08-21 #6); 0 = unknown. */
  specId: number;
  teamId: number;
  value: number;
  widthPct: number;
  label: string;
  /** The exact full value (toLocaleString); backs the abbreviated label's
   *  title. */
  exactLabel: string;
  color: string;
}

/** Tiered abbreviation for meter values (P2-2): ≥1e6 → x.xxM, ≥1e5 → xxxk,
 *  everything else in full. */
export function abbrevAmount(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e5) return `${Math.round(v / 1e3)}k`;
  return Math.round(v).toLocaleString("en-US");
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
      specId: r.specId,
      teamId: r.teamId,
      value,
      widthPct: (value / max) * 100,
      label: abbrevAmount(value),
      /** The exact full value (kept for the row title, alongside the
       *  abbreviated label). */
      exactLabel: Math.round(value).toLocaleString("en-US"),
      color: classColor(r.classId),
    };
  });
}

export interface MeterGroup {
  side: TeamSide;
  rows: MeterRow[];
}

/**
 * Split the leaderboard into 我方 / 敌方 blocks, ranked within each (the user's
 * call, 2026-08-04: seeing your own team together beats a cross-team ranking).
 *
 * Ordering lives here rather than in the component because the data-faithfulness
 * check (derive/faithfulness.ts, run headless by verify:vision) compares the
 * rendered rows against the model **positionally** — the moment the component
 * reorders on its own, the check is comparing row 1 against row 4 and reporting
 * a lie as a divergence.
 *
 * No side information (an imported log without playerTeamId, or the bare
 * `<Meters rows mode />` the faithfulness harness renders) collapses to a single
 * "unknown" group in the input order, so those paths keep the exact DOM they had
 * before teams were marked at all.
 */
export function meterGroups(
  rows: MeterRow[],
  sideOf?: (unitId: string) => TeamSide,
): MeterGroup[] {
  if (!sideOf) return [{ side: "unknown", rows }];
  const bucket = new Map<TeamSide, MeterRow[]>();
  for (const r of rows) {
    const side = sideOf(r.unitId);
    const list = bucket.get(side) ?? [];
    list.push(r);
    bucket.set(side, list);
  }
  if (bucket.size === 1 && bucket.has("unknown"))
    return [{ side: "unknown", rows }];
  // 我方 first — you read your own team before theirs.
  const order: TeamSide[] = ["friendly", "enemy", "unknown"];
  return order
    .filter((s) => (bucket.get(s)?.length ?? 0) > 0)
    .map((side) => ({ side, rows: bucket.get(side)! }));
}
