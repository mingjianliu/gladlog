import { useState } from "react";

import { classColor } from "../data/gameConstants";
import type { StatsInstance, StatsRow } from "../derive/statsTable";

const fmtT = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

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
  if (items.length === 0) return null;
  return (
    <div className="rpt-stats-detail-group">
      <span className="rpt-stats-detail-title">{title}</span>
      {items.map((i, k) => (
        <span key={k} className="rpt-stats-detail-item">
          <span className="rpt-stats-detail-t">{fmtT(i.tS)}</span> {i.label}
          {onSeek && (
            <button
              className="rpt-stats-detail-jump"
              title="回放此刻"
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
 * 统计表(backlog #10):打断做/挨、被控秒数与占比、驱散/偷。列结构照抄
 * 旧仓 CombatCC 的信息密度;数据来自 deriveStatsTable(analysis 谓词)。
 * v2:行可展开明细,每条实例可跳回放(提前 3s 落点)。
 */
export function StatsTable({
  rows,
  durationS,
  onSeek,
}: {
  rows: StatsRow[];
  durationS: number;
  /** 证据链跳转(与 findings/死亡回顾同一 seek 管线)。 */
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const perMin = (n: number): string =>
    ((n * 60) / Math.max(1, durationS)).toFixed(1);
  return (
    <table className="rpt-stats" data-testid="stats-table">
      <thead>
        <tr>
          <th>玩家</th>
          <th colSpan={2}>打断施放</th>
          <th>被打断</th>
          <th colSpan={2}>被控</th>
          <th>驱散</th>
          <th>偷/purge</th>
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
                    title="打断施放"
                    items={r.detail.kicksCast}
                    unitName={r.name}
                    onSeek={onSeek}
                  />
                  <DetailGroup
                    title="被打断"
                    items={r.detail.kicksTaken}
                    unitName={r.name}
                    onSeek={onSeek}
                  />
                  <DetailGroup
                    title="被控"
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
