import { fmtTime } from "@gladlog/analysis";
import { useState } from "react";

import { useT } from "../../i18n/LangProvider";
import { classColor } from "../data/gameConstants";
import type { StatsInstance, StatsRow } from "../derive/statsTable";

function DetailGroup({
  title,
  items,
  unitName,
  onSeek,
}: {
  title: string;
  items: StatsInstance[];
  unitName: string;
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
}) {
  const { t } = useT();
  if (items.length === 0) return null;
  return (
    <div className="rpt-stats-detail-group">
      <span className="rpt-stats-detail-title">{title}</span>
      {items.map((i, k) => (
        <span key={k} className="rpt-stats-detail-item">
          <span className="rpt-stats-detail-t">{fmtTime(i.tS)}</span> {i.label}
          {onSeek && (
            <button
              className="rpt-stats-detail-jump"
              title={t("report.common.replayHere")}
              onClick={() => onSeek(Math.max(0, i.tS - 3), [unitName])}
            >
              ▶
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

/**
 * Stats table (backlog #10): interrupts cast/taken, seconds spent under CC and
 * its share, dispels/purges. The column structure copies the information
 * density of the old repo's CombatCC; the data comes from deriveStatsTable
 * (analysis predicates).
 * v2: rows expand into details, and each instance can jump into the replay
 * (landing 3s early).
 */
export function StatsTable({
  rows,
  durationS,
  onSeek,
}: {
  rows: StatsRow[];
  durationS: number;
  /** Evidence-chain jump (the same seek pipeline as findings / death
   * review). */
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const perMin = (n: number): string =>
    ((n * 60) / Math.max(1, durationS)).toFixed(1);
  return (
    <table className="rpt-stats" data-testid="stats-table">
      <thead>
        <tr>
          <th>{t("report.common.player")}</th>
          <th colSpan={2}>{t("report.statsTable.kicksCast")}</th>
          <th>{t("report.statsTable.kicksTaken")}</th>
          <th colSpan={2}>{t("report.statsTable.ccTaken")}</th>
          <th>{t("report.statsTable.dispels")}</th>
          <th>{t("report.statsTable.purges")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const expandable =
            r.detail.kicksCast.length +
              r.detail.kicksTaken.length +
              r.detail.ccTaken.length >
            0;
          const expanded = !!open[r.unitId];
          return [
            <tr
              key={r.unitId}
              className={[
                r.reaction === "Hostile" ? "rpt-stats-enemy" : "",
                expandable ? "rpt-stats-expandable" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={
                expandable
                  ? () => setOpen((o) => ({ ...o, [r.unitId]: !o[r.unitId] }))
                  : undefined
              }
            >
              <td>
                <span
                  className="rpt-meter-dot"
                  style={{
                    background: classColor(r.classId),
                    borderColor: classColor(r.classId),
                  }}
                />
                {r.name}
                {expandable ? (
                  <span className="rpt-stats-caret">
                    {expanded ? " ▾" : " ▸"}
                  </span>
                ) : null}
              </td>
              <td>{r.kicksCast}</td>
              <td className="rpt-stats-dim">{perMin(r.kicksCast)}/min</td>
              <td>{r.kicksTaken}</td>
              <td>{r.ccTakenS.toFixed(1)}s</td>
              <td className="rpt-stats-dim">{r.ccTakenPct}%</td>
              <td>{r.cleanses}</td>
              <td>{r.purges}</td>
            </tr>,
            expanded ? (
              <tr key={`${r.unitId}-d`} className="rpt-stats-detail-row">
                <td colSpan={8}>
                  <DetailGroup
                    title={t("report.statsTable.kicksCast")}
                    items={r.detail.kicksCast}
                    unitName={r.name}
                    onSeek={onSeek}
                  />
                  <DetailGroup
                    title={t("report.statsTable.kicksTaken")}
                    items={r.detail.kicksTaken}
                    unitName={r.name}
                    onSeek={onSeek}
                  />
                  <DetailGroup
                    title={t("report.statsTable.ccTaken")}
                    items={r.detail.ccTaken}
                    unitName={r.name}
                    onSeek={onSeek}
                  />
                </td>
              </tr>
            ) : null,
          ];
        })}
      </tbody>
    </table>
  );
}
