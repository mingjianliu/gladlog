import { fmtTime } from "@gladlog/analysis";
import { useState } from "react";

import { classColor } from "../data/gameConstants";
import type { CastControlSummary } from "../derive/castControl";
import type { KickDashRow } from "../derive/kickDash";
import { UnitName } from "./UnitName";

/**
 * The kick dashboard (backlog #2): per-player landed/juked/missed kick
 * aggregates for both teams, with a per-cast audit when a row is expanded.
 * Same predicate as the burst ledger's "kick audit" (analyzeKickAudit); this
 * view adds the enemy side and a whole-match comparison. Each ▶ jumps to the
 * replay (the same seek pipeline as findings).
 */
export function KickDashboard({
  rows,
  castControl = null,
  onSeek,
}: {
  rows: KickDashRow[];
  /** The log recorder's own cast control (user request 2026-09-26); null =
   * not the recorder's log / streams not loaded yet — nothing is shown. */
  castControl?: CastControlSummary | null;
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const castStrip = castControl ? (
    <CastControlStrip c={castControl} onSeek={onSeek} />
  ) : null;
  // Keep the card shell on empty data (P1-1): the feature stays discoverable
  // in short rounds with no kicks
  if (rows.length === 0)
    return (
      <div className="rpt-ledger" data-testid="kick-dash">
        <div className="rpt-ledger-head">
          <span className="rpt-ledger-title">打断面板</span>
        </div>
        <p className="rpt-ledger-empty">
          本场双方 0 次打断施放 —— 长局中此处显示两队打断命中/被骗/落空审计。
        </p>
        {castStrip}
      </div>
    );
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
                  <UnitName name={r.name} full />
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
                            {fmtTime(k.atSeconds)}
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
      {castStrip}
    </div>
  );
}

/**
 * The recorder's own cast control: hardcasts, the ones they stopped
 * themselves (median progress), kicks eaten, and the enemy kicks those stops
 * baited — the same `ownerCastCancels` facts the coach menu's kick-eaten line
 * carries. A stopped cast is not called a fake: moving stops a cast bar too;
 * only a baited kick is shown as one.
 */
function CastControlStrip({
  c,
  onSeek,
}: {
  c: CastControlSummary;
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rpt-stats-detail-group" data-testid="cast-control">
      <span className="rpt-stats-detail-item">
        <UnitName name={c.name} full /> 读条 {c.hardcasts} 次 · 自己停手{" "}
        {c.cancels.length} 次
        {c.medianCancelPct !== null && `(中位读到 ${c.medianCancelPct}%)`} ·
        被打断 {c.kicked} 次 · 骗掉对方打断 {c.baitedKicks.length} 次
        {c.baitedKicks.length > 0 && (
          <button
            className="rpt-stats-detail-jump"
            title="展开被骗掉的打断"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "▾" : "▸"}
          </button>
        )}
      </span>
      {open &&
        c.baitedKicks.map((b, i) => (
          <span key={i} className="rpt-stats-detail-item">
            <span className="rpt-stats-detail-t">{fmtTime(b.atSeconds)}</span>{" "}
            <UnitName name={b.kickerName} /> 的 {b.kickSpellName} 被你停手的{" "}
            {b.baitSpellName} 骗掉
            {onSeek && (
              <button
                className="rpt-stats-detail-jump"
                title="回放此刻"
                onClick={() =>
                  onSeek(Math.max(0, b.atSeconds - 3), [c.name, b.kickerName])
                }
              >
                ▶
              </button>
            )}
          </span>
        ))}
    </div>
  );
}
