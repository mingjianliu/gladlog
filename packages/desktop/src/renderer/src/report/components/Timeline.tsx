import { scaleLinear } from "d3-scale";
import { useState } from "react";
import type { TimelineData } from "../derive/timeline";
import { classColor } from "../data/gameConstants";

const W = 800,
  H = 220,
  PAD = { l: 34, r: 8, t: 18, b: 18 };

export function Timeline({
  data,
  onSelectUnit,
}: {
  data: TimelineData;
  onSelectUnit?: (unitId: string) => void;
}) {
  const [cursor, setCursor] = useState<number | null>(null);
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
        {data.series.map((s) => (
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
        {data.deaths.map((d, i) => (
          <g
            key={i}
            className="rpt-tl-death"
            transform={`translate(${x(d.t).toFixed(1)},${PAD.t})`}
          >
            <path d="M-5,-10 L5,-10 L0,0 Z" />
            <title>{`${d.name} 死亡 @ ${relSec(d.t)}s`}</title>
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
