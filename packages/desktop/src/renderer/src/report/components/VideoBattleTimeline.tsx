import { useRef } from "react";

import { shortUnitName } from "../derive/teamSide";
import type { TimelineData } from "../derive/timeline";
import type { VulnBand } from "../derive/vulnWindows";

const W = 1200;
const H = 100;
const PAD = { l: 6, r: 6, t: 8, b: 8 };

/**
 * The recording page's "battle timeline" card (UI redesign 2a): the primary
 * seek surface — HP curves + gold bands + death crosses + playhead, where
 * clicking or dragging anywhere seeks the video; the thin progress bar in the
 * control strip is only for fine adjustment.
 *
 * The data is derived from the SAME SOURCE as the report (deriveTimeline /
 * deriveVulnBands are passed in by MatchReport, never recomputed here) —
 * having the death and burst-window glyph timestamps agree with the report is
 * a hard acceptance criterion. The drawing component is separate from
 * Timeline.tsx (that one is a 240px-tall interactive workbench with drag
 * selection, lanes, and axes; cramming it into a 96px seek surface would serve
 * neither purpose well).
 */
export function VideoBattleTimeline({
  data,
  bands,
  playerTeamId,
  curBattleS,
  onSeek,
  disabled = false,
}: {
  data: TimelineData;
  bands: VulnBand[];
  playerTeamId: number | null;
  /** Playhead (seconds relative to this match); null = no playback position
   * (no recording). */
  curBattleS: number | null;
  onSeek?: (battleS: number) => void;
  /** No recording: still render as usual (the data comes from the log), but do
   * not respond to seeks. */
  disabled?: boolean;
}) {
  const durS = Math.max(1, (data.end - data.start) / 1000);
  const dragging = useRef(false);
  const x = (s: number) =>
    PAD.l + (Math.min(Math.max(s, 0), durS) / durS) * (W - PAD.l - PAD.r);
  const y = (ratio: number) =>
    H - PAD.b - Math.min(Math.max(ratio, 0), 1) * (H - PAD.t - PAD.b);

  const seekFromEvent = (e: React.PointerEvent<SVGSVGElement>) => {
    if (disabled || !onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const battleS = ((vx - PAD.l) / Math.max(1, W - PAD.l - PAD.r)) * durS;
    onSeek(Math.min(Math.max(battleS, 0), durS));
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={disabled ? "rpt-video-bt-svg disabled" : "rpt-video-bt-svg"}
      data-testid="video-battle-timeline"
      role="slider"
      aria-label="战斗时间轴(点击或拖动定位录像)"
      aria-valuemin={0}
      aria-valuemax={Math.round(durS)}
      aria-valuenow={curBattleS != null ? Math.round(curBattleS) : 0}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        seekFromEvent(e);
      }}
      onPointerMove={(e) => {
        if (dragging.current) seekFromEvent(e);
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
    >
      {/* Gold / pressure bands (same deriveVulnBands as the report) */}
      {bands.map((b, i) => (
        <rect
          key={i}
          x={x(b.fromS)}
          y={PAD.t}
          width={Math.max(1, x(b.toS) - x(b.fromS))}
          height={H - PAD.t - PAD.b}
          fill={b.kind === "burst" ? "var(--gold)" : "var(--loss)"}
          opacity={b.kind === "burst" ? 0.18 : 0.1}
        />
      ))}
      {/* HP curves: friendlies in the win color, enemies in the loss color (a
          96px-tall seek surface does not use class colors); enemies are drawn
          at lower opacity (item 3.5-4-4) — the star of the seek surface is our
          own health lines, and eight lines at equal brightness smear into one
          blur at 96px. */}
      {data.series.map((s) => {
        if (s.points.length < 2) return null;
        const friendly = playerTeamId != null && s.teamId === playerTeamId;
        return (
          <path
            key={s.unitId}
            fill="none"
            stroke={friendly ? "var(--win)" : "var(--loss)"}
            strokeWidth={1.2}
            opacity={friendly ? 0.85 : 0.4}
            d={s.points
              .map(
                (p, j) =>
                  `${j === 0 ? "M" : "L"}${x((p.t - data.start) / 1000).toFixed(1)},${y(
                    p.maxHp > 0 ? p.hp / p.maxHp : 0,
                  ).toFixed(1)}`,
              )
              .join(" ")}
          />
        );
      })}
      {/* Death crosses (same timeline.deaths as the report, already filtered
          of fake deaths and non-players) */}
      {data.deaths.map((d, i) => (
        <text
          key={i}
          x={x((d.t - data.start) / 1000)}
          y={PAD.t + 10}
          textAnchor="middle"
          className="rpt-video-bt-death"
        >
          ✕<title>{shortUnitName(d.name)}</title>
        </text>
      ))}
      {/* Playhead */}
      {curBattleS != null && (
        <line
          x1={x(curBattleS)}
          x2={x(curBattleS)}
          y1={2}
          y2={H - 2}
          className="rpt-video-bt-head"
          data-testid="video-bt-playhead"
        />
      )}
    </svg>
  );
}
