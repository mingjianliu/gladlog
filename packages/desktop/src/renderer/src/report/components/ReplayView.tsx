import { useEffect, useMemo, useRef, useState } from "react";

import { arenaMap, arenaMapUrl, arenaPx, arenaToPx } from "../data/arenaMaps";
import { classColor, classGlyph } from "../data/gameConstants";
import {
  deathPosition,
  deriveReplay,
  pathUpTo,
  sampleAt,
} from "../derive/replay";
import { castBarAt, deriveCastBars } from "../derive/castBars";
import { deriveCasts } from "../derive/casts";
import { dampeningAt, deriveDampeningSeries } from "../derive/dampeningSeries";
import type { ReportSource } from "../derive/types";
import { deriveVulnBands } from "../derive/vulnWindows";
import { GcdSwimlane } from "./GcdSwimlane";

const FALLBACK_VW = 520;
const FALLBACK_VH = 520;
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

export interface SeekRequest {
  tMs: number;
  unitNames: string[];
  nonce: number;
}

export function ReplayView({
  source,
  seekReq,
  onDeathClick,
}: {
  source: ReportSource;
  seekReq?: SeekRequest | null;
  /** 阵亡 ✕ 点击 → 死亡回顾(#6 v2)。t 为绝对 ms。 */
  onDeathClick?: (unitId: string, tMs: number) => void;
}) {
  const data = useMemo(() => deriveReplay(source), [source]);
  const { startTime, endTime, bounds, tracks } = data;
  const vulnBands = useMemo(() => deriveVulnBands(source), [source]);
  const dampSeries = useMemo(() => deriveDampeningSeries(source), [source]);
  // 施法闪现(#11b):SUCCESS 瞬间闪现(瞬发也可见)
  const castsByUnit = useMemo(
    () =>
      Object.fromEntries(
        tracks.map((tr) => [tr.unitId, deriveCasts(source, tr.unitId)]),
      ),
    [source, tracks],
  );
  // 真读条条(#11b 完全版):parser castStarts;旧存档 doc 无字段 → 空
  const castBarsByUnit = useMemo(
    () =>
      Object.fromEntries(
        tracks.map((tr) => [tr.unitId, deriveCastBars(source, tr.unitId)]),
      ),
    [source, tracks],
  );

  const [t, setT] = useState(startTime);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [selUnits, setSelUnits] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(tracks.map((tr) => [tr.unitId, true])),
  );
  const prevRef = useRef<number>(0);
  const seekNonceRef = useRef<number>(0);

  // 证据链 seek:按 nonce 消费一次(组件在视图切换时重挂载,ref 归零后
  // 首次挂载也会消费同一请求)。定位后暂停,让用户从该时刻自己看。
  useEffect(() => {
    if (!seekReq || seekReq.nonce === seekNonceRef.current) return;
    seekNonceRef.current = seekReq.nonce;
    setT(Math.min(endTime, Math.max(startTime, seekReq.tMs)));
    setPlaying(false);
  }, [seekReq, startTime, endTime]);

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

  // 有该竞技场底图时:坐标系 = minimap 像素(世界坐标经 5px/单位映射,对齐底图);
  // 否则回退到「按样本包围盒 + 抽象地面」。
  const zoneId = (source as { zoneId?: string | number }).zoneId;
  const zoneMap = arenaMap(zoneId);

  let VW: number;
  let VH: number;
  let toX: (x: number) => number;
  let toY: (y: number) => number;
  // 抽象地面参数(仅无底图时用)
  let aw = 0;
  let ah = 0;
  let offX = 0;
  let offY = 0;
  let cxA = 0;
  let cyA = 0;
  let pillarR = 0;
  let pillars: { x: number; y: number }[] = [];

  if (zoneMap) {
    const px = arenaPx(zoneMap);
    VW = px.w;
    VH = px.h;
    toX = (x) => arenaToPx(zoneMap, x, 0).x;
    toY = (y) => arenaToPx(zoneMap, 0, y).y;
  } else {
    VW = FALLBACK_VW;
    VH = FALLBACK_VH;
    const spanX = bounds.maxX - bounds.minX || 1;
    const spanY = bounds.maxY - bounds.minY || 1;
    const scale = Math.min((VW - 2 * PAD) / spanX, (VH - 2 * PAD) / spanY);
    aw = spanX * scale;
    ah = spanY * scale;
    offX = (VW - aw) / 2;
    offY = (VH - ah) / 2;
    // WoW y 向北为正 → 反转,使北在上方
    toX = (x) => offX + (x - bounds.minX) * scale;
    toY = (y) => offY + (bounds.maxY - y) * scale;
    cxA = offX + aw / 2;
    cyA = offY + ah / 2;
    pillarR = Math.min(aw, ah) * 0.085;
    pillars = [
      { x: offX + aw * 0.34, y: offY + ah * 0.42 },
      { x: offX + aw * 0.66, y: offY + ah * 0.58 },
    ];
  }

  const atEnd = t >= endTime;

  return (
    <div className="rpt-replay">
      <div className="rpt-replay-stage">
        <div className="rpt-replay-arena-col">
          <svg
            className="rpt-replay-field"
            viewBox={`0 0 ${VW} ${VH}`}
            data-testid="rpt-replay-field"
            preserveAspectRatio="xMidYMid meet"
            style={{ aspectRatio: `${VW} / ${VH}` }}
          >
            {zoneMap ? (
              <>
                {/* 地面(底图为透明障碍图时透出) */}
                <rect
                  x={0}
                  y={0}
                  width={VW}
                  height={VH}
                  className="rpt-replay-map-floor"
                />
                {/* 该竞技场真实 minimap 底图(CDN 运行时加载) */}
                <image
                  href={arenaMapUrl(zoneId as string | number)}
                  x={0}
                  y={0}
                  width={VW}
                  height={VH}
                  preserveAspectRatio="none"
                  className="rpt-replay-map"
                />
                {/* 压暗一层,保证圆点/尾迹在底图上有对比 */}
                <rect
                  x={0}
                  y={0}
                  width={VW}
                  height={VH}
                  className="rpt-replay-map-veil"
                />
              </>
            ) : (
              <>
                <defs>
                  <radialGradient
                    id="rpt-arena-floor"
                    cx="50%"
                    cy="50%"
                    r="70%"
                  >
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
              </>
            )}
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
                <g
                  key={`d${tr.unitId}`}
                  className={onDeathClick ? "rpt-replay-ghost-click" : undefined}
                  onClick={
                    onDeathClick
                      ? () => onDeathClick(tr.unitId, tr.deathT!)
                      : undefined
                  }
                >
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
                  <title>{`${tr.name} 阵亡${onDeathClick ? " — 点击看死亡回顾" : ""}`}</title>
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
                  {/* HP 数字(#11c) */}
                  <text
                    x={cx + 20}
                    y={cy + 20.5}
                    className="rpt-replay-hpnum"
                    fill={hpColor(hp)}
                  >
                    {Math.round(hp * 100)}%
                  </text>
                  {/* 真读条条:进行中的读条在血条下画进度(金=会完成,红=被掐) */}
                  {(() => {
                    const bar = castBarAt(castBarsByUnit[tr.unitId] ?? [], t);
                    if (!bar) return null;
                    const frac = Math.max(
                      0,
                      Math.min(
                        1,
                        (t - bar.fromMs) /
                          Math.max(1, bar.toMs - bar.fromMs),
                      ),
                    );
                    return (
                      <g className="rpt-replay-castbar">
                        <rect
                          x={cx - 16}
                          y={cy + 22}
                          width={32}
                          height={3}
                          rx={1.5}
                          className="rpt-replay-hp-track"
                        />
                        <rect
                          x={cx - 16}
                          y={cy + 22}
                          width={32 * frac}
                          height={3}
                          rx={1.5}
                          fill={
                            bar.outcome === "completed"
                              ? "var(--gold)"
                              : "var(--loss)"
                          }
                        />
                        <title>{`读条:${bar.spellName}${bar.outcome === "cut" ? "(被掐)" : ""}`}</title>
                      </g>
                    );
                  })()}
                  {/* 施法闪现(#11b):刚成功的施法在头顶闪 1.2s */}
                  {(() => {
                    const cs = castsByUnit[tr.unitId] ?? [];
                    let last: (typeof cs)[number] | null = null;
                    for (const c of cs) {
                      if (c.t > t) break;
                      if (t - c.t <= 1200) last = c;
                    }
                    if (!last) return null;
                    return (
                      <text
                        x={cx}
                        y={cy - 30}
                        className="rpt-replay-castflash"
                      >
                        ✦ {last.spellName}
                      </text>
                    );
                  })()}
                </g>
              );
            })}
          </svg>

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

        <GcdSwimlane
          source={source}
          tracks={tracks}
          t={t}
          startTime={startTime}
          endTime={endTime}
          selUnits={selUnits}
          onToggle={(id) => setSelUnits((s) => ({ ...s, [id]: !s[id] }))}
          playing={playing}
          flash={seekReq}
          onSeekT={(tMs) => {
            setT(Math.min(endTime, Math.max(startTime, tMs)));
            setPlaying(false);
          }}
        />
      </div>

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
        <div className="rpt-replay-scrub-wrap">
          {/* KILL WINDOW/VULNERABLE 色带:金 = 击杀尝试 burst,灰红 = 无人惩罚的脆弱段 */}
          <div className="rpt-replay-bands">
            {vulnBands.map((b, i) => {
              const span = Math.max(1, endTime - startTime);
              const fromMs = source.startTime + b.fromS * 1000;
              const toMs = source.startTime + b.toS * 1000;
              const left = ((fromMs - startTime) / span) * 100;
              const width = Math.max(0.4, ((toMs - fromMs) / span) * 100);
              if (left >= 100 || left + width <= 0) return null;
              return (
                <div
                  key={i}
                  className={`rpt-replay-band rpt-replay-band-${b.kind}`}
                  style={{
                    left: `${Math.max(0, left)}%`,
                    width: `${Math.min(100 - Math.max(0, left), width)}%`,
                  }}
                  onClick={() => {
                    setT(Math.min(endTime, Math.max(startTime, fromMs)));
                    setPlaying(false);
                  }}
                  title={
                    (b.kind === "burst"
                      ? `击杀尝试 on ${b.targetName}(团队伤害 ${(b.damage / 1000).toFixed(0)}k)`
                      : `${b.targetName} 无大防御且未被惩罚(团队伤害仅 ${(b.damage / 1000).toFixed(0)}k)`) +
                    "(点击定位)"
                  }
                />
              );
            })}
          </div>
          <input
            type="range"
            className="rpt-replay-scrub"
            min={startTime}
            max={endTime}
            step={100}
            value={t}
            onChange={(e) => setT(Number(e.target.value))}
          />
        </div>
        <span className="rpt-replay-time">
          {relTime(t, startTime)} / {relTime(endTime, startTime)}
        </span>
        {(() => {
          const d = dampeningAt(dampSeries, (t - source.startTime) / 1000);
          return d != null && d > 0 ? (
            <span className="rpt-replay-damp" title="治疗衰减(dampening)">
              衰减 {d}%
            </span>
          ) : null;
        })()}
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
    </div>
  );
}
