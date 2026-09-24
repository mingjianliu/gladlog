import { useState } from "react";

import { DR_LEVEL_LABEL, fmtTime } from "@gladlog/analysis";

import { classColor } from "../data/gameConstants";
import type { CCChainRow } from "../derive/ccChainDash";
import { UnitName } from "./UnitName";


/**
 * Enemy CC-chain panel (#10 T5): per enemy target, an aggregate of the CC
 * chains we applied (chain length / total duration), plus a row expansion
 * listing each application's DR tier, with 25% / Immune marked red (wasted
 * CC). Every judgment consumes analysis's analyzeOutgoingCCChains (the same
 * predicate as the timeline's [DR] annotation); the DR sequence is never
 * rebuilt here. Conventions copied from KickDashboard (row expansion, empty
 * state keeps the card shell, ▶ seeks the replay).
 */
export function CCChainPanel({
  rows,
  onSeek,
}: {
  rows: CCChainRow[];
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Keep the card shell on empty data (P1-1): the feature stays discoverable
  // in short rounds with no CC chains
  if (rows.length === 0)
    return (
      <div className="rpt-ledger" data-testid="cc-chain-dash">
        <div className="rpt-ledger-head">
          <span className="rpt-ledger-title">敌方 CC 链</span>
        </div>
        <p className="rpt-ledger-empty">
          本场未对敌方造成过控制链 —— 长局中此处显示每个敌方目标的控制链长度/
          总时长与 DR 降级情况。
        </p>
      </div>
    );
  return (
    <div className="rpt-ledger" data-testid="cc-chain-dash">
      <div className="rpt-ledger-head">
        <span className="rpt-ledger-title">敌方 CC 链</span>
      </div>
      <table className="rpt-stats">
        <thead>
          <tr>
            <th>目标</th>
            <th>链长</th>
            <th>总控时长</th>
            <th>DR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const expanded = !!open[r.targetName];
            return [
              <tr
                key={r.targetName}
                className="rpt-stats-enemy rpt-stats-expandable"
                onClick={() =>
                  setOpen((o) => ({ ...o, [r.targetName]: !o[r.targetName] }))
                }
              >
                <td>
                  {r.targetClassId !== undefined && (
                    <span
                      className="rpt-meter-dot"
                      style={{
                        background: classColor(r.targetClassId),
                        borderColor: classColor(r.targetClassId),
                      }}
                    />
                  )}
                  <UnitName name={r.targetName} full />
                  <span className="rpt-stats-caret">
                    {expanded ? " ▾" : " ▸"}
                  </span>
                </td>
                <td>{r.chainLen}</td>
                <td>{r.totalCcSeconds.toFixed(1)}s</td>
                <td>
                  {r.wasted ? (
                    <span className="rpt-ledger-chip rpt-ledger-chip-bad">
                      浪费
                    </span>
                  ) : (
                    <span className="rpt-stats-dim">—</span>
                  )}
                </td>
              </tr>,
              expanded ? (
                <tr key={`${r.targetName}-d`} className="rpt-stats-detail-row">
                  <td colSpan={4}>
                    <div className="rpt-stats-detail-group">
                      {r.apps.map((a, i) => {
                        const isWasted =
                          a.drInfo.level === "25%" ||
                          a.drInfo.level === "Immune";
                        return (
                          <span
                            key={`${a.atSeconds}-${a.spellId}-${i}`}
                            className="rpt-stats-detail-item"
                          >
                            <span className="rpt-stats-detail-t">
                              {fmtTime(a.atSeconds)}
                            </span>{" "}
                            {a.spellName} · {a.casterName} ·{" "}
                            {isWasted ? (
                              <span className="rpt-ledger-chip rpt-ledger-chip-bad">
                                {DR_LEVEL_LABEL[a.drInfo.level]}
                              </span>
                            ) : (
                              DR_LEVEL_LABEL[a.drInfo.level]
                            )}
                            {onSeek && (
                              <button
                                className="rpt-stats-detail-jump"
                                title="回放此刻"
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  onSeek(Math.max(0, a.atSeconds - 3), [
                                    a.casterName,
                                    r.targetName,
                                  ]);
                                }}
                              >
                                ▶
                              </button>
                            )}
                          </span>
                        );
                      })}
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
