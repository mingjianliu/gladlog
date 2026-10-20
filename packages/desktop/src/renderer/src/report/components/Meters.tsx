import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { deriveDetailBreakdown } from "../derive/detailBreakdown";
import { meterGroups, type MeterMode, meterRows } from "../derive/meterRows";
import type { StatsRow } from "../derive/statsTable";
import type { UnitTotals } from "../derive/summary";
import { TEAM_SIDE_LABEL, type TeamSide } from "../derive/teamSide";
import type { TimeRange } from "../derive/timeRange";
import type { ReportSource } from "../derive/types";
import { BreakdownTable } from "./BreakdownTable";
import { MeterUnitRow } from "./MeterUnitRow";
import { StatsTable } from "./StatsTable";
import { TeamDot } from "./TeamDot";

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
  hidden,
  onToggleUnit,
  statsRows,
  durationS,
  onSeek,
  source,
  range,
  teamSides,
}: {
  rows: UnitTotals[];
  mode: MeterMode;
  onMode?: (m: MeterMode) => void;
  /** Set of hidden unitIds (used by the HP-curve filter); the matching rows
   * dim and their dots become hollow. */
  hidden?: Set<string>;
  onToggleUnit?: (unitId: string) => void;
  /** Data for the "stats" mode (backlog #10); when absent, that mode is not
   * shown. */
  statsRows?: StatsRow[];
  durationS?: number;
  /** Replay seek from the stats detail rows (v2). */
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
  /** Data source for the expandable detail rows (backlog #11); when absent,
   * rows are not expandable (the older call shape). */
  source?: ReportSource;
  /** Time-window linkage (1): passed down to the detail breakdown so it uses
   * the same scope as the leaderboard totals. */
  range?: TimeRange | null;
  /** unitId → side. Present = the leaderboard splits into 我方 / 敌方 blocks
   * and every row gets a team dot. Absent (the faithfulness harness renders
   * `<Meters rows mode />` bare) = exactly the previous flat list. */
  teamSides?: Map<string, TeamSide>;
}) {
  // Inline detail expansion: only one unit expanded at a time; switching mode
  // collapses it
  const [expandedUnitId, setExpandedUnitId] = useState<string | null>(null);
  useEffect(() => setExpandedUnitId(null), [mode]);
  // Stable identity so MeterUnitRow's memo holds across replay ticks.
  const toggleExpand = useCallback(
    (id: string) => setExpandedUnitId((cur) => (cur === id ? null : id)),
    [],
  );
  const expandable = source != null && mode !== "stats";
  // Memoize the expanded data: Meters re-renders at high frequency (e.g. with
  // every replay tick), so it must not re-aggregate on every frame
  const expandedData = useMemo(
    () =>
      expandable && expandedUnitId
        ? deriveDetailBreakdown(
            source,
            expandedUnitId,
            mode as "damage" | "healing" | "taken",
            range,
          )
        : null,
    [expandable, source, expandedUnitId, mode, range],
  );
  const items = meterRows(rows, mode === "stats" ? "damage" : mode);
  const sideOf = (unitId: string): TeamSide =>
    teamSides?.get(unitId) ?? "unknown";
  // Ordering comes from the derive, not from here — see meterGroups' note about
  // the positional faithfulness check.
  const groups = meterGroups(items, teamSides ? sideOf : undefined);
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
          {groups.map((g) => (
            <Fragment key={g.side}>
              {/* Heading only when the list is actually split — a single
                  "unknown" group is the old flat list and must stay that way. */}
              {groups.length > 1 && (
                <div className="rpt-team-head" data-testid="meter-team-head">
                  <TeamDot side={g.side} />
                  {TEAM_SIDE_LABEL[g.side]}
                </div>
              )}
              {/* Row markup lives in MeterUnitRow (UI review #6): one identity
                  element (spec icon + side ring) instead of glyph + team dot,
                  memoised per row, and the async icon hook runs per component. */}
              {g.rows.map((r) => (
                <div key={r.unitId} className="rpt-meter-unit">
                  <MeterUnitRow
                    row={r}
                    side={sideOf(r.unitId)}
                    off={hidden?.has(r.unitId) ?? false}
                    expandable={expandable}
                    onToggleUnit={onToggleUnit}
                    onToggleExpand={toggleExpand}
                  />
                  {expandedData && expandedUnitId === r.unitId && (
                    <BreakdownTable
                      {...expandedData}
                      mode={mode as "damage" | "healing" | "taken"}
                    />
                  )}
                </div>
              ))}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
