import { fmtTime } from "@gladlog/analysis";
import { useState } from "react";

import { classColor } from "../data/gameConstants";
import type { DispelDash, DispelInstance } from "../derive/dispelDash";
import { UnitName } from "./UnitName";


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
          <span className="rpt-stats-detail-t">{fmtTime(i.tS)}</span> {i.label}
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
 * Dispel dashboard (backlog #3): the completed ledger (cleanses / purges /
 * steals per player, both sides) + the missed opportunities (missed purges /
 * missed cleanses) + the cleanse rate on dispellable CC affecting allies. The
 * data comes from deriveDispelDash (reconstructDispelSummary, the same predicate
 * as the prompt side); each ▶ jumps into the replay.
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
  // Keep the card shell even with no data (P1-1)
  if (!hasAnything)
    return (
      <div className="rpt-ledger" data-testid="dispel-dash">
        <div className="rpt-ledger-head">
          <span className="rpt-ledger-title">驱散面板</span>
        </div>
        <p className="rpt-ledger-empty">本场无驱散/偷取事件。</p>
      </div>
    );
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
              <th title="被动触发 / 位移附带的驱散,不计入决策">被动</th>
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
                    <UnitName name={r.name} full />
                    <span className="rpt-stats-caret">
                      {expanded ? " ▾" : " ▸"}
                    </span>
                  </td>
                  <td>{r.cleanses}</td>
                  <td>{r.purges}</td>
                  <td>{r.steals}</td>
                  <td className="rpt-stats-dim">{r.passive}</td>
                </tr>,
                expanded ? (
                  <tr key={`${r.unitId}-d`} className="rpt-stats-detail-row">
                    <td colSpan={5}>
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
              <span>
                <UnitName name={s.targetName} full />
              </span>
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
