import { scaleLinear } from "d3-scale";
import { useState } from "react";

import { classColor } from "../data/gameConstants";
import type { TimelineData } from "../derive/timeline";
import type { VulnBand } from "../derive/vulnWindows";

const W = 800,
  H = 220,
  PAD = { l: 34, r: 8, t: 18, b: 18 };

export function Timeline({
  data,
  onSelectUnit,
  hidden,
  onDeathClick,
  bands,
  onBandClick,
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
              onClick={
                onBandClick ? () => onBandClick(b.fromS) : undefined
              }
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
            strokeWidth={1.5}
            style={{ cursor: onSelectUnit ? "pointer" : undefined }}
            onClick={() => onSelectUnit?.(s.unitId)}
            d={s.points
              .map(
                (p, i) =>
                  `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.maxHp > 0 ? p.hp / p.maxHp : 0).toFixed(1)}`,
              )
              .join(" ")}
          >
            <title>{s.name}</title>
          </path>
        ))}
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
            <path d="M-5,-10 L5,-10 L0,0 Z" />
            <title>{`${d.name} 死亡 @ ${relSec(d.t)}s${onDeathClick ? " — 点击看死亡回顾" : ""}`}</title>
          </g>
        ))}
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
