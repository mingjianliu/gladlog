import { fmtTime } from "@gladlog/analysis";
import { useState } from "react";

import { classColor } from "../data/gameConstants";
import type { AuraUptime, AuraUptimeRow } from "../derive/auraUptime";
import type { TimeRange } from "../derive/timeRange";
import { UnitName } from "./UnitName";

const BAR_W = 420;


/**
 * Aura uptime card (phase 4 ④): grouped by unit (P1-2) — a group header (class
 * color + name) with indented rows underneath; the bar area shares 0:00 / mid /
 * end ticks plus a 50% vertical line; the card header carries the category
 * legend.
 * Inferred segments (already active before the opening / never seen falling
 * off) are drawn with a dashed edge and never masquerade as observations. When
 * a time window is active the selection is drawn on the bar and percentages are
 * computed over the window (the same criterion as every other panel).
 */
export function AuraUptimeCard({
  data,
  range,
}: {
  data: AuraUptime;
  range?: TimeRange | null;
}) {
  const { groups, durationS } = data;
  const [openUnits, setOpenUnits] = useState<Set<string>>(new Set());
  if (groups.length === 0) return null;
  const x = (s: number) => (s / durationS) * BAR_W;

  const auraRow = (r: AuraUptimeRow) => (
    <tr
      key={`${r.unitId}:${r.spellId}`}
      className={r.reaction === "Hostile" ? "rpt-stats-enemy" : ""}
    >
      <td className="rpt-aura-spell rpt-aura-indent">{r.spellName}</td>
      <td className="rpt-aura-bar-cell">
        <svg
          viewBox={`0 0 ${BAR_W} 12`}
          className="rpt-aura-bar"
          preserveAspectRatio="none"
        >
          <rect
            x={0}
            y={0}
            width={BAR_W}
            height={12}
            className="rpt-aura-track"
          />
          <line
            x1={BAR_W / 2}
            y1={0}
            x2={BAR_W / 2}
            y2={12}
            className="rpt-aura-midline"
          />
          {range && (
            <rect
              x={x(range.fromS)}
              y={0}
              width={Math.max(1, x(range.toS) - x(range.fromS))}
              height={12}
              className="rpt-aura-window"
            />
          )}
          {r.intervals.map((iv, k) => (
            <rect
              key={k}
              x={x(iv.fromS)}
              y={2}
              width={Math.max(1.5, x(iv.toS) - x(iv.fromS))}
              height={8}
              className={[
                `rpt-aura-seg rpt-aura-${r.kind}`,
                iv.inferredStart || iv.inferredEnd ? "rpt-aura-inferred" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <title>
                {`${r.spellName} ${iv.fromS.toFixed(1)}–${iv.toS.toFixed(1)}s` +
                  (iv.inferredStart ? "(开局前已挂,推断)" : "") +
                  (iv.inferredEnd ? "(未见掉落,推断至场终)" : "")}
              </title>
            </rect>
          ))}
        </svg>
      </td>
      <td className="rpt-aura-pct">
        {r.uptimePct}%<span className="rpt-stats-dim"> ×{r.applications}</span>
        {r.hasInferred && (
          <span className="rpt-stats-dim" title="含推断段(虚线)">
            {" "}
            ⌁
          </span>
        )}
      </td>
    </tr>
  );

  return (
    <div className="rpt-ledger" data-testid="aura-uptime">
      <div className="rpt-ledger-head">
        <span className="rpt-ledger-title">光环 uptime</span>
        {range && (
          <span className="rpt-stats-dim">
            占比按窗口 {Math.round(range.toS - range.fromS)}s 口径
          </span>
        )}
        <span className="rpt-aura-legend">
          {(
            [
              ["offense", "进攻"],
              ["defense", "防御"],
              ["cc", "控制"],
            ] as const
          ).map(([k, label]) => (
            <span key={k} className="rpt-aura-legend-item">
              <svg viewBox="0 0 10 8" width={10} height={8}>
                <rect
                  width={10}
                  height={8}
                  className={`rpt-aura-seg rpt-aura-${k}`}
                />
              </svg>
              {label}
            </span>
          ))}
        </span>
      </div>
      <table className="rpt-stats rpt-aura-table">
        <tbody>
          {/* Shared scale row: 0:00 / mid / end ticks across the bar area */}
          <tr className="rpt-aura-scale-row">
            <td />
            <td className="rpt-aura-bar-cell">
              <div className="rpt-aura-scale">
                <span>0:00</span>
                <span>{fmtTime(durationS / 2)}</span>
                <span>{fmtTime(durationS)}</span>
              </div>
            </td>
            <td />
          </tr>
          {groups.map((g) => {
            const open = openUnits.has(g.unitId);
            return [
              <tr
                key={`h:${g.unitId}`}
                className={[
                  "rpt-aura-group-head",
                  g.reaction === "Hostile" ? "rpt-stats-enemy" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <td colSpan={3}>
                  <span
                    className="rpt-aura-glyph"
                    style={{ background: classColor(g.classId) }}
                  />
                  <UnitName name={g.unitName} />
                </td>
              </tr>,
              ...g.rows.map(auraRow),
              ...(open ? g.hiddenRows.map(auraRow) : []),
              g.hiddenRows.length > 0 && !open ? (
                <tr key={`m:${g.unitId}`}>
                  <td colSpan={3}>
                    <button
                      className="rpt-aura-more"
                      onClick={() =>
                        setOpenUnits((cur) => new Set(cur).add(g.unitId))
                      }
                    >
                      +{g.hiddenRows.length} 更低占比光环
                    </button>
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
