import { arenaObstacles } from "@gladlog/analysis";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import arenaFloorsJson from "../data/arenaFloors.json";
import { arenaMap, arenaMapUrl, arenaPx, arenaToPx } from "../data/arenaMaps";
import { classColor, classGlyph, specIconUrl } from "../data/gameConstants";
import { castBarAt, deriveCastBars } from "../derive/castBars";
import { deriveCasts } from "../derive/casts";
import { dampeningAt, deriveDampeningSeries } from "../derive/dampeningSeries";
import {
  deathPosition,
  deriveReplay,
  pathUpTo,
  sampleAt,
} from "../derive/replay";
import { deriveBurstAuras, deriveFocusFire } from "../derive/replayHighlights";
import type { ReportSource } from "../derive/types";
import { deriveVulnBands } from "../derive/vulnWindows";
import { GcdSwimlane } from "./GcdSwimlane";

const FALLBACK_VW = 520;
const FALLBACK_VH = 520;
const PAD = 46;
const GRID = 4;
const SPEEDS = [0.5, 1, 2, 4] as const;

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

  // 爆发红光 + 同秒集火(DPS D1):谓词在 analysis/derive,这里只查 t
  const burstAuras = useMemo(() => deriveBurstAuras(source), [source]);
  const focusFire = useMemo(() => deriveFocusFire(source), [source]);

  const [t, setT] = useState(startTime);
  // 缩放/平移(小地图人堆看不清 —— 滚轮缩放、拖拽平移、双击/按钮复位)。
  // view = SVG viewBox;null = 全景。坐标换算不动(只改视窗)。
  const [view, setView] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const panRef = useRef<{ px: number; py: number } | null>(null);
  // 缩放交互:普通滚轮留给页面滚动,只有 ⌘/Ctrl+滚轮(触控板捏合同)才缩放。
  // React 17+ 的合成 wheel 是 passive 监听、preventDefault 无效,必须原生挂。
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dimsRef = useRef({ vw: FALLBACK_VW, vh: FALLBACK_VH });
  const applyZoom = useCallback((factor: number, fx: number, fy: number) => {
    const { vw, vh } = dimsRef.current;
    setView((cur0) => {
      const cur = cur0 ?? { x: 0, y: 0, w: vw, h: vh };
      const w = Math.min(vw, Math.max(vw / 5, cur.w * factor));
      const h = (w / vw) * vh;
      let x = cur.x + fx * (cur.w - w);
      let y = cur.y + fy * (cur.h - h);
      x = Math.min(Math.max(0, x), vw - w);
      y = Math.min(Math.max(0, y), vh - h);
      return w >= vw ? null : { x, y, w, h };
    });
  }, []);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // 普通滚轮 = 页面滚动
      e.preventDefault(); // 拦掉浏览器整页缩放
      const rect = el.getBoundingClientRect();
      applyZoom(
        e.deltaY > 0 ? 1.25 : 0.8,
        (e.clientX - rect.left) / rect.width,
        (e.clientY - rect.top) / rect.height,
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyZoom, tracks.length]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [selUnits, setSelUnits] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(tracks.map((tr) => [tr.unitId, true])),
  );
  // 侧栏框体/场上单位 hover 联动:高亮 + raise 到最上层
  const [hoverUnit, setHoverUnit] = useState<string | null>(null);
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

  // 键盘:空格 播放/暂停,←/→ ±5s(Shift ±1s)。输入控件聚焦时不拦截。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        e.preventDefault();
        const step =
          (e.shiftKey ? 1_000 : 5_000) * (e.code === "ArrowLeft" ? -1 : 1);
        setT((cur) => Math.min(endTime, Math.max(startTime, cur + step)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [startTime, endTime]);

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
  // 语料实测的可行走地面轮廓(floorScan.ts 产物):场地边缘/入场房都是
  // 真实 LoS 参照。CDN 底图只有柱子点阵,边界靠这个。
  const floorOutline = (
    arenaFloorsJson as unknown as Record<
      string,
      { outline: [number, number][] }
    >
  )[String(zoneId ?? "")]?.outline;

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
    // 有实测地面轮廓时:包围盒并上轮廓(边缘/入场房可能超出本场样本范围)
    const eb = { ...bounds };
    if (floorOutline) {
      for (const [fx, fy] of floorOutline) {
        if (fx < eb.minX) eb.minX = fx;
        if (fx > eb.maxX) eb.maxX = fx;
        if (fy < eb.minY) eb.minY = fy;
        if (fy > eb.maxY) eb.maxY = fy;
      }
    }
    const spanX = eb.maxX - eb.minX || 1;
    const spanY = eb.maxY - eb.minY || 1;
    const scale = Math.min((VW - 2 * PAD) / spanX, (VH - 2 * PAD) / spanY);
    aw = spanX * scale;
    ah = spanY * scale;
    offX = (VW - aw) / 2;
    offY = (VH - ah) / 2;
    // WoW y 向北为正 → 反转,使北在上方
    toX = (x) => offX + (x - eb.minX) * scale;
    toY = (y) => offY + (eb.maxY - y) * scale;
    cxA = offX + aw / 2;
    cyA = offY + ah / 2;
    pillarR = Math.min(aw, ah) * 0.085;
    pillars = [
      { x: offX + aw * 0.34, y: offY + ah * 0.42 },
      { x: offX + aw * 0.66, y: offY + ah * 0.58 },
    ];
  }

  dimsRef.current = { vw: VW, vh: VH };

  const atEnd = t >= endTime;

  return (
    <div className="rpt-replay">
      <div className="rpt-replay-stage">
        <div className="rpt-replay-arena-col">
          <svg
            ref={svgRef}
            className={view ? "rpt-replay-field zoomed" : "rpt-replay-field"}
            viewBox={
              view
                ? `${view.x} ${view.y} ${view.w} ${view.h}`
                : `0 0 ${VW} ${VH}`
            }
            data-testid="rpt-replay-field"
            preserveAspectRatio="xMidYMid meet"
            style={{ aspectRatio: `${VW} / ${VH}` }}
            onPointerDown={(e) => {
              if (!view) return;
              panRef.current = { px: e.clientX, py: e.clientY };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!view || !panRef.current) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const dx =
                ((e.clientX - panRef.current.px) / rect.width) * view.w;
              const dy =
                ((e.clientY - panRef.current.py) / rect.height) * view.h;
              panRef.current = { px: e.clientX, py: e.clientY };
              setView({
                ...view,
                x: Math.min(Math.max(0, view.x - dx), VW - view.w),
                y: Math.min(Math.max(0, view.y - dy), VH - view.h),
              });
            }}
            onPointerUp={() => {
              panRef.current = null;
            }}
            onDoubleClick={() => setView(null)}
          >
            {/* 单位专精图标的圆形裁剪(单位组内局部坐标,全场共用一个) */}
            <defs>
              <clipPath id="rpt-unit-clip">
                <circle r={11} cx={0} cy={0} />
              </clipPath>
            </defs>
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
            {/* 可行走地面轮廓(语料实测):场地边缘 + 入场房,LoS 参照 */}
            {floorOutline && (
              <polygon
                className="rpt-replay-floor-outline"
                points={floorOutline
                  .map(([fx, fy]) => `${toX(fx)},${toY(fy)}`)
                  .join(" ")}
              />
            )}
            {/* 障碍物(LoS 几何,与 analysis 谓词同源) */}
            {(arenaObstacles[String(zoneId)] ?? []).map((o, i) =>
              o.type === "circle" ? (
                <circle
                  key={`ob${i}`}
                  className="rpt-replay-obstacle"
                  cx={toX(o.cx)}
                  cy={toY(o.cy)}
                  r={Math.abs(toX(o.cx + o.r) - toX(o.cx))}
                />
              ) : (
                <polygon
                  key={`ob${i}`}
                  className="rpt-replay-obstacle"
                  points={o.vertices
                    .map(([vx, vy]) => `${toX(vx)},${toY(vy)}`)
                    .join(" ")}
                />
              ),
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
                  className={
                    onDeathClick ? "rpt-replay-ghost-click" : undefined
                  }
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
            {/* 存活单位:职业色圆点 + 字形 + 名字 + 血条。
                hover(侧栏或场上)的单位排到最后 = SVG 最上层,重叠时可看清 */}
            {(hoverUnit
              ? [
                  ...tracks.filter((tr) => tr.unitId !== hoverUnit),
                  ...tracks.filter((tr) => tr.unitId === hoverUnit),
                ]
              : tracks
            ).map((tr) => {
              const at = sampleAt(tr, t);
              if (!at) return null;
              const cx = toX(at.x);
              const cy = toY(at.y);
              const hp =
                at.maxHp > 0 ? Math.max(0, Math.min(1, at.hp / at.maxHp)) : 1;
              return (
                <g
                  key={tr.unitId}
                  className="rpt-replay-unit"
                  onMouseEnter={() => setHoverUnit(tr.unitId)}
                  onMouseLeave={() => setHoverUnit(null)}
                >
                  {hoverUnit === tr.unitId && (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={17}
                      className="rpt-replay-hover-ring"
                    />
                  )}
                  {/* 爆发红光脉冲:敌方进攻大 CD active(span 与爆发账本同谓词) */}
                  {(() => {
                    const span = (burstAuras[tr.unitId] ?? []).find(
                      (s) => t >= s.fromMs && t <= s.toMs,
                    );
                    if (!span) return null;
                    return (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={19}
                        className="rpt-replay-burst-ring"
                      >
                        <title>{`${tr.name} 爆发中:${span.spellName}`}</title>
                      </circle>
                    );
                  })()}
                  {/* 同秒集火高亮:2+ 敌对玩家同一秒打这个目标 */}
                  {(() => {
                    const sec = Math.floor((t - source.startTime) / 1000);
                    const n = focusFire[tr.unitId]?.[sec];
                    if (!n) return null;
                    return (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={16}
                        className="rpt-replay-focus-ring"
                      >
                        <title>{`集火:${n} 人同秒打击 ${tr.name}`}</title>
                      </circle>
                    );
                  })()}
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
                  {/* 专精图标叠加(CDN 同对局列表先例);加载失败时什么都不画,
                      底下的职业色圆点+字形自然兜底 */}
                  {specIconUrl(tr.specId) && (
                    <g
                      transform={`translate(${cx},${cy})`}
                      clipPath="url(#rpt-unit-clip)"
                      pointerEvents="none"
                    >
                      <image
                        href={specIconUrl(tr.specId)!}
                        x={-11}
                        y={-11}
                        width={22}
                        height={22}
                        preserveAspectRatio="xMidYMid slice"
                      />
                    </g>
                  )}
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
                        (t - bar.fromMs) / Math.max(1, bar.toMs - bar.fromMs),
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
                      <text x={cx} y={cy - 30} className="rpt-replay-castflash">
                        ✦ {last.spellName}
                      </text>
                    );
                  })()}
                </g>
              );
            })}
          </svg>

          {/* 竞技场框体(WoW party/arena frames 式):血量不再被场上重叠遮挡 */}
          <div className="rpt-replay-frames-row">
            {(["Friendly", "Hostile"] as const).map((side) => (
              <div
                key={side}
                className={`rpt-replay-frames ${side === "Friendly" ? "friendly" : "enemy"}`}
                data-testid={`rpt-frames-${side === "Friendly" ? "friendly" : "enemy"}`}
              >
                {tracks
                  .filter((tr) =>
                    side === "Friendly"
                      ? tr.reaction === "Friendly"
                      : tr.reaction !== "Friendly",
                  )
                  .map((tr) => {
                    const at = sampleAt(tr, t);
                    // 死亡判定与旧 legend 同谓词(deathT),不借道 sampleAt 的 null
                    const dead = tr.deathT != null && t >= tr.deathT;
                    const hp =
                      at && at.maxHp > 0
                        ? Math.max(0, Math.min(1, at.hp / at.maxHp))
                        : 0;
                    return (
                      <div
                        key={tr.unitId}
                        className={[
                          "rpt-frame",
                          dead ? "dead" : "",
                          hoverUnit === tr.unitId ? "hovered" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onMouseEnter={() => setHoverUnit(tr.unitId)}
                        onMouseLeave={() => setHoverUnit(null)}
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
                        <span className="rpt-frame-main">
                          <span className="rpt-frame-name">{tr.name}</span>
                          {dead ? (
                            <span className="rpt-frame-dead">✝ 阵亡</span>
                          ) : (
                            <span className="rpt-frame-bar">
                              <span
                                style={{
                                  width: `${hp * 100}%`,
                                  background: hpColor(hp),
                                }}
                              />
                            </span>
                          )}
                        </span>
                        {!dead && (
                          <span
                            className="rpt-frame-pct"
                            style={{ color: hpColor(hp) }}
                          >
                            {Math.round(hp * 100)}%
                          </span>
                        )}
                      </div>
                    );
                  })}
              </div>
            ))}
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
          onDeathClick={onDeathClick}
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
        <span className="rpt-replay-zoom-group">
          <button
            className="rpt-replay-zoom-btn"
            title="放大(也可 ⌘/Ctrl+滚轮,拖拽平移)"
            onClick={() => applyZoom(0.8, 0.5, 0.5)}
          >
            +
          </button>
          <button
            className="rpt-replay-zoom-btn"
            title="缩小"
            onClick={() => applyZoom(1.25, 0.5, 0.5)}
          >
            −
          </button>
          {view && (
            <button
              className="rpt-replay-zoom-reset"
              title="复位缩放(或双击地图)"
              onClick={() => setView(null)}
            >
              ⤢ {Math.round((VW / view.w) * 10) / 10}× 复位
            </button>
          )}
        </span>
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
