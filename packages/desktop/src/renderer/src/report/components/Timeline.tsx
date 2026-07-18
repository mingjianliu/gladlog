import { scaleLinear } from "d3-scale";
import { useState } from "react";

import { classColor } from "../data/gameConstants";
import type { TimelineData } from "../derive/timeline";
import type { VulnBand } from "../derive/vulnWindows";

const W = 800,
  H = 240,
  PAD = { l: 34, r: 8, t: 18, b: 18 };

/**
 * Catmull-Rom → 三次贝塞尔的平滑路径:每秒采样的 HP 折线直接连线太生硬。
 * 控制点 y 钳制在绘图区内,防止急降/急升处的过冲画出 >100% 或 <0% 的假象。
 */
function smoothPath(
  pts: Array<{ x: number; y: number }>,
  yMin: number,
  yMax: number,
): string {
  if (pts.length === 0) return "";
  if (pts.length < 3)
    return pts
      .map(
        (p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`,
      )
      .join(" ");
  const cy = (v: number) => Math.max(yMin, Math.min(yMax, v));
  // 端点 y 也钳制(logging 抖动可能给出 >100%/<0% 的比值,控制点钳而端点
  // 不钳会在边界处画出折角);控制点 x 钳在段内,非均匀采样时防时间轴回弯。
  const P = pts.map((p) => ({ x: p.x, y: cy(p.y) }));
  let d = `M${P[0]!.x.toFixed(1)},${P[0]!.y.toFixed(1)}`;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)]!;
    const p1 = P[i]!;
    const p2 = P[i + 1]!;
    const p3 = P[Math.min(P.length - 1, i + 2)]!;
    const cx = (v: number) => Math.max(p1.x, Math.min(p2.x, v));
    const c1x = cx(p1.x + (p2.x - p0.x) / 6);
    const c1y = cy(p1.y + (p2.y - p0.y) / 6);
    const c2x = cx(p2.x - (p3.x - p1.x) / 6);
    const c2y = cy(p2.y - (p3.y - p1.y) / 6);
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

export function Timeline({
  data,
  onSelectUnit,
  hidden,
  onDeathClick,
  bands,
  onBandClick,
  cursorT,
}: {
  data: TimelineData;
  onSelectUnit?: (unitId: string) => void;
  /** 隐藏的 unitId 集合:这些玩家的生命曲线/死亡标记不画。 */
  hidden?: Set<string>;
  /** 死亡标记点击 → 打开死亡回顾(backlog #6)。t 为绝对 ms。 */
  onDeathClick?: (unitId: string, t: number) => void;
  /** KILL WINDOW/VULNERABLE 背景色带(相对秒);点击 → 回放该时刻。 */
  bands?: VulnBand[];
  onBandClick?: (tSeconds: number) => void;
  /** 回放光标投影(1c):从回放切回时的最后时刻(绝对 ms)。 */
  cursorT?: number | null;
}) {
  const [cursor, setCursor] = useState<number | null>(null);
  const series = hidden
    ? data.series.filter((s) => !hidden.has(s.unitId))
    : data.series;
  const deaths = hidden
    ? data.deaths.filter((d) => !hidden.has(d.unitId))
    : data.deaths;
  const x = scaleLinear()
    .domain([data.start, data.end])
    .range([PAD.l, W - PAD.r]);
  const y = scaleLinear()
    .domain([0, 1])
    .range([H - PAD.b, PAD.t]);
  const relSec = (t: number) => ((t - data.start) / 1000).toFixed(1);

  return (
    <div className="rpt-timeline-wrap">
      <svg
        data-testid="rpt-timeline"
        viewBox={`0 0 ${W} ${H}`}
        className="rpt-timeline"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setCursor(((e.clientX - rect.left) / rect.width) * W);
        }}
        onMouseLeave={() => setCursor(null)}
      >
        {[0, 0.5, 1].map((p) => (
          <g key={p}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(p)}
              y2={y(p)}
              className="rpt-tl-grid"
            />
            <text x={4} y={y(p) + 4} className="rpt-tl-axis">
              {Math.round(p * 100)}%
            </text>
          </g>
        ))}
        {(bands ?? []).map((b, i) => {
          const fromX = x(data.start + b.fromS * 1000);
          const toX = x(data.start + b.toS * 1000);
          return (
            <rect
              key={`band${i}`}
              data-testid="tl-band"
              className={`rpt-tl-band rpt-tl-band-${b.kind}`}
              x={fromX}
              y={PAD.t}
              width={Math.max(2, toX - fromX)}
              height={H - PAD.t - PAD.b}
              onClick={onBandClick ? () => onBandClick(b.fromS) : undefined}
              style={{ cursor: onBandClick ? "pointer" : undefined }}
            >
              <title>
                {(b.kind === "burst"
                  ? `击杀尝试 on ${b.targetName}(团队伤害 ${(b.damage / 1000).toFixed(0)}k)`
                  : `${b.targetName} 脆弱且未被惩罚`) +
                  (onBandClick ? "(点击回放)" : "")}
              </title>
            </rect>
          );
        })}
        {series.map((s) => (
          <path
            key={s.unitId}
            className="rpt-tl-line"
            fill="none"
            stroke={classColor(s.classId)}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            style={{ cursor: onSelectUnit ? "pointer" : undefined }}
            onClick={() => onSelectUnit?.(s.unitId)}
            d={smoothPath(
              s.points.map((p) => ({
                x: x(p.t),
                y: y(p.maxHp > 0 ? p.hp / p.maxHp : 0),
              })),
              PAD.t,
              H - PAD.b,
            )}
          >
            <title>{s.name}</title>
          </path>
        ))}
        {/* 死亡标记(1c):圆点 + ✕ + 上方名字·时间标注 */}
        {deaths.map((d, i) => (
          <g
            key={i}
            className={
              onDeathClick ? "rpt-tl-death rpt-tl-death-click" : "rpt-tl-death"
            }
            transform={`translate(${x(d.t).toFixed(1)},${PAD.t})`}
            onClick={
              onDeathClick ? () => onDeathClick(d.unitId, d.t) : undefined
            }
          >
            <circle r={5} className="rpt-tl-death-dot" />
            <text y={2.6} className="rpt-tl-death-x" textAnchor="middle">
              ✕
            </text>
            <text y={-8} className="rpt-tl-death-label" textAnchor="middle">
              {d.name.split("-")[0]} {relSec(d.t)}s
            </text>
            <title>{`${d.name} 死亡 @ ${relSec(d.t)}s${onDeathClick ? " — 点击看死亡回顾" : ""}`}</title>
          </g>
        ))}
        {/* 回放光标投影(1c):accent 虚线 + 时间标签 */}
        {cursorT != null && cursorT >= data.start && cursorT <= data.end && (
          <g className="rpt-tl-replay-cursor" data-testid="tl-replay-cursor">
            <line
              x1={x(cursorT)}
              x2={x(cursorT)}
              y1={PAD.t}
              y2={H - PAD.b}
              stroke="var(--accent)"
              strokeDasharray="3 3"
            />
            <text
              x={x(cursorT) + 4}
              y={PAD.t + 9}
              className="rpt-tl-axis"
              fill="var(--accent)"
            >
              回放 {relSec(cursorT)}s
            </text>
          </g>
        )}
        {cursor !== null && cursor >= PAD.l && cursor <= W - PAD.r ? (
          <g>
            <line
              x1={cursor}
              x2={cursor}
              y1={PAD.t - 12}
              y2={H - PAD.b}
              className="rpt-tl-cursor"
            />
            <text x={cursor + 4} y={PAD.t - 4} className="rpt-tl-axis">
              {relSec(x.invert(cursor))}s
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}
