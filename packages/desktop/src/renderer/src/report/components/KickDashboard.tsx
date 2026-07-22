import { useState } from "react";

import { classColor } from "../data/gameConstants";
import type { KickDashRow } from "../derive/kickDash";

const fmtT = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * 打断仪表盘(backlog #2):两队每人 kick 命中/被骗/落空聚合 + 行展开逐条审计。
 * 与爆发账本的"打断审计"同一谓词(analyzeKickAudit),这里补敌方侧与全场对照;
 * 每条 ▶ 跳回放(findings 同一 seek 管线)。
 */
export function KickDashboard({
  rows,
  onSeek,
}: {
  rows: KickDashRow[];
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (rows.length === 0) return null;
  return (
    <div className="rpt-ledger" data-testid="kick-dash">
      <div className="rpt-ledger-head">
        <span className="rpt-ledger-title">打断面板</span>
      </div>
      <table className="rpt-stats">
        <thead>
          <tr>
            <th>玩家</th>
            <th>施放</th>
            <th>打断</th>
            <th>被骗</th>
            <th>落空</th>
            <th>命中率</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const expanded = !!open[r.unitId];
            return [
              <tr
                key={r.unitId}
                className={[
                  r.reaction === "Hostile" ? "rpt-stats-enemy" : "",
                  "rpt-stats-expandable",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() =>
                  setOpen((o) => ({ ...o, [r.unitId]: !o[r.unitId] }))
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
                  <span className="rpt-stats-caret">
                    {expanded ? " ▾" : " ▸"}
                  </span>
                </td>
                <td>{r.total}</td>
                <td>{r.landed}</td>
                <td>{r.juked}</td>
                <td>{r.missed}</td>
                <td className="rpt-stats-dim">
                  {r.landedRate === null
                    ? "—"
                    : `${Math.round(r.landedRate * 100)}%`}
                  {r.unknown > 0 ? `(${r.unknown} 未知)` : ""}
                </td>
              </tr>,
              expanded ? (
                <tr key={`${r.unitId}-d`} className="rpt-stats-detail-row">
                  <td colSpan={6}>
                    <div className="rpt-stats-detail-group">
                      {r.entries.map((k, i) => (
                        <span key={i} className="rpt-stats-detail-item">
                          <span className="rpt-stats-detail-t">
                            {fmtT(k.atSeconds)}
                          </span>{" "}
                          {k.kickSpellName}
                          {k.result === "landed" &&
                            ` 打断 ${k.interruptedSpellName ?? ""}`}
                          {k.result === "juked" &&
                            ` 被假读条骗掉(${k.jukedBySpellName ?? ""})`}
                          {k.result === "missed" && " 落空"}
                          {k.result === "unknown" && " 旧档无读条数据"}
                          {onSeek && (
                            <button
                              className="rpt-stats-detail-jump"
                              title="回放此刻"
                              onClick={() =>
                                onSeek(Math.max(0, k.atSeconds - 3), [r.name])
                              }
                            >
                              ▶
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
