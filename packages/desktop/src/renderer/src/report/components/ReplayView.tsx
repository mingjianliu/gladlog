import { arenaObstacles, fmtTime } from "@gladlog/analysis";
import { useEffect, useMemo, useRef, useState } from "react";

import arenaFloorsJson from "../data/arenaFloors.json";
import { arenaMap, arenaPx, arenaToPx } from "../data/arenaMaps";
import { classColor, classGlyph, specIconName } from "../data/gameConstants";
import { useIconDataUrls } from "./useIconDataUrl";
import { castBarAt, deriveCastBars } from "../derive/castBars";
import { deriveCasts } from "../derive/casts";
import { dampeningAt, deriveDampeningSeries } from "../derive/dampeningSeries";
import {
  deathPosition,
  deriveReplay,
  pathUpTo,
  positionKnownAt,
  sampleAt,
} from "../derive/replay";
import {
  activeCcAt,
  deriveBurstAuras,
  deriveCcSpans,
  deriveFocusFire,
} from "../derive/replayHighlights";
import type { ReportSource } from "../derive/types";
import { deriveVulnBands } from "../derive/vulnWindows";
import { GcdSwimlane } from "./GcdSwimlane";
import { ReplayMapResizer } from "./ReplayMapResizer";
import { ReplaySplitter } from "./ReplaySplitter";
import { ReplayZoomControls } from "./ReplayZoomControls";
import { useReplayLayout, type ReplayLayoutMode } from "./useReplayLayout";
import { useReplayZoom } from "./useReplayZoom";

const FALLBACK_VW = 520;
const FALLBACK_VH = 520;
const PAD = 46;
const GRID = 4;
const SPEEDS = [0.5, 1, 2, 4] as const;
/** Hotkey / legend copy (P1-7: the two hint lines fold into the "?" button). */
const HINT_KEYS =
  "空格 播放/暂停 · ← → ±5s · Shift ±1s · ⌘/Ctrl+滚轮 缩放(放大后滚轮可继续)· 双击复位 · 分隔条可拖(聚焦后 ← →)";
const HINT_LEGEND =
  "虚线空心 = 该时刻日志里还没有此人坐标(跑动不进战斗日志,要等他施法、挨打或被治疗才会暴露位置)";
const LAYOUT_MODES: readonly (readonly [ReplayLayoutMode, string])[] = [
  ["split", "地图 + GCD"],
  ["map", "纯地图"],
  ["gcd", "纯 GCD"],
];

const sideRing = (side: string): string =>
  side === "friendly"
    ? "var(--win)"
    : side === "enemy"
      ? "var(--loss)"
      : "var(--mute)";

const hpColor = (f: number): string =>
  f > 0.6 ? "var(--win)" : f >= 0.3 ? "var(--gold)" : "var(--loss)";

const relTime = (t: number, start: number): string => {
  const s = Math.max(0, (t - start) / 1000);
  return fmtTime(s);
};

interface SeekRequest {
  tMs: number;
  unitNames: string[];
  nonce: number;
}

export function ReplayView({
  source,
  seekReq,
  onDeathClick,
  onLastT,
  onMomentDive,
}: {
  source: ReportSource;
  seekReq?: SeekRequest | null;
  /** Click the death ✕ → death recap (#6 v2). t is an absolute ms timestamp. */
  onDeathClick?: (unitId: string, tMs: number) => void;
  /** On unmount (switching away) report the last playhead position (absolute
   * ms) — used to project it onto the report curves (1c). */
  onLastT?: (tMs: number) => void;
  /** Deprecated (user-decided 2026-08-02: no recording PiP inside the replay
   * any more; recording lives in its own tab). Kept in the type only so the
   * caller MatchReport (a live file in a parallel session) needn't change;
   * clean up next time we pass through here. */
  matchId?: string;
  /** "深挖此刻" (SDD 2026-08-05 Task 6): the current playback clock, converted
   * to a relative second (same absolute-ms → relative-s formula used
   * elsewhere in this file, e.g. focus-fire's `sec` and the dampening
   * lookup below) — MatchReport turns it into a ±10s window and runs a
   * one-shot window analysis. The playback clock itself stays local state
   * here (never lifted — see the desktop-dev skill), only the derived second
   * crosses the boundary. */
  onMomentDive?: (tSeconds: number) => void;
}) {
  const data = useMemo(() => deriveReplay(source), [source]);
  const { startTime, endTime, bounds, tracks } = data;
  // Spec icons for unit portraits: fetched through the main process iconCache
  // (docs/DATA-COMPLIANCE.md). If unavailable we draw nothing — the class-color
  // dot + glyph underneath is the natural fallback.
  const specIcons = useIconDataUrls(
    tracks.map((tr) => specIconName(tr.specId)),
  );
  const vulnBands = useMemo(() => deriveVulnBands(source), [source]);
  const dampSeries = useMemo(() => deriveDampeningSeries(source), [source]);
  // Cast flash (#11b): flashes at the SUCCESS instant (instants are visible too)
  const castsByUnit = useMemo(
    () =>
      Object.fromEntries(
        tracks.map((tr) => [tr.unitId, deriveCasts(source, tr.unitId)]),
      ),
    [source, tracks],
  );
  // Real cast bars (#11b, full version): parser castStarts; older stored docs
  // lack the field → empty
  const castBarsByUnit = useMemo(
    () =>
      Object.fromEntries(
        tracks.map((tr) => [tr.unitId, deriveCastBars(source, tr.unitId)]),
      ),
    [source, tracks],
  );

  // Burst glow + same-second focus fire (DPS D1): the predicates live in
  // analysis/derive; here we only look up the current t
  const burstAuras = useMemo(() => deriveBurstAuras(source), [source]);
  const focusFire = useMemo(() => deriveFocusFire(source), [source]);
  // CC state on the map (user request 2026-08-14): same predicate as the
  // prompt's [CC ON TEAM] / death recap (analyzePlayerCCAndTrinket)
  const ccSpans = useMemo(() => deriveCcSpans(source), [source]);

  const [t, setT] = useState(startTime);
  // Layout mode (from user feedback): map+GCD / map only / GCD only;
  // remembered in localStorage
  const {
    mode,
    ratio,
    mapHeight,
    gcdCompact,
    setMode,
    setRatio,
    setMapHeight,
    setGcdCompact,
  } = useReplayLayout();
  const stageRef = useRef<HTMLDivElement | null>(null);
  // Map cell: in map-only mode we measure its top edge to convert the drag into
  // a height (the zoom hot zone already owns hotZoneRef; both refs point at the
  // same node and are written together on mount)
  const mapCellRef = useRef<HTMLDivElement | null>(null);
  // The playback clock stays local (hot tick); only on unmount do we report the
  // last position back to MatchReport (cold path)
  const lastTRef = useRef(startTime);
  lastTRef.current = t;
  const onLastTRef = useRef(onLastT);
  onLastTRef.current = onLastT;
  useEffect(() => {
    return () => {
      onLastTRef.current?.(lastTRef.current);
    };
  }, []);
  // Zoom / pan (players pile up and are unreadable on a small map — wheel to
  // zoom, drag to pan, double-click or button to reset).
  // view = SVG viewBox; null = full view. The coordinate mapping is untouched
  // (only the viewport changes). Logic lives in useReplayZoom.
  const zoom = useReplayZoom();
  const { view } = zoom;
  const panRef = useRef<{ px: number; py: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [selUnits, setSelUnits] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(tracks.map((tr) => [tr.unitId, true])),
  );
  // Hover is linked between the sidebar frames and the units on the map:
  // highlight + raise to the topmost layer
  const [hoverUnit, setHoverUnit] = useState<string | null>(null);
  // P1-7: the one-shot explanation card behind the "?" button
  const [showHelp, setShowHelp] = useState(false);
  const prevRef = useRef<number>(0);
  const seekNonceRef = useRef<number>(0);

  // When the round changes (inside one shuffle, source changes but the
  // component is not remounted) the playback clock must follow, otherwise t
  // stays at the previous round's absolute timestamp — the recording PiP then
  // showed footage from another round (reported from a real machine).
  // This must be declared BEFORE the seekReq-consuming effect: on first mount
  // we reset first and consume the seek after, so the seek wins.
  useEffect(() => {
    setT(startTime);
    setPlaying(false);
  }, [startTime]);

  // Evidence-chain seek: consumed once per nonce (the component remounts when
  // switching views, and after the ref resets the first mount will consume the
  // same request again). We pause after seeking so the user can watch from
  // that moment themselves.
  useEffect(() => {
    if (!seekReq || seekReq.nonce === seekNonceRef.current) return;
    seekNonceRef.current = seekReq.nonce;
    setT(Math.min(endTime, Math.max(startTime, seekReq.tMs)));
    setPlaying(false);
  }, [seekReq, startTime, endTime]);

  // Keyboard: Space toggles play/pause, ←/→ seek ±5s (Shift: ±1s). We do not
  // intercept while an input control has focus.
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

  // When we have a base map for this arena the coordinate system is minimap
  // pixels (world coordinates mapped at 5px/unit, aligned to the base map);
  // otherwise fall back to "sample bounding box + abstract floor".
  const zoneId = (source as { zoneId?: string | number }).zoneId;
  const zoneMap = arenaMap(zoneId);
  // Walkable-floor outline measured from the corpus (output of floorScan.ts):
  // arena edges and the starting rooms are real LoS references. The CDN base
  // map only has the pillar blocks, so boundaries come from this.
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
  // Abstract-floor parameters (used only when there is no base map)
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
    // With a measured floor outline, union the bounding box with the outline
    // (edges / starting rooms can fall outside this match's samples)
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
    // In WoW +y points north → flip it so north is up
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

  zoom.setDims(VW, VH);

  // Zoom semantics (user feedback: scaling the whole picture uniformly made the
  // markers grow with the map and get *harder* to read):
  // map geometry (unit spacing / walls & pillars / trail paths) still magnifies
  // naturally as the viewBox shrinks, while screen-space UI (markers / icons /
  // text / rings) is multiplied by k in the opposite direction to cancel that
  // out and keep a constant pixel size.
  // k<1 = zoomed in (view.w narrower than the full width), k=1 = full view,
  // pixel-identical to the behavior before this change.
  const k = view ? view.w / VW : 1;

  const atEnd = t >= endTime;

  // Name labels are shown on demand (P1-5): only when hovered ‖ HP < 50% ‖ the
  // burst glow is active (death ghosts carry their own permanent name; the
  // sidebar frames always show full names anyway). Within a frame, when two
  // neighbours are Δcx<70 apart the later label is lifted 14px with a leader
  // line, so labels don't stack and cover each other in a team fight.
  const labelInfo = (() => {
    const shown: Array<{ unitId: string; cx: number }> = [];
    for (const tr of tracks) {
      const at = sampleAt(tr, t);
      if (!at) continue;
      const hp = at.maxHp > 0 ? Math.max(0, Math.min(1, at.hp / at.maxHp)) : 1;
      const bursting = (burstAuras[tr.unitId] ?? []).some(
        (s) => t >= s.fromMs && t <= s.toMs,
      );
      if (hoverUnit === tr.unitId || hp < 0.5 || bursting)
        shown.push({ unitId: tr.unitId, cx: toX(at.x) });
    }
    shown.sort((a, b) => a.cx - b.cx);
    const visible = new Set(shown.map((s) => s.unitId));
    const lift = new Map<string, number>();
    for (let i = 1; i < shown.length; i++) {
      if (shown[i]!.cx - shown[i - 1]!.cx < 70)
        lift.set(shown[i]!.unitId, (lift.get(shown[i - 1]!.unitId) ?? 0) + 14);
    }
    return { visible, lift };
  })();

  return (
    <div className="rpt-replay">
      <div className="rpt-replay-layout-seg rpt-mode-seg">
        {LAYOUT_MODES.map(([value, label]) => (
          <button
            key={value}
            className={mode === value ? "active" : ""}
            onClick={() => setMode(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className={`rpt-replay-stage mode-${mode}`}
        ref={stageRef}
        style={
          {
            gridTemplateColumns:
              mode === "split" ? `${ratio}fr 6px ${1 - ratio}fr` : "1fr",
            // Injected only in map-only mode: in split/gcd mode the sizing is
            // owned by ratio, so don't let this variable leak into their CSS.
            //
            // We hand over a **width**, not a height: the arena SVG pins its
            // aspectRatio, so height follows from width, and width can be
            // clamped into the container by minmax(0, …) — a height-driven
            // layout has no such upper bound, so in a narrow window the map
            // bursts out of the grid and pushes the enemy health frames on top
            // of it (measured: 900px container + 1400px height → the grid
            // overflows to 1416px and the right column lands at x=776, right on
            // the map). So the height is the *intent* and the width is the
            // *shrinkable implementation*.
            ...(mode === "map"
              ? { "--map-w": `${Math.round(mapHeight * (VW / VH))}px` }
              : {}),
          } as React.CSSProperties
        }
      >
        {mode !== "gcd" && (
          <div className="rpt-replay-arena-col">
            <div className="rpt-replay-arena-grid">
              <div
                className="rpt-replay-map-cell"
                ref={(el) => {
                  // hotZoneRef is a callback ref (useReplayZoom binds the wheel
                  // listener in it), not a RefObject — it must be CALLED, you
                  // cannot assign to .current
                  zoom.hotZoneRef(el);
                  mapCellRef.current = el;
                }}
              >
                <svg
                  ref={zoom.svgRef}
                  className={
                    view ? "rpt-replay-field zoomed" : "rpt-replay-field"
                  }
                  viewBox={
                    view
                      ? `${view.x} ${view.y} ${view.w} ${view.h}`
                      : `0 0 ${VW} ${VH}`
                  }
                  data-testid="rpt-replay-field"
                  preserveAspectRatio="xMidYMid meet"
                  style={
                    {
                      aspectRatio: `${VW} / ${VH}`,
                      // Constant sizes on the CSS side (font-size /
                      // stroke-width) use this variable in calc() to cancel
                      // out the viewport shrink; at k=1, calc(x*1)=x, which is
                      // pixel-identical to the behavior before this change.
                      "--rpt-zoom-k": k,
                    } as React.CSSProperties
                  }
                  onPointerDown={(e) => {
                    if (!view) return;
                    panRef.current = { px: e.clientX, py: e.clientY };
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    if (!view || !panRef.current) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    zoom.panByPixels(
                      e.clientX - panRef.current.px,
                      e.clientY - panRef.current.py,
                      rect,
                    );
                    panRef.current = { px: e.clientX, py: e.clientY };
                  }}
                  onPointerUp={() => {
                    panRef.current = null;
                  }}
                  onDoubleClick={zoom.reset}
                >
                  {/* Circular clip for the unit spec icons (local coordinates
                      inside the unit group; one shared clip for all units) */}
                  <defs>
                    <clipPath id="rpt-unit-clip">
                      <circle r={11 * k} cx={0} cy={0} />
                    </clipPath>
                  </defs>
                  {zoneMap ? (
                    <>
                      {/* Floor (shows through when the base map is a
                          transparent obstacle image) */}
                      <rect
                        x={0}
                        y={0}
                        width={VW}
                        height={VH}
                        className="rpt-replay-map-floor"
                      />
                      {/* An external minimap image used to be layered here.
                          Removed: those images contain no map art, only a few
                          blocks co-located with the arenaObstacles drawn below
                          — i.e. re-drawing obstacles we already draw. See the
                          note in arenaMaps.ts. */}
                      {/* A darkening veil, so dots/trails keep contrast against
                          the base map */}
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
                      {/* Faint glow band over the central area */}
                      <circle
                        cx={cxA}
                        cy={cyA}
                        r={Math.min(aw, ah) * 0.4}
                        className="rpt-replay-zone"
                      />
                      {/* Pillars (spatial anchors) */}
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
                      {/* Grid lines */}
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
                  {/* Walkable-floor outline (measured from the corpus): arena
                      edges + starting rooms, an LoS reference */}
                  {floorOutline && (
                    <polygon
                      className="rpt-replay-floor-outline"
                      points={floorOutline
                        .map(([fx, fy]) => `${toX(fx)},${toY(fy)}`)
                        .join(" ")}
                    />
                  )}
                  {/* Obstacles (LoS geometry, same source as the analysis
                      predicate) */}
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
                  {/* Movement trails (the last few seconds) */}
                  {tracks.map((tr) => {
                    // don't draw a path that was never walked
                    if (!positionKnownAt(tr, t)) return null;
                    const pts = pathUpTo(tr, t);
                    if (pts.length < 2) return null;
                    return (
                      <polyline
                        key={`tr${tr.unitId}`}
                        className="rpt-replay-trail"
                        points={pts
                          .map((p) => `${toX(p.x)},${toY(p.y)}`)
                          .join(" ")}
                        stroke={classColor(tr.classId)}
                      />
                    );
                  })}
                  {/* Death: ghost + ✕ */}
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
                          r={13 * k}
                          className="rpt-replay-ghost"
                          fill={classColor(tr.classId)}
                        />
                        <text
                          x={cx}
                          y={cy + 4 * k}
                          className="rpt-replay-death"
                        >
                          ✕
                        </text>
                        <title>{`${tr.name} 阵亡${onDeathClick ? " — 点击看死亡回顾" : ""}`}</title>
                      </g>
                    );
                  })}
                  {/* Living units: class-color dot + glyph + name + health bar.
                The hovered unit (from the sidebar or the map) is sorted last =
                topmost in the SVG, so it stays readable when units overlap */}
                  {(hoverUnit
                    ? [
                        ...tracks.filter((tr) => tr.unitId !== hoverUnit),
                        ...tracks.filter((tr) => tr.unitId === hoverUnit),
                      ]
                    : tracks
                  ).map((tr) => {
                    const at = sampleAt(tr, t);
                    if (!at) return null;
                    // Before the first sample the log holds no coordinates for
                    // this unit at all — sampleAt can only pin the position to
                    // that first sample, which is "where they first got pulled
                    // into combat". Mark it as unknown so nobody reads the map
                    // as "he stood there for a dozen seconds".
                    const known = positionKnownAt(tr, t);
                    const cx = toX(at.x);
                    const cy = toY(at.y);
                    const hp =
                      at.maxHp > 0
                        ? Math.max(0, Math.min(1, at.hp / at.maxHp))
                        : 1;
                    return (
                      <g
                        key={tr.unitId}
                        className={
                          known
                            ? "rpt-replay-unit"
                            : "rpt-replay-unit rpt-replay-unit-unknown"
                        }
                        onMouseEnter={() => setHoverUnit(tr.unitId)}
                        onMouseLeave={() => setHoverUnit(null)}
                      >
                        {hoverUnit === tr.unitId && (
                          <circle
                            cx={cx}
                            cy={cy}
                            r={17 * k}
                            className="rpt-replay-hover-ring"
                          />
                        )}
                        {/* Burst glow pulse: an offensive major cooldown is
                            active (the span uses the same predicate as the
                            burst ledger) */}
                        {(() => {
                          const span = (burstAuras[tr.unitId] ?? []).find(
                            (s) => t >= s.fromMs && t <= s.toMs,
                          );
                          if (!span) return null;
                          return (
                            <circle
                              cx={cx}
                              cy={cy}
                              r={19 * k}
                              className="rpt-replay-burst-ring"
                            >
                              <title>{`${tr.name} 爆发中:${span.spellName}`}</title>
                            </circle>
                          );
                        })()}
                        {/* Same-second focus-fire highlight: 2+ hostile players
                            hit this target within the same second */}
                        {(() => {
                          const sec = Math.floor((t - source.startTime) / 1000);
                          const n = focusFire[tr.unitId]?.[sec];
                          if (!n) return null;
                          return (
                            <circle
                              cx={cx}
                              cy={cy}
                              r={16 * k}
                              className="rpt-replay-focus-ring"
                            >
                              <title>{`集火:${n} 人同秒打击 ${tr.name}`}</title>
                            </circle>
                          );
                        })()}
                        {/* CC state (user request 2026-08-14): while
                            controlled, a dashed status ring plus a drain bar
                            (remaining fraction) with the CC name and seconds
                            left. Hard CC = gold, root = the secondary style. */}
                        {(() => {
                          const cc = activeCcAt(ccSpans[tr.unitId] ?? [], t);
                          if (!cc) return null;
                          const total = Math.max(1, cc.toMs - cc.fromMs);
                          const frac = Math.max(
                            0,
                            Math.min(1, (cc.toMs - t) / total),
                          );
                          const remainS = Math.max(0, (cc.toMs - t) / 1000);
                          const root = cc.kind === "root";
                          return (
                            <g>
                              <circle
                                cx={cx}
                                cy={cy}
                                r={15.5 * k}
                                className={
                                  root
                                    ? "rpt-replay-cc-ring root"
                                    : "rpt-replay-cc-ring"
                                }
                              >
                                <title>{`${tr.name} ${root ? "被定身" : "被控制"}:${cc.spellName}(剩 ${remainS.toFixed(1)}s)`}</title>
                              </circle>
                              <g
                                className={
                                  root
                                    ? "rpt-replay-cc-bar root"
                                    : "rpt-replay-cc-bar"
                                }
                              >
                                <rect
                                  x={cx - 16 * k}
                                  y={cy + 27 * k}
                                  width={32 * k}
                                  height={3.5 * k}
                                  rx={1.75 * k}
                                  className="rpt-replay-hp-track"
                                />
                                <rect
                                  x={cx - 16 * k}
                                  y={cy + 27 * k}
                                  width={32 * frac * k}
                                  height={3.5 * k}
                                  rx={1.75 * k}
                                  className="rpt-replay-cc-fill"
                                />
                                <text
                                  x={cx}
                                  y={cy + 37 * k}
                                  className="rpt-replay-cc-text"
                                >
                                  {cc.spellName} 剩{remainS.toFixed(1)}s
                                </text>
                              </g>
                            </g>
                          );
                        })()}
                        {labelInfo.visible.has(tr.unitId) &&
                          (() => {
                            const lift = labelInfo.lift.get(tr.unitId) ?? 0;
                            return (
                              <g>
                                {lift > 0 && (
                                  <line
                                    x1={cx}
                                    y1={cy - 14 * k}
                                    x2={cx}
                                    y2={cy - (16 + lift) * k}
                                    className="rpt-replay-name-lead"
                                  />
                                )}
                                <text
                                  x={cx}
                                  y={cy - (19 + lift) * k}
                                  className="rpt-replay-name"
                                >
                                  {tr.name}
                                </text>
                              </g>
                            );
                          })()}
                        {!known && (
                          <title>
                            {`${tr.name}:该时刻日志里还没有他的坐标(跑动不产生战斗日志记录)。圆点画在他首次卷入战斗的位置,不代表他此刻在这儿。`}
                          </title>
                        )}
                        <circle
                          cx={cx}
                          cy={cy}
                          r={13 * k}
                          fill={classColor(tr.classId)}
                          stroke={sideRing(tr.side)}
                          strokeWidth={2.5 * k}
                          fillOpacity={0.4 + 0.6 * hp}
                          data-testid="rpt-unit-marker"
                        />
                        <text
                          x={cx}
                          y={cy + 3.2 * k}
                          className="rpt-replay-glyph"
                        >
                          {classGlyph(tr.classId)}
                        </text>
                        {/* Spec icon overlay (fetched the same way as in the
                      match list); when unavailable we draw nothing and the
                      class-color dot + glyph underneath is the fallback */}
                        {specIcons[specIconName(tr.specId) ?? ""] && (
                          <g
                            transform={`translate(${cx},${cy})`}
                            clipPath="url(#rpt-unit-clip)"
                            pointerEvents="none"
                          >
                            <image
                              href={specIcons[specIconName(tr.specId) ?? ""]}
                              x={-11 * k}
                              y={-11 * k}
                              width={22 * k}
                              height={22 * k}
                              preserveAspectRatio="xMidYMid slice"
                            />
                          </g>
                        )}
                        <rect
                          x={cx - 16 * k}
                          y={cy + 16 * k}
                          width={32 * k}
                          height={4 * k}
                          rx={2 * k}
                          className="rpt-replay-hp-track"
                        />
                        <rect
                          x={cx - 16 * k}
                          y={cy + 16 * k}
                          width={32 * hp * k}
                          height={4 * k}
                          rx={2 * k}
                          fill={hpColor(hp)}
                        />
                        {/* HP number (#11c) */}
                        <text
                          x={cx + 20 * k}
                          y={cy + 20.5 * k}
                          className="rpt-replay-hpnum"
                          fill={hpColor(hp)}
                        >
                          {Math.round(hp * 100)}%
                        </text>
                        {/* Real cast bars: an in-progress cast draws its
                            progress under the health bar (gold = will finish,
                            red = got interrupted) */}
                        {(() => {
                          const bar = castBarAt(
                            castBarsByUnit[tr.unitId] ?? [],
                            t,
                          );
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
                                x={cx - 16 * k}
                                y={cy + 22 * k}
                                width={32 * k}
                                height={3 * k}
                                rx={1.5 * k}
                                className="rpt-replay-hp-track"
                              />
                              <rect
                                x={cx - 16 * k}
                                y={cy + 22 * k}
                                width={32 * frac * k}
                                height={3 * k}
                                rx={1.5 * k}
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
                        {/* Cast flash (#11b): a just-succeeded cast flashes
                            above the unit for 1.2s */}
                        {(() => {
                          const cs = castsByUnit[tr.unitId] ?? [];
                          let last: (typeof cs)[number] | null = null;
                          for (const c of cs) {
                            if (c.t > t) break;
                            if (t - c.t <= 1200) last = c;
                          }
                          if (!last) return null;
                          // Move up out of the way when it would overlap the
                          // name label of the same unit in this frame (P1-5)
                          const dodge = labelInfo.visible.has(tr.unitId)
                            ? 12 + (labelInfo.lift.get(tr.unitId) ?? 0)
                            : 0;
                          return (
                            <text
                              x={cx}
                              y={cy - (30 + dodge) * k}
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
                <ReplayZoomControls
                  zoomLevel={zoom.zoomLevel}
                  onZoomIn={() => zoom.applyZoom(0.8, 0.5, 0.5)}
                  onZoomOut={() => zoom.applyZoom(1.25, 0.5, 0.5)}
                  onReset={zoom.reset}
                />
              </div>

              {/* Map-only mode: drag the bottom edge to change the height
                  (width follows from aspectRatio = uniform scaling) */}
              {mode === "map" && (
                <ReplayMapResizer
                  mapHeight={mapHeight}
                  onHeightChange={setMapHeight}
                  cellRef={mapCellRef}
                />
              )}

              {/* Arena unit frames (1f): pinned to both sides of the field,
                  friendly left / enemy right, so health stays readable no
                  matter how units overlap on the map */}
              {(["friendly", "enemy"] as const).map((side) => (
                <div
                  key={side}
                  className={`rpt-replay-frames ${side}`}
                  data-testid={`rpt-frames-${side}`}
                >
                  {tracks
                    .filter((tr) =>
                      side === "friendly"
                        ? tr.side === "friendly"
                        : tr.side !== "friendly",
                    )
                    .map((tr) => {
                      const at = sampleAt(tr, t);
                      // Death uses the same predicate as the old legend
                      // (deathT); do not route it through a null from sampleAt
                      const dead = tr.deathT != null && t >= tr.deathT;
                      const hp =
                        at && at.maxHp > 0
                          ? Math.max(0, Math.min(1, at.hp / at.maxHp))
                          : 0;
                      // Three-band color for the percentage (1f): >60% safe /
                      // 30–60% warning / <30% danger
                      const pctColor =
                        hp > 0.6
                          ? "var(--win)"
                          : hp >= 0.3
                            ? "var(--gold)"
                            : "var(--loss)";
                      const bursting = (burstAuras[tr.unitId] ?? []).some(
                        (s) => t >= s.fromMs && t <= s.toMs,
                      );
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
                          <span className="rpt-frame-main">
                            <span className="rpt-frame-name">
                              {tr.name}
                              {bursting && !dead && (
                                <span className="rpt-frame-burst">爆发</span>
                              )}
                            </span>
                            {dead ? (
                              <span className="rpt-frame-dead">
                                ✝ 阵亡 {relTime(tr.deathT!, startTime)}
                              </span>
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
                            {!dead && (
                              <span
                                className="rpt-frame-pct"
                                style={{ color: pctColor }}
                              >
                                {Math.round(hp * 100)}%
                              </span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                </div>
              ))}
            </div>
          </div>
        )}

        {mode === "split" && (
          <ReplaySplitter
            ratio={ratio}
            onRatioChange={setRatio}
            stageRef={stageRef}
          />
        )}

        {mode !== "map" && (
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
            bands={vulnBands}
            compact={gcdCompact}
            onCompactChange={setGcdCompact}
          />
        )}
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
        <span className="rpt-replay-time">
          {relTime(t, startTime)} / {relTime(endTime, startTime)}
        </span>
        <div className="rpt-replay-scrub-wrap">
          {/* KILL WINDOW / VULNERABLE bands: gold = a kill-attempt burst,
              grey-red = a vulnerable stretch nobody punished */}
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
            aria-label="回放时间轴"
            className="rpt-replay-scrub"
            min={startTime}
            max={endTime}
            step={100}
            value={t}
            onChange={(e) => setT(Number(e.target.value))}
          />
        </div>
        {(() => {
          const d = dampeningAt(dampSeries, (t - source.startTime) / 1000);
          return d != null && d > 0 ? (
            <span className="rpt-replay-damp" title="治疗衰减(dampening)">
              衰减 {d}%
            </span>
          ) : null;
        })()}
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
        {/* "深挖此刻" (Task 6): one-click AI deep-dive on a ±10s window around
            the current playback instant — jumps to the report view where the
            result renders (same card as the toolbar's "AI 分析此段"). */}
        <button
          className="rpt-btn rpt-replay-moment-dive"
          data-testid="moment-dive"
          title="对当前时刻前后 10s 做一次 AI 深挖(密集快照)"
          onClick={() => onMomentDive?.((t - source.startTime) / 1000)}
        >
          深挖此刻
        </button>
        {/* Hotkeys / legend folded away (P1-7): a "?" button with a permanent
            tooltip plus a one-shot card on click */}
        <button
          className="rpt-replay-help"
          title={`${HINT_KEYS}\n${HINT_LEGEND}`}
          aria-label="快捷键与图例说明"
          onClick={() => setShowHelp((v) => !v)}
        >
          ?
        </button>
        {showHelp && (
          <div
            className="rpt-replay-help-pop"
            onClick={() => setShowHelp(false)}
          >
            <p>{HINT_KEYS}</p>
            <p>{HINT_LEGEND}</p>
          </div>
        )}
      </div>
    </div>
  );
}
