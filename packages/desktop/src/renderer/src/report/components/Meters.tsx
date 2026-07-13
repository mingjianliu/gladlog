import { meterRows, type MeterMode } from "../derive/meterRows";
import type { UnitTotals } from "../derive/summary";

export function Meters({
  rows,
  mode,
}: {
  rows: UnitTotals[];
  mode: MeterMode;
}) {
  const items = meterRows(rows, mode);
  return (
    <div className="rpt-meters">
      {items.map((r) => (
        <div
          key={r.unitId}
          className="rpt-meter-row"
          title={`${r.name}: ${r.label}`}
        >
          <span className="rpt-meter-name">{r.name}</span>
          <span className="rpt-meter-bar-track">
            <span
              className="rpt-meter-bar"
              style={{ width: `${r.widthPct}%`, background: r.color }}
            />
          </span>
          <span className="rpt-meter-value">{r.label}</span>
        </div>
      ))}
    </div>
  );
}
