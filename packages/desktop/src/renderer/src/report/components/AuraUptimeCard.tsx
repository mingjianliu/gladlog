import { classColor } from "../data/gameConstants";
import type { AuraUptime } from "../derive/auraUptime";
import type { TimeRange } from "../derive/timeRange";

const BAR_W = 420;

/**
 * 光环 uptime 卡(第四阶段④):每玩家 进攻增益/防御/控制 光环的区间条 +
 * 窗口内占比。推断段(开局已挂/未见掉落)画虚线边,不冒充观测;时间窗
 * 激活时条上画选区、占比按窗口算(与其余面板同口径)。
 */
export function AuraUptimeCard({
  data,
  range,
}: {
  data: AuraUptime;
  range?: TimeRange | null;
}) {
  const { rows, durationS } = data;
  if (rows.length === 0) return null;
  const x = (s: number) => (s / durationS) * BAR_W;
  return (
    <div className="rpt-ledger" data-testid="aura-uptime">
      <div className="rpt-ledger-head">
        <span className="rpt-ledger-title">光环 uptime</span>
        {range && (
          <span className="rpt-stats-dim">
            占比按窗口 {Math.round(range.toS - range.fromS)}s 口径
          </span>
        )}
      </div>
      <table className="rpt-stats rpt-aura-table">
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.unitId}:${r.spellId}`}
              className={r.reaction === "Hostile" ? "rpt-stats-enemy" : ""}
            >
              <td className="rpt-aura-name">
                <span
                  className="rpt-meter-dot"
                  style={{
                    background: classColor(r.classId),
                    borderColor: classColor(r.classId),
                  }}
                />
                {r.unitName.split("-")[0]}
              </td>
              <td className="rpt-aura-spell">{r.spellName}</td>
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
                        iv.inferredStart || iv.inferredEnd
                          ? "rpt-aura-inferred"
                          : "",
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
                {r.uptimePct}%
                <span className="rpt-stats-dim"> ×{r.applications}</span>
                {r.hasInferred && (
                  <span className="rpt-stats-dim" title="含推断段(虚线)">
                    {" "}
                    ⌁
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
