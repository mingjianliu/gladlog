import type { UnitTotals } from "../derive/summary";
import { classColor } from "../data/gameConstants";

const value = (r: UnitTotals, mode: "damage" | "healing" | "taken"): number =>
  mode === "damage"
    ? r.damageDone
    : mode === "healing"
      ? r.healingDone + r.absorbsDone
      : r.damageTaken;

export function Meters({
  rows,
  mode,
}: {
  rows: UnitTotals[];
  mode: "damage" | "healing" | "taken";
}) {
  const sorted = [...rows].sort((a, b) => value(b, mode) - value(a, mode));
  const max = Math.max(1, ...sorted.map((r) => value(r, mode)));
  return (
    <div className="rpt-meters">
      {sorted.map((r) => {
        const v = value(r, mode);
        return (
          <div
            key={r.unitId}
            className="rpt-meter-row"
            title={`${r.name}: ${Math.round(v).toLocaleString("en-US")}`}
          >
            <span className="rpt-meter-name">{r.name}</span>
            <span className="rpt-meter-bar-track">
              <span
                className="rpt-meter-bar"
                style={{
                  width: `${(v / max) * 100}%`,
                  background: classColor(r.classId),
                }}
              />
            </span>
            <span className="rpt-meter-value">
              {Math.round(v).toLocaleString("en-US")}
            </span>
          </div>
        );
      })}
    </div>
  );
}
