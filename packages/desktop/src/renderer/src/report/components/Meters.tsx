import { useEffect, useMemo, useState } from "react";

import { classGlyph } from "../data/gameConstants";
import { deriveDetailBreakdown } from "../derive/detailBreakdown";
import { type MeterMode, meterRows } from "../derive/meterRows";
import type { StatsRow } from "../derive/statsTable";
import type { UnitTotals } from "../derive/summary";
import type { ReportSource } from "../derive/types";
import { BreakdownTable } from "./BreakdownTable";
import { StatsTable } from "./StatsTable";

const MODE_LABEL: Record<MeterMode, string> = {
  damage: "伤害",
  healing: "治疗",
  taken: "承伤",
  stats: "统计",
};

export function Meters({
  rows,
  mode,
  onMode,
  playerTeamId,
  hidden,
  onToggleUnit,
  statsRows,
  durationS,
  onSeek,
  source,
}: {
  rows: UnitTotals[];
  mode: MeterMode;
  onMode?: (m: MeterMode) => void;
  playerTeamId?: number | null;
  /** 隐藏的 unitId 集合(用于生命曲线筛选);对应行变暗、圆点镂空。 */
  hidden?: Set<string>;
  onToggleUnit?: (unitId: string) => void;
  /** 「统计」模式数据(backlog #10);未传则不显示该模式。 */
  statsRows?: StatsRow[];
  durationS?: number;
  /** 统计明细的回放跳转(v2)。 */
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
  /** 明细展开数据源(backlog #11);未传则行不可展开(旧调用形态)。 */
  source?: ReportSource;
}) {
  // 行内明细展开:同一时刻只展开一人;切模式收起
  const [expandedUnitId, setExpandedUnitId] = useState<string | null>(null);
  useEffect(() => setExpandedUnitId(null), [mode]);
  const expandable = source != null && mode !== "stats";
  // 展开数据 memo:Meters 随回放 tick 等高频重渲,不能每帧重聚合
  const expandedData = useMemo(
    () =>
      expandable && expandedUnitId
        ? deriveDetailBreakdown(
            source,
            expandedUnitId,
            mode as "damage" | "healing" | "taken",
          )
        : null,
    [expandable, source, expandedUnitId, mode],
  );
  const items = meterRows(rows, mode === "stats" ? "damage" : mode);
  const modes = (Object.keys(MODE_LABEL) as MeterMode[]).filter(
    (k) => k !== "stats" || (statsRows?.length ?? 0) > 0,
  );
  return (
    <div className="rpt-meters-card">
      <div className="rpt-meters-head">
        <span className="rpt-card-label">榜单模式</span>
        <div className="rpt-mode-seg">
          {modes.map((k) => (
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
      {mode === "stats" && statsRows ? (
        <StatsTable
          rows={statsRows}
          durationS={durationS ?? 1}
          onSeek={onSeek}
        />
      ) : (
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
              <div key={r.unitId} className="rpt-meter-unit">
                <div
                  className={off ? "rpt-meter-row off" : "rpt-meter-row"}
                  title={`${r.name}: ${r.label}`}
                >
                  <button
                    type="button"
                    className={nameCls}
                    onClick={() => onToggleUnit?.(r.unitId)}
                  >
                    <span
                      className="rpt-meter-glyph"
                      style={
                        off
                          ? {
                              background: "transparent",
                              border: `1.5px solid ${r.color}`,
                              color: r.color,
                            }
                          : { background: r.color }
                      }
                    >
                      {classGlyph(r.classId)}
                    </span>
                    {r.name}
                  </button>
                  <span
                    className={
                      expandable
                        ? "rpt-meter-body rpt-meter-clickable"
                        : "rpt-meter-body"
                    }
                    onClick={
                      expandable
                        ? () =>
                            setExpandedUnitId((cur) =>
                              cur === r.unitId ? null : r.unitId,
                            )
                        : undefined
                    }
                  >
                    <span className="rpt-meter-bar-track">
                      <span
                        className="rpt-meter-bar"
                        style={{ width: `${r.widthPct}%`, background: r.color }}
                      />
                    </span>
                    <span className="rpt-meter-value">{r.label}</span>
                  </span>
                </div>
                {expandedData && expandedUnitId === r.unitId && (
                  <BreakdownTable
                    {...expandedData}
                    mode={mode as "damage" | "healing" | "taken"}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
