import { type MeterMode, meterRows } from "../derive/meterRows";
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
  hidden,
  onToggleUnit,
}: {
  rows: UnitTotals[];
  mode: MeterMode;
  onMode?: (m: MeterMode) => void;
  playerTeamId?: number | null;
  /** 隐藏的 unitId 集合(用于生命曲线筛选);对应行变暗、圆点镂空。 */
  hidden?: Set<string>;
  onToggleUnit?: (unitId: string) => void;
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
          const off = hidden?.has(r.unitId) ?? false;
          const nameCls = [
            "rpt-meter-name",
            enemy ? "enemy" : "",
            off ? "off" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <div
              key={r.unitId}
              className={off ? "rpt-meter-row off" : "rpt-meter-row"}
              title={`${r.name}: ${r.label}`}
            >
              <button
                type="button"
                className={nameCls}
                onClick={() => onToggleUnit?.(r.unitId)}
              >
                <span
                  className="rpt-meter-dot"
                  style={{
                    background: off ? "transparent" : r.color,
                    borderColor: r.color,
                  }}
                />
                {r.name}
              </button>
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
