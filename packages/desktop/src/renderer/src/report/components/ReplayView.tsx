import { useEffect, useMemo, useRef, useState } from "react";

import { classColor, classGlyph } from "../data/gameConstants";
import {
  deathPosition,
  deriveReplay,
  pathUpTo,
  sampleAt,
} from "../derive/replay";
import type { ReportSource } from "../derive/types";

const VW = 520;
const VH = 520;
const PAD = 46;
const GRID = 4;
const SPEEDS = [1, 2, 4] as const;

const reactionRing = (reaction: string): string =>
  reaction === "Friendly"
    ? "var(--win)"
    : reaction === "Hostile"
      ? "var(--loss)"
      : "var(--mute)";

const hpColor = (f: number): string =>
  f > 0.6 ? "var(--win)" : f >= 0.3 ? "var(--gold)" : "var(--loss)";

const relTime = (t: number, start: number): string => {
  const s = Math.max(0, (t - start) / 1000);
  return `${Math.floor(s / 60)}:${Math.floor(s % 60)
    .toString()
    .padStart(2, "0")}`;
};

export function ReplayView({ source }: { source: ReportSource }) {
  const data = useMemo(() => deriveReplay(source), [source]);
  const { startTime, endTime, bounds, tracks } = data;

  const [t, setT] = useState(startTime);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const prevRef = useRef<number>(0);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    prevRef.current = performance.now();
    const step = (now: number) => {
      const dt = now - prevRef.current;
      prevRef.current = now;
      setT((cur) => {
        const nt = cur + dt * speed;
        if (nt >= endTime) {
          setPlaying(false);
          return endTime;
        }
        return nt;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, endTime, speed]);

  if (tracks.length === 0) {
    return (
      <div className="rpt-replay rpt-replay-empty">
        <p className="rpt-dim">
          无位置数据 —— 该场没有高级战斗日志(advancedSamples),无法回放走位。
        </p>
      </div>
    );
  }

  const spanX = bounds.maxX - bounds.minX || 1;
  const spanY = bounds.maxY - bounds.minY || 1;
  const scale = Math.min((VW - 2 * PAD) / spanX, (VH - 2 * PAD) / spanY);
  const aw = spanX * scale;
  const ah = spanY * scale;
  const offX = (VW - aw) / 2;
  const offY = (VH - ah) / 2;
  // WoW y 向北为正 → 反转,使北在上方
  const toX = (x: number): number => offX + (x - bounds.minX) * scale;
  const toY = (y: number): number => offY + (bounds.maxY - y) * scale;

  const cxA = offX + aw / 2;
  const cyA = offY + ah / 2;
  const pillarR = Math.min(aw, ah) * 0.085;
  const pillars = [
    { x: offX + aw * 0.34, y: offY + ah * 0.42 },
    { x: offX + aw * 0.66, y: offY + ah * 0.58 },
  ];

  const atEnd = t >= endTime;

  return (
    <div className="rpt-replay">
      <svg
        className="rpt-replay-field"
        viewBox={`0 0 ${VW} ${VH}`}
        data-testid="rpt-replay-field"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <radialGradient id="rpt-arena-floor" cx="50%" cy="50%" r="70%">
            <stop offset="0%" stopColor="var(--surface-2)" />
            <stop offset="100%" stopColor="var(--bg)" />
          </radialGradient>
        </defs>
        <rect
          x={offX}
          y={offY}
          width={aw}
          height={ah}
          rx={6}
          className="rpt-replay-arena"
          fill="url(#rpt-arena-floor)"
        />
        {/* 中央区域微光带 */}
        <circle
          cx={cxA}
          cy={cyA}
          r={Math.min(aw, ah) * 0.4}
          className="rpt-replay-zone"
        />
        {/* 立柱(空间锚点) */}
        {pillars.map((p, i) => (
          <g key={`p${i}`}>
            <circle
              cx={p.x}
              cy={p.y}
              r={pillarR}
              className="rpt-replay-pillar"
            />
            <circle
              cx={p.x}
              cy={p.y}
              r={pillarR * 0.6}
              className="rpt-replay-pillar-inner"
            />
          </g>
        ))}
        {/* 网格线 */}
        {Array.from({ length: GRID - 1 }, (_, i) => {
          const fx = offX + ((i + 1) / GRID) * aw;
          const fy = offY + ((i + 1) / GRID) * ah;
          return (
            <g key={`g${i}`} className="rpt-replay-grid">
              <line x1={fx} y1={offY} x2={fx} y2={offY + ah} />
              <line x1={offX} y1={fy} x2={offX + aw} y2={fy} />
            </g>
          );
        })}
        {/* 走位尾迹(最近数秒) */}
        {tracks.map((tr) => {
          const pts = pathUpTo(tr, t);
          if (pts.length < 2) return null;
          return (
            <polyline
              key={`tr${tr.unitId}`}
              className="rpt-replay-trail"
              points={pts.map((p) => `${toX(p.x)},${toY(p.y)}`).join(" ")}
              stroke={classColor(tr.classId)}
            />
          );
        })}
        {/* 阵亡:残影 + ✕ */}
        {tracks.map((tr) => {
          if (tr.deathT == null || t < tr.deathT) return null;
          const dp = deathPosition(tr);
          if (!dp) return null;
          const cx = toX(dp.x);
          const cy = toY(dp.y);
          return (
            <g key={`d${tr.unitId}`}>
              <circle
                cx={cx}
                cy={cy}
                r={13}
                className="rpt-replay-ghost"
                fill={classColor(tr.classId)}
              />
              <text x={cx} y={cy + 4} className="rpt-replay-death">
                ✕
              </text>
            </g>
          );
        })}
        {/* 存活单位:职业色圆点 + 字形 + 名字 + 血条 */}
        {tracks.map((tr) => {
          const at = sampleAt(tr, t);
          if (!at) return null;
          const cx = toX(at.x);
          const cy = toY(at.y);
          const hp =
            at.maxHp > 0 ? Math.max(0, Math.min(1, at.hp / at.maxHp)) : 1;
          return (
            <g key={tr.unitId} className="rpt-replay-unit">
              <text x={cx} y={cy - 19} className="rpt-replay-name">
                {tr.name}
              </text>
              <circle
                cx={cx}
                cy={cy}
                r={13}
                fill={classColor(tr.classId)}
                stroke={reactionRing(tr.reaction)}
                strokeWidth={2.5}
                fillOpacity={0.4 + 0.6 * hp}
              />
              <text x={cx} y={cy + 3.2} className="rpt-replay-glyph">
                {classGlyph(tr.classId)}
              </text>
              <rect
                x={cx - 16}
                y={cy + 16}
                width={32}
                height={4}
                rx={2}
                className="rpt-replay-hp-track"
              />
              <rect
                x={cx - 16}
                y={cy + 16}
                width={32 * hp}
                height={4}
                rx={2}
                fill={hpColor(hp)}
              />
            </g>
          );
        })}
      </svg>

      <div className="rpt-replay-controls">
        <button
          className="rpt-replay-play"
          onClick={() => {
            if (atEnd) setT(startTime);
            setPlaying((p) => !p);
          }}
        >
          {playing ? "⏸ 暂停" : atEnd ? "↻ 重放" : "▶ 播放"}
        </button>
        <input
          type="range"
          className="rpt-replay-scrub"
          min={startTime}
          max={endTime}
          step={100}
          value={t}
          onChange={(e) => setT(Number(e.target.value))}
        />
        <span className="rpt-replay-time">
          {relTime(t, startTime)} / {relTime(endTime, startTime)}
        </span>
        <span className="rpt-replay-divider" />
        <div className="rpt-replay-speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              className={s === speed ? "active" : ""}
              onClick={() => setSpeed(s)}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      <div className="rpt-replay-legend">
        {tracks.map((tr) => {
          const dead = tr.deathT != null && t >= tr.deathT;
          return (
            <span
              key={tr.unitId}
              className={dead ? "rpt-replay-leg dead" : "rpt-replay-leg"}
            >
              <span
                className="rpt-replay-swatch"
                style={{
                  background: classColor(tr.classId),
                  borderColor: reactionRing(tr.reaction),
                }}
              >
                {classGlyph(tr.classId)}
              </span>
              {tr.name}
              {dead ? " ✝" : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}
