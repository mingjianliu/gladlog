import { type MeterMode,meterRows } from "../derive/meterRows";
import type { UnitTotals } from "../derive/summary";

const MODE_LABEL: Record<MeterMode, string> = {
  damage: "伤害",
  healing: "治疗",
  taken: "承伤",
};

export function Meters({
  rows,
  mode,
  onMode,
  playerTeamId,
}: {
  rows: UnitTotals[];
  mode: MeterMode;
  onMode?: (m: MeterMode) => void;
  playerTeamId?: number | null;
}) {
  const items = meterRows(rows, mode);
  return (
    <div className="rpt-meters-card">
      <div className="rpt-meters-head">
        <span className="rpt-card-label">榜单模式</span>
        <div className="rpt-mode-seg">
          {(Object.keys(MODE_LABEL) as MeterMode[]).map((k) => (
            <button
              key={k}
              className={k === mode ? "active" : ""}
              onClick={() => onMode?.(k)}
            >
              {MODE_LABEL[k]}
            </button>
          ))}
        </div>
      </div>
      <div className="rpt-meters">
        {items.map((r) => {
          const enemy = playerTeamId != null && r.teamId !== playerTeamId;
          return (
            <div
              key={r.unitId}
              className="rpt-meter-row"
              title={`${r.name}: ${r.label}`}
            >
              <span
                className={enemy ? "rpt-meter-name enemy" : "rpt-meter-name"}
              >
                {r.name}
              </span>
              <span className="rpt-meter-bar-track">
                <span
                  className="rpt-meter-bar"
                  style={{ width: `${r.widthPct}%`, background: r.color }}
                />
              </span>
              <span className="rpt-meter-value">{r.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
