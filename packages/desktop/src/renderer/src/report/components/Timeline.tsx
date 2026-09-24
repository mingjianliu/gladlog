import { fmtTime } from "@gladlog/analysis";
import { scaleLinear } from "d3-scale";
import { useMemo, useState } from "react";

import { classColor } from "../data/gameConstants";
import {
  CURVE_METRIC_LABEL,
  CURVE_METRIC_ORDER,
  type CurveMetric,
  type FlowSeriesData,
} from "../derive/flowSeries";
import { abbrevAmount } from "../derive/meterRows";
import { shortUnitName, type TeamSide } from "../derive/teamSide";
import type { ExposureMark, PressureBand } from "../derive/pressureLanes";
import { TeamDot } from "./TeamDot";
import {
  activeRuns,
  type HpPoint,
  type TimelineData,
} from "../derive/timeline";
import type { TimeRange } from "../derive/timeRange";
import type { VulnBand } from "../derive/vulnWindows";

/** A drag must span at least this many viewBox pixels to count as a window
 * selection; anything shorter is treated as a plain click (the onClick of
 * bands / curves / death markers is unaffected). */
const DRAG_MIN_PX = 8;

// UI redesign 1a: with two columns the left column is ~1100-1500px, and the
// viewBox scales proportionally, which decides the real height — 800×240
// (10:3) would blow up to 450px tall in a wide column; 1200×240 (5:1) makes a
// 1100px column land at ~220px (the number in the design). TIMELINE_BUCKETS
// (derive/timeline.ts) is kept at 1160 to preserve the invariant
// "bucket count ≈ plot-area width".
const W = 1200,
  H = 240,
  PAD = { l: 34, r: 8, t: 18, b: 18 };
/** Left padding while a flow metric is selected: the axis then reads "1.20M"
 * instead of "100%", which does not fit in PAD.l at the 10px mono of
 * .rpt-tl-axis. Widening it (rather than shortening the number) keeps a single
 * amount formatter — abbrevAmount, shared with the meters leaderboard — and
 * leaves the HP view pixel-identical to before. */
const FLOW_PAD_L = 46;
/** Gap shaved off each per-second bar so a dense match still reads as bars
 * rather than one solid area; floored so a long match keeps them visible. */
const BAR_GAP = 0.6;
/** Height of the pressure lane (#4): a thin strip drawn along the bottom edge
 * inside the plot area — H is unchanged and the curves are not squeezed. */
const LANE_H = 8;
/** Lane spacing (#10 T2): the gap where the dampening lane sits directly above
 * the pressure lane. */
const LANE_GAP = 2;

/**
 * Smooth path via Catmull-Rom → cubic Bézier: connecting the per-second HP
 * samples with straight segments looks far too harsh. Control-point y values
 * are clamped inside the plot area so overshoot at a sharp drop or spike
 * cannot draw the illusion of >100% or <0%.
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
  // Endpoint y values are clamped too (logging jitter can yield ratios >100%
  // or <0%, and clamping only the control points would leave a kink at the
  // boundary); control-point x is clamped inside its segment so non-uniform
  // sampling cannot make the time axis bend backwards.
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
  onSetHidden,
  hidden,
  onDeathClick,
  bands,
  onBandClick,
  cursorT,
  range,
  onRangeSelect,
  marks,
  onMarkClick,
  pressure,
  dampening,
  metric,
  onMetric,
  flow,
  teamSides,
}: {
  data: TimelineData;
  onSelectUnit?: (unitId: string) => void;
  /** Bulk setter for the SAME hidden set `onSelectUnit` toggles one entry of.
   * Exists for 只看我方, which has to change several entries at once; a
   * per-unit loop through `onSelectUnit` would fight that setter's solo/restore
   * cycle. Omit it and the button is not rendered. */
  onSetHidden?: (next: Set<string>) => void;
  /** Set of hidden unitIds: these players' HP curves / death markers are not
   * drawn. */
  hidden?: Set<string>;
  /** Clicking a death marker opens the death review (backlog #6). t is
   * absolute ms. */
  onDeathClick?: (unitId: string, t: number) => void;
  /** KILL WINDOW / VULNERABLE background bands (relative seconds); a click
   * replays that instant. */
  bands?: VulnBand[];
  onBandClick?: (tSeconds: number) => void;
  /** Replay cursor projection (1c): the last instant when switching back from
   * the replay (absolute ms). */
  cursorT?: number | null;
  /** Time-window linkage ①: the current window (relative seconds), drawn as a
   * highlighted selection; the curves always cover the whole match. */
  range?: TimeRange | null;
  /** Drag on the chart to commit a window (relative seconds). */
  onRangeSelect?: (fromS: number, toS: number) => void;
  /** Mistake markers (phase four ③): ⚠ along the top, click to jump into the
   * replay. */
  marks?: Array<{ tS: number; label: string; severity: string }>;
  onMarkClick?: (tS: number) => void;
  /** Pressure lane (#4): spikes as a thin strip at the bottom (click to set
   * the time window) plus exposure diamond markers. */
  pressure?: { spikes: PressureBand[]; exposures: ExposureMark[] };
  /** Dampening lane (#10 T2): a dense per-second 0-100 percentage series drawn
   * as its own thin strip directly above the pressure lane, with opacity
   * mapped from pct/100. */
  dampening?: Array<{ tS: number; pct: number }>;
  /** What the chart plots. "hp" (the default, and what every caller that
   * predates the dropdown gets) draws the per-unit HP-ratio curves; any other
   * value draws `flow` as per-second stacked bars instead. */
  metric?: CurveMetric;
  /** Provided = the metric dropdown is shown. */
  onMetric?: (m: CurveMetric) => void;
  /** Per-second buckets for the selected flow metric — whole-match basis, same
   * as the HP curves (a time window highlights, it does not crop). */
  flow?: FlowSeriesData | null;
  /** unitId → side. Enemy curves draw dashed and every legend entry gets a
   * team dot; omitted (or "unknown") means the log has no sides to show and
   * nothing is drawn rather than something that might be wrong. */
  teamSides?: Map<string, TeamSide>;
}) {
  const [cursor, setCursor] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  // Hover focus (UI review #2): transient, local — never lifted (same rule as
  // the replay clock). Set by hovering a curve or a legend entry; every other
  // curve and its death marker get .rpt-tl-dim.
  const [focusUnitId, setFocusUnitId] = useState<string | null>(null);
  const activeMetric: CurveMetric = metric ?? "hp";
  const isFlow = activeMetric !== "hp";
  const padL = isFlow ? FLOW_PAD_L : PAD.l;
  const series = useMemo(
    () =>
      hidden ? data.series.filter((s) => !hidden.has(s.unitId)) : data.series,
    [data, hidden],
  );
  const deaths = hidden
    ? data.deaths.filter((d) => !hidden.has(d.unitId))
    : data.deaths;
  const x = scaleLinear()
    .domain([data.start, data.end])
    .range([padL, W - PAD.r]);
  const y = scaleLinear()
    .domain([0, 1])
    .range([H - PAD.b, PAD.t]);
  // Flow view: visible units only (the legend / meter-row toggles apply to bars
  // exactly as they do to curves), plus the per-second stacked totals that set
  // the axis scale and back the hover readout.
  const flowView = useMemo(() => {
    if (!isFlow || !flow) return null;
    const units = hidden
      ? flow.units.filter((u) => !hidden.has(u.unitId))
      : flow.units;
    const totals = new Array<number>(flow.bucketCount).fill(0);
    for (const u of units)
      for (let i = 0; i < flow.bucketCount; i++)
        totals[i] = (totals[i] ?? 0) + (u.buckets[i] ?? 0);
    let max = 0;
    for (const v of totals) if (v > max) max = v;
    // Scaled to the visible units, not to everything: hiding the top damage
    // dealer is how you get to read the rest of the stack.
    return { units, totals, max };
  }, [isFlow, flow, hidden]);
  const flowMax = flowView?.max ?? 0;
  /** Bar tops share the HP curve's y scale, expressed as a fraction of the
   * per-second peak — one scale for the whole chart, so the 0/½/max gridlines
   * sit exactly where they do in HP mode. */
  const yFlow = (v: number): number => y(flowMax > 0 ? v / flowMax : 0);
  // The `d` string of each path is the most expensive product of this whole
  // component (hundreds to thousands of Bézier segments per curve). The
  // cursor/dragFrom setState on mousemove re-renders dozens of times per
  // second, so `d` must be memoized along the data dimension — otherwise
  // sweeping across the chart rebuilds every curve string and makes the
  // browser re-parse every path, every frame.
  const linePaths = useMemo(
    () =>
      series.map((s) => {
        const toXY = (p: HpPoint) => ({
          x: x(p.t),
          y: y(p.maxHp > 0 ? p.hp / p.maxHp : 0),
        });
        return {
          s,
          d: smoothPath(s.points.map(toXY), PAD.t, H - PAD.b),
          // Plateau fade (UI review #2): the crisp sub-plateau runs drawn on
          // top of the faded full curve. Same samples, nothing removed.
          segs: activeRuns(s.points).map((run) =>
            smoothPath(run.map(toXY), PAD.t, H - PAD.b),
          ),
        };
      }),
    // x/y are rebuilt on every render but are fully determined by data + padL,
    // so the deps are anchored on those
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, data, padL],
  );
  // Same reason as linePaths, and then some: a 5-minute match is ~300 buckets ×
  // 6 units, which as <rect> elements would be ~1800 nodes re-laid-out on every
  // mousemove. Each unit collapses to ONE path whose `d` concatenates its
  // rectangles, and the whole thing is memoized off the data dimension.
  const barPaths = useMemo(() => {
    if (!isFlow || !flow || !flowView || flowView.max <= 0) return [];
    // Running stack offset per bucket; units come out team-then-name ordered
    // (deriveFlowSeries), so each team's contribution stays contiguous.
    const stack = new Array<number>(flow.bucketCount).fill(0);
    return flowView.units.map((u) => {
      let d = "";
      for (let i = 0; i < flow.bucketCount; i++) {
        const v = u.buckets[i] ?? 0;
        if (v <= 0) continue;
        const base = stack[i] ?? 0;
        const x0 = x(flow.start + i * flow.bucketMs);
        const w = Math.max(
          0.8,
          x(flow.start + (i + 1) * flow.bucketMs) - x0 - BAR_GAP,
        );
        const yBot = yFlow(base);
        const yTop = yFlow(base + v);
        stack[i] = base + v;
        d += `M${x0.toFixed(1)},${yBot.toFixed(1)}h${w.toFixed(1)}V${yTop.toFixed(1)}h${(-w).toFixed(1)}Z`;
      }
      return { u, d };
    });
    // x/yFlow are rebuilt every render but are fully determined by these
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFlow, flow, flowView, data, padL]);
  const relSec = (t: number) => ((t - data.start) / 1000).toFixed(1);

  // Dampening lane (#10 T2): the dense per-second series is first merged into
  // runs of equal pct (RLE) — otherwise one rect per second means hundreds of
  // <rect>s in a long match, all visually identical blocks of colour.
  const dampBands = useMemo(() => {
    if (!dampening || dampening.length === 0) return [];
    const bands: Array<{ fromS: number; toS: number; pct: number }> = [];
    for (const p of dampening) {
      const last = bands[bands.length - 1];
      if (last && last.pct === p.pct) {
        last.toS = p.tS + 1;
      } else {
        bands.push({ fromS: p.tS, toS: p.tS + 1, pct: p.pct });
      }
    }
    return bands;
  }, [dampening]);

  // ⚠ clustering (P1-4): sort by x projection and merge each run of markers
  // less than 8px apart into a single ⚠N
  const MARK_CLUSTER_PX = 8;
  const SEV_RANK: Record<string, number> = { major: 0, average: 1, minor: 2 };
  const markGroups: Array<{
    x: number;
    items: Array<{ tS: number; label: string; severity: string }>;
  }> = [];
  for (const mk of (marks ?? [])
    .filter((mk) => mk.tS > 0)
    .map((mk) => ({ ...mk, px: x(data.start + mk.tS * 1000) }))
    .sort((a, b) => a.px - b.px)) {
    const last = markGroups[markGroups.length - 1];
    const lastX = last?.items.length
      ? x(data.start + last.items[last.items.length - 1]!.tS * 1000)
      : null;
    if (last && lastX !== null && mk.px - lastX < MARK_CLUSTER_PX)
      last.items.push(mk);
    else markGroups.push({ x: mk.px, items: [mk] });
  }
  const worstSev = (items: Array<{ severity: string }>): string =>
    items.reduce(
      (w, m) =>
        (SEV_RANK[m.severity] ?? 9) < (SEV_RANK[w] ?? 9) ? m.severity : w,
      items[0]?.severity ?? "minor",
    );
  // Death-label avoidance (P1-4): if it is within 40px in x of any ⚠ group or
  // of a neighbouring death label → anchor left and draw a leader line
  const AVOID_PX = 40;
  const deathFlip = deaths.map((d, i) => {
    const dx = x(d.t);
    return (
      markGroups.some((g) => Math.abs(g.x - dx) < AVOID_PX) ||
      deaths.some(
        (o, j) => j !== i && Math.abs(x(o.t) - dx) < AVOID_PX && j < i,
      )
    );
  });
  /** Hover readout in flow mode: the stacked total of the second under the
   * cursor, abbreviated exactly as the axis and the meters leaderboard do. */
  const hoverAmount = (px: number): string => {
    if (!isFlow || !flow || !flowView || flowView.max <= 0) return "";
    const raw = Math.floor((x.invert(px) - flow.start) / flow.bucketMs);
    const i = Math.min(flow.bucketCount - 1, Math.max(0, raw));
    return ` · ${abbrevAmount(flowView.totals[i] ?? 0)}`;
  };
  const legendUnits: Array<{ unitId: string; name: string; classId: number }> =
    isFlow ? (flow?.units ?? []) : data.series;
  const sideOf = (unitId: string): TeamSide =>
    teamSides?.get(unitId) ?? "unknown";
  /** 本场 roster 里所有非我方单位是否都已隐藏 —— 「只看我方」按钮的当前态。
   *  按 roster 判定而非按 hidden 是否非空:hidden 跨对局保留,可能含别场的 id。
   *  没有非我方单位时(单人 fixture)恒为 false,免得按钮显示成已激活。 */
  const nonFriendly = legendUnits.filter(
    (s) => sideOf(s.unitId) !== "friendly",
  );
  const friendlyOnly =
    nonFriendly.length > 0 && nonFriendly.every((s) => hidden?.has(s.unitId));

  return (
    <div className="rpt-timeline-wrap">
      {onMetric && (
        <div className="rpt-tl-head">
          <span className="rpt-card-label">曲线</span>
          <select
            data-testid="tl-metric"
            aria-label="曲线指标"
            value={activeMetric}
            onChange={(e) => onMetric(e.target.value as CurveMetric)}
            title="血量画曲线;伤害/治疗/承伤/被治疗按每秒堆叠柱显示(全场口径,时间窗只高亮不裁剪)"
          >
            {CURVE_METRIC_ORDER.map((k) => (
              <option key={k} value={k}>
                {CURVE_METRIC_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
      )}
      <svg
        data-testid="rpt-timeline"
        viewBox={`0 0 ${W} ${H}`}
        className="rpt-timeline"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setCursor(((e.clientX - rect.left) / rect.width) * W);
        }}
        onMouseLeave={() => {
          setCursor(null);
          setDragFrom(null);
        }}
        onMouseDown={
          onRangeSelect
            ? (e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setDragFrom(((e.clientX - rect.left) / rect.width) * W);
              }
            : undefined
        }
        onMouseUp={
          onRangeSelect
            ? () => {
                if (
                  dragFrom !== null &&
                  cursor !== null &&
                  Math.abs(cursor - dragFrom) >= DRAG_MIN_PX
                ) {
                  const [a, b] = [
                    Math.min(dragFrom, cursor),
                    Math.max(dragFrom, cursor),
                  ];
                  const toRel = (px: number) =>
                    Math.max(
                      0,
                      Math.round((x.invert(px) - data.start) / 100) / 10,
                    );
                  onRangeSelect(toRel(a), toRel(b));
                }
                setDragFrom(null);
              }
            : undefined
        }
      >
        {[0, 0.5, 1].map((p) => (
          <g key={p}>
            <line
              x1={padL}
              x2={W - PAD.r}
              y1={y(p)}
              y2={y(p)}
              className="rpt-tl-grid"
            />
            <text x={4} y={y(p) + 4} className="rpt-tl-axis">
              {/* HP is a ratio; a flow axis is absolute amount per second, and
                  labelling an all-zero metric "0/0/0" would be noise. */}
              {!isFlow
                ? `${Math.round(p * 100)}%`
                : flowMax > 0
                  ? abbrevAmount(p * flowMax)
                  : ""}
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
        {/* Flow bars (per-second stacked columns) go here — after the bands,
            before the lanes — so the pressure / dampening strips, death ✕,
            ⚠ marks, window selection and replay cursor all stay legible on top
            of them instead of being buried. */}
        {barPaths.map(({ u, d }) => (
          <path
            key={u.unitId}
            className="rpt-tl-bar"
            data-testid="tl-flow-bar"
            fill={classColor(u.classId)}
            stroke="none"
            style={{ cursor: onSelectUnit ? "pointer" : undefined }}
            onClick={() => onSelectUnit?.(u.unitId)}
            d={d}
          >
            <title>{`${shortUnitName(u.name)} — 全场${CURVE_METRIC_LABEL[activeMetric]} ${abbrevAmount(u.total)}`}</title>
          </path>
        ))}
        {isFlow && flowMax <= 0 && (
          <text
            x={(padL + W - PAD.r) / 2}
            y={H / 2}
            textAnchor="middle"
            className="rpt-tl-empty"
            data-testid="tl-flow-empty"
          >
            本场无「{CURVE_METRIC_LABEL[activeMetric]}」数据
          </text>
        )}
        {/* Dampening lane (#10 T2): its own thin strip directly above the
            pressure lane, more opaque as pct rises; runs merged by RLE, with
            the percentage in the hover title. pct===0 runs ARE drawn (at
            opacity 0): SVG hit-testing ignores opacity, so the invisible rect
            still carries its "Dampening 0%" title — the #10 residual "hover
            dead zone" was exactly the pre-dampening stretch where no rect
            existed and hovering the lane showed nothing (fixed 2026-09-02). */}
        {dampBands.map((b, i) => {
          const x1 = x(data.start + b.fromS * 1000);
          const x2 = x(data.start + b.toS * 1000);
          return (
            <rect
              key={`dp${i}`}
              data-testid="rpt-damp-lane"
              className="rpt-dampening-lane"
              x={x1}
              width={Math.max(1, x2 - x1)}
              y={H - PAD.b - LANE_H * 2 - LANE_GAP}
              height={LANE_H}
              opacity={b.pct / 100}
            >
              <title>{`Dampening ${b.pct}%`}</title>
            </rect>
          );
        })}
        {/* Pressure lane (#4): spikes as a thin strip at the bottom (click to
            set the time window) plus exposure diamond markers. Drawn after the
            bands and before the curves — being overlapped by a curve is fine,
            the blocks are semi-transparent. */}
        {(pressure?.spikes ?? []).map((s, i) => {
          const x1 = x(data.start + s.fromS * 1000);
          const x2 = x(data.start + s.toS * 1000);
          const dmgM = (s.totalDamage / 1_000_000).toFixed(2);
          return (
            <rect
              key={`ps${i}`}
              data-testid="pressure-spike"
              className="rpt-pressure-spike"
              x={x1}
              width={Math.max(3, x2 - x1) /* min width, as bands do */}
              y={H - PAD.b - LANE_H}
              height={LANE_H}
              onClick={
                onRangeSelect ? () => onRangeSelect(s.fromS, s.toS) : undefined
              }
              style={{ cursor: onRangeSelect ? "pointer" : undefined }}
            >
              <title>{`${fmtTime(s.fromS)}–${fmtTime(s.toS)} ${shortUnitName(s.targetName)} 承压 ${dmgM}M(${s.dpsK}k DPS)${onRangeSelect ? "(点击设为时间窗)" : ""}`}</title>
            </rect>
          );
        })}
        {(pressure?.exposures ?? []).map((e, i) => {
          const cx = x(data.start + e.tS * 1000);
          const cy = H - PAD.b - LANE_H / 2;
          return (
            <path
              key={`pe${i}`}
              data-testid="pressure-exposure"
              className={`rpt-pressure-exposure rpt-pressure-exposure-${e.label.toLowerCase()}`}
              d={`M ${cx} ${cy - 5} L ${cx + 4} ${cy} L ${cx} ${cy + 5} L ${cx - 4} ${cy} Z`}
            >
              <title>{e.title}</title>
            </path>
          );
        })}
        {/* Time-window selection (①): the committed window highlighted, plus
            a live preview while dragging */}
        {range && (
          <rect
            data-testid="tl-range"
            className="rpt-tl-range"
            x={x(data.start + range.fromS * 1000)}
            y={PAD.t}
            width={Math.max(
              2,
              x(data.start + range.toS * 1000) -
                x(data.start + range.fromS * 1000),
            )}
            height={H - PAD.t - PAD.b}
          />
        )}
        {dragFrom !== null &&
          cursor !== null &&
          Math.abs(cursor - dragFrom) >= DRAG_MIN_PX && (
            <rect
              className="rpt-tl-range rpt-tl-range-preview"
              x={Math.min(dragFrom, cursor)}
              y={PAD.t}
              width={Math.abs(cursor - dragFrom)}
              height={H - PAD.t - PAD.b}
            />
          )}
        {(isFlow ? [] : linePaths).map(({ s, d, segs }) => {
          const enemy = sideOf(s.unitId) === "enemy";
          const dim = focusUnitId != null && focusUnitId !== s.unitId;
          const mod = `${enemy ? " rpt-tl-line-enemy" : ""}${dim ? " rpt-tl-dim" : ""}`;
          const common = {
            fill: "none",
            stroke: classColor(s.classId),
            strokeWidth: 2,
            strokeLinejoin: "round" as const,
            strokeLinecap: "round" as const,
            vectorEffect: "non-scaling-stroke" as const,
            style: { cursor: onSelectUnit ? "pointer" : undefined },
            onClick: () => onSelectUnit?.(s.unitId),
            onMouseEnter: () => setFocusUnitId(s.unitId),
            onMouseLeave: () => setFocusUnitId(null),
          };
          return (
            <g key={s.unitId}>
              {/* Base path = the whole curve, faded (plateau fade, UI review
                  #2); crisp .rpt-tl-seg runs on top where HP is actually
                  moving. Hovering a curve or its legend entry focuses it and
                  dims the rest. */}
              <path className={`rpt-tl-line${mod}`} d={d} {...common}>
                <title>{s.name}</title>
              </path>
              {segs.map((sd, k) => (
                <path
                  key={k}
                  className={`rpt-tl-seg${mod}`}
                  d={sd}
                  {...common}
                />
              ))}
            </g>
          );
        })}
        {/* Death markers (1c): a dot + ✕ with a name·time label above */}
        {deaths.map((d, i) => (
          <g
            key={i}
            className={[
              "rpt-tl-death",
              onDeathClick ? "rpt-tl-death-click" : "",
              focusUnitId != null && focusUnitId !== d.unitId
                ? "rpt-tl-dim"
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
            transform={`translate(${x(d.t).toFixed(1)},${PAD.t})`}
            onClick={
              onDeathClick ? () => onDeathClick(d.unitId, d.t) : undefined
            }
          >
            <circle r={5} className="rpt-tl-death-dot" />
            <text y={2.6} className="rpt-tl-death-x" textAnchor="middle">
              ✕
            </text>
            {deathFlip[i] ? (
              <g>
                <line
                  x1={-6}
                  x2={-14}
                  y1={-11}
                  y2={-11}
                  stroke="var(--hairline)"
                />
                <text
                  y={-8}
                  x={-16}
                  className="rpt-tl-death-label"
                  textAnchor="end"
                >
                  {shortUnitName(d.name)} {relSec(d.t)}s
                </text>
              </g>
            ) : (
              <text y={-8} className="rpt-tl-death-label" textAnchor="middle">
                {shortUnitName(d.name)} {relSec(d.t)}s
              </text>
            )}
            <title>{`${d.name} 死亡 @ ${relSec(d.t)}s${onDeathClick ? " — 点击看死亡回顾" : ""}`}</title>
          </g>
        ))}
        {/* Mistake ⚠ markers (phase four ③): small triangles along the top,
            coloured by severity; runs less than 8px apart merge into ⚠N
            (P1-4), the title lists each entry, and a click jumps to the first
            one in the group */}
        {markGroups.map((g, i) =>
          g.items.length === 1 ? (
            <text
              key={`mk${i}`}
              x={g.x}
              y={PAD.t - 6}
              textAnchor="middle"
              className={`rpt-tl-mistake rpt-tl-mistake-${g.items[0]!.severity}`}
              data-testid="tl-mistake"
              onClick={
                onMarkClick ? () => onMarkClick(g.items[0]!.tS) : undefined
              }
              style={{ cursor: onMarkClick ? "pointer" : undefined }}
            >
              ⚠<title>{g.items[0]!.label}</title>
            </text>
          ) : (
            <g
              key={`mk${i}`}
              data-testid="tl-mistake"
              className={`rpt-tl-mistake rpt-tl-mistake-${worstSev(g.items)}`}
              onClick={
                onMarkClick ? () => onMarkClick(g.items[0]!.tS) : undefined
              }
              style={{ cursor: onMarkClick ? "pointer" : undefined }}
            >
              <rect
                x={g.x - 10}
                y={PAD.t - 15}
                width={20 + (g.items.length > 9 ? 5 : 0)}
                height={11}
                rx={3}
                className="rpt-tl-mistake-plate"
              />
              <text x={g.x} y={PAD.t - 6} textAnchor="middle">
                ⚠{g.items.length}
              </text>
              <title>{g.items.map((m) => m.label).join("\n")}</title>
            </g>
          ),
        )}
        {/* Replay cursor projection (1c): accent dashed line + time label */}
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
        {cursor !== null && cursor >= padL && cursor <= W - PAD.r ? (
          <g>
            <line
              x1={cursor}
              x2={cursor}
              y1={PAD.t - 12}
              y2={H - PAD.b}
              className="rpt-tl-cursor"
            />
            <text x={cursor + 4} y={PAD.t - 4} className="rpt-tl-axis">
              {relSec(x.invert(cursor))}s{hoverAmount(cursor)}
            </text>
          </g>
        ) : null}
      </svg>
      {/* Legend (P1-4): a click toggles the same series as its curve; hidden
          series are dimmed. In flow mode it lists the flow rows (which exist
          without advanced logging, unlike the HP series). */}
      <div className="rpt-tl-legend" data-testid="tl-legend">
        {/* 只看我方(T7):六条曲线交叉时最难读的恰恰是默认态,但**不能**靠
            改默认值解决 —— hidden 是跨对局保留的(MatchReport 有逐项评审
            记录),而且同一份 hidden 还喂给伤害榜,预填敌方会让敌方六人默认
            置灰划线;首点 solo 的分支门也是「hidden 对本 roster 为空」,预填
            会把它永久打死。所以给一个显式开关,写的还是同一份 state:
            没有第二个真相源,伤害榜跟着同步,而且名单是**点击当下**按本场
            roster 算的,换轮次不会记着上一轮的敌人。 */}
        {onSetHidden && legendUnits.length > 1 && (
          <button
            type="button"
            className={
              friendlyOnly ? "rpt-tl-legend-only active" : "rpt-tl-legend-only"
            }
            aria-pressed={friendlyOnly}
            title={
              friendlyOnly
                ? "显示全部单位的曲线"
                : "只保留我方曲线(敌方仍可单独点开)"
            }
            onClick={() => {
              const next = new Set(hidden ?? []);
              // 只动本场 roster 的条目:hidden 里可能还留着别场对局的 id,
              // 那是刻意保留的用户偏好,不该被这个按钮清掉。
              if (friendlyOnly) {
                for (const s of legendUnits) next.delete(s.unitId);
              } else {
                for (const s of legendUnits) {
                  if (sideOf(s.unitId) !== "friendly") next.add(s.unitId);
                }
              }
              onSetHidden(next);
            }}
          >
            {friendlyOnly ? "全部" : "只看我方"}
          </button>
        )}
        {legendUnits.map((s) => (
          <button
            key={s.unitId}
            className={
              hidden?.has(s.unitId)
                ? "rpt-tl-legend-item off"
                : "rpt-tl-legend-item"
            }
            onClick={() => onSelectUnit?.(s.unitId)}
            onMouseEnter={() => setFocusUnitId(s.unitId)}
            onMouseLeave={() => setFocusUnitId(null)}
            onFocus={() => setFocusUnitId(s.unitId)}
            onBlur={() => setFocusUnitId(null)}
          >
            <TeamDot side={sideOf(s.unitId)} />
            <span
              className={
                sideOf(s.unitId) === "enemy" && !isFlow
                  ? "rpt-tl-legend-swatch dashed"
                  : "rpt-tl-legend-swatch"
              }
              style={
                sideOf(s.unitId) === "enemy" && !isFlow
                  ? {
                      // Mirror the curve's dash so the legend reads the same
                      // way the chart does.
                      backgroundImage: `repeating-linear-gradient(to right, ${classColor(s.classId)} 0 4px, transparent 4px 7px)`,
                    }
                  : { background: classColor(s.classId) }
              }
            />
            {shortUnitName(s.name)}
          </button>
        ))}
      </div>
    </div>
  );
}
