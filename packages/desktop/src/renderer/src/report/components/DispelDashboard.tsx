import { useState } from "react";

import { classColor } from "../data/gameConstants";
import type { DispelDash, DispelInstance } from "../derive/dispelDash";

const fmtT = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function InstanceList({
  items,
  onSeek,
}: {
  items: DispelInstance[];
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
}) {
  return (
    <div className="rpt-stats-detail-group">
      {items.map((i, k) => (
        <span key={k} className="rpt-stats-detail-item">
          <span className="rpt-stats-detail-t">{fmtT(i.tS)}</span> {i.label}
          {onSeek && (
            <button
              className="rpt-stats-detail-jump"
              title="回放此刻"
              onClick={() => onSeek(Math.max(0, i.tS - 3), [i.unitName])}
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
 * 驱散仪表盘(backlog #3):完成的账目(每人 解/purge/偷,双向)+ 漏掉的机会
 * (漏 purge / 漏解)+ 友方可解 CC 解除率。数据来自 deriveDispelDash
 * (reconstructDispelSummary,与 prompt 侧同一谓词);每条 ▶ 跳回放。
 */
export function DispelDashboard({
  dash,
  onSeek,
}: {
  dash: DispelDash;
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const { rows, missedPurges, missedCleanses, ccEfficiency } = dash;
  const hasAnything =
    rows.length + missedPurges.length + missedCleanses.length > 0;
  if (!hasAnything) return null;
  return (
    <div className="rpt-ledger" data-testid="dispel-dash">
      <div className="rpt-ledger-head">
        <span className="rpt-ledger-title">驱散面板</span>
      </div>
      {rows.length > 0 && (
        <table className="rpt-stats">
          <thead>
            <tr>
              <th>玩家</th>
              <th>解队友</th>
              <th>purge</th>
              <th>偷</th>
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
                  <td>{r.cleanses}</td>
                  <td>{r.purges}</td>
                  <td>{r.steals}</td>
                </tr>,
                expanded ? (
                  <tr key={`${r.unitId}-d`} className="rpt-stats-detail-row">
                    <td colSpan={4}>
                      <InstanceList items={r.events} onSeek={onSeek} />
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      )}
      {missedPurges.length > 0 && (
        <div className="rpt-ledger-section">
          <span className="rpt-stats-detail-title">
            漏掉的 purge 机会({missedPurges.length})
          </span>
          <InstanceList items={missedPurges} onSeek={onSeek} />
        </div>
      )}
      {missedCleanses.length > 0 && (
        <div className="rpt-ledger-section">
          <span className="rpt-stats-detail-title">
            漏掉的解控/解 debuff({missedCleanses.length})
          </span>
          <InstanceList items={missedCleanses} onSeek={onSeek} />
        </div>
      )}
      {ccEfficiency.length > 0 && (
        <div className="rpt-ledger-section">
          <span className="rpt-stats-detail-title">友方可解 CC 解除率</span>
          {ccEfficiency.map((s, i) => (
            <div key={i} className="rpt-ledger-row">
              <span>{s.targetName}</span>
              <span className="rpt-stats-dim">
                解 {s.cleanseCount} / 漏 {s.missedCount}
                {s.brokenCount > 0 ? ` / 被伤害打破 ${s.brokenCount}` : ""}
                {s.cleanseCount + s.missedCount > 0
                  ? ` — 解除率 ${Math.round(s.cleanseRate * 100)}%`
                  : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
