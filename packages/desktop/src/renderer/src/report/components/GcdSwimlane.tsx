import { fmtTime } from "@gladlog/analysis";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { classColor, classGlyph } from "../data/gameConstants";
import {
  auraCategory,
  deriveCasts,
  deriveGcdCasts,
  isMajorCd,
} from "../derive/casts";
import { clusterGcdCasts } from "../derive/gcdCluster";
import type { ReplayTrack } from "../derive/replay";
import { shortUnitName } from "../derive/teamSide";
import type { ReportSource } from "../derive/types";
import type { VulnBand } from "../derive/vulnWindows";
import { SpellIcon } from "./SpellIcon";
import { TeamDot } from "./TeamDot";
import { UnitName } from "./UnitName";

const PX_PER_SEC = 16;
const GCD_MS = 1500;
const TICK_SEC = 5; // 1f: ticks tightened from 15s to 5s (the background also has a divider every 5s)
const HEAD_H = 30; // Column-header height; the timeline/cursor must shift down by this much to line up with the column body
const CHIP_H = 23;
/** Max number of mini icons shown inline in a collapsed row; the rest fold
 * into +N. */
const MAX_MINIS = 3;

/** Whether this cast is a control (CC / root) — its target gets the prominent
 * treatment on chips (user request 2026-08-14). */
const isControlCast = (spellId: number): boolean => {
  const cat = auraCategory(spellId);
  return cat === "cc" || cat === "roots";
};

/** The visible target suffix for a chip: the target's short name (realm suffix
 * cut), hidden for self-casts and targetless casts. Returns null to render
 * nothing. */
const chipTarget = (
  m: { spellName: string; targetName: string },
  casterName: string,
): string | null => {
  if (!m.targetName || m.targetName === casterName) return null;
  return shortUnitName(m.targetName);
};
/** Fallback lane height, in px. NOT the rendered height any more — that is
 * `max(620px, 75vh)` in styles.css's .rpt-gcd-scroll, so a 4K screen shows
 * ~101s of lane instead of the 38.75s a fixed 620px allowed (620/16).
 * What is left here is the jsdom fallback: the tests have no ResizeObserver
 * and no layout, so `el.clientHeight` reads 0 and the windowing math below
 * would collapse to a zero-height window and mount nothing. */
const VIEWPORT_H = 620;
/** Overscan margin for vertical windowing: chips outside the window never
 * enter the DOM. In a long match laneH is 3500px+ while the viewport is only
 * 620px, so mounting everything = ~5000 elements reconciled per frame, 82% of
 * them off-screen (2026-07-26 audit). */
const OVERSCAN_PX = 600;
/** During playback, chips' elapsed/recent classification is quantized to
 * 250ms — re-rendering every chip each frame (60Hz) just to move a class-name
 * boundary by 1px is not worth it, and a 4Hz boundary step is invisible.
 * The paused/seek state uses the exact t: visual baseline screenshots must be
 * pixel-stable. */
const T_QUANT_MS = 250;

const sideRing = (side: string): string =>
  side === "friendly"
    ? "var(--win)"
    : side === "enemy"
      ? "var(--loss)"
      : "var(--mute)";

function Dot({ track }: { track: ReplayTrack }) {
  return (
    <span
      className="rpt-gcd-dot"
      style={{
        background: classColor(track.classId),
        borderColor: sideRing(track.side),
      }}
    >
      {classGlyph(track.classId)}
    </span>
  );
}

type Laid = { cl: import("../derive/gcdCluster").GcdCluster; y: number };

type FlashReq = { tMs: number; unitNames: string[]; nonce: number } | null;

/**
 * The memo boundary for the column bodies (all chips): the replay clock t
 * changes at 60Hz, but this component only consumes the 250ms-quantized tQ and
 * the hysteresis-damped window [winFrom, winTo] — in steady state the
 * per-frame reconcile drops from ~5000 elements to 0, and at 4Hz to the ~900
 * inside the window. Handlers go through the parent's ref trampolines (stable
 * identity); otherwise the arrow-function props ReplayView recreates each
 * frame would make the memo useless.
 */
const LaneBody = memo(function LaneBody({
  cols,
  laidByUnit,
  contentH,
  compact,
  flash,
  tQ,
  playing,
  startTime,
  winFrom,
  winTo,
  friendlyColCount,
  hasSeek,
  hasDeathClick,
  onSeek,
  onDeath,
  yFor,
}: {
  cols: ReplayTrack[];
  laidByUnit: Record<string, Laid[]>;
  contentH: number;
  compact: boolean;
  flash: FlashReq;
  tQ: number;
  playing: boolean;
  startTime: number;
  winFrom: number;
  winTo: number;
  friendlyColCount: number;
  hasSeek: boolean;
  hasDeathClick: boolean;
  onSeek: (tMs: number) => void;
  onDeath: (unitId: string, tMs: number) => void;
  yFor: (ts: number) => number;
}) {
  const fmtT = (ms: number) => {
    const sec = Math.max(0, (ms - startTime) / 1000);
    return fmtTime(sec);
  };
  return (
    <>
      {cols.map((tr, colIdx) => {
        const dead = tr.deathT != null;
        return (
          <div key={tr.unitId} className="rpt-gcd-col-wrap">
            {colIdx === friendlyColCount &&
              friendlyColCount > 0 &&
              colIdx < cols.length && (
                <div
                  className="rpt-gcd-divider"
                  data-testid="gcd-team-divider"
                  style={{ height: contentH + HEAD_H }}
                />
              )}
            <div className={compact ? "rpt-gcd-col compact" : "rpt-gcd-col"}>
              <div
                className={dead ? "rpt-gcd-col-head dead" : "rpt-gcd-col-head"}
              >
                <Dot track={tr} />
                <span className="rpt-gcd-col-name">
                  <UnitName name={tr.name} full />
                </span>
              </div>
              <div className="rpt-gcd-col-body" style={{ height: contentH }}>
                {(laidByUnit[tr.unitId] ?? []).map(({ cl, y }, i) => {
                  // Windowing: chips outside viewport ± overscan never enter
                  // the DOM.
                  if (y < winFrom || y > winTo) return null;
                  const c = cl.primary;
                  const members = [c, ...cl.minis];
                  const elapsed = c.t <= tQ;
                  const recent = elapsed && c.t >= tQ - GCD_MS;
                  const major = members.some((m) => isMajorCd(m.spellId));
                  // Evidence-chain gold flash: any member within ±2s of the
                  // target instant, and (no named units, or this column is
                  // named).
                  const flashed =
                    !!flash &&
                    members.some((m) => Math.abs(m.t - flash.tMs) <= 2000) &&
                    (flash.unitNames.length === 0 ||
                      flash.unitNames.includes(tr.name));
                  const cls = [
                    "rpt-gcd-act",
                    isMajorCd(c.spellId) ? "major" : "",
                    playing && !elapsed ? "future" : "",
                    recent ? "recent" : "",
                    flashed ? "flash" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  const title =
                    members
                      .map(
                        (m) =>
                          `${fmtT(m.t)} ${m.spellName}${m.targetName ? ` → ${m.targetName}` : ""}`,
                      )
                      .join("\n") + (hasSeek ? "\n(点击定位)" : "");
                  const visMinis = cl.minis.slice(0, MAX_MINIS);
                  const extra = cl.minis.length - visMinis.length;
                  return (
                    <div
                      key={flashed ? `${i}-f${flash.nonce}` : i}
                      className={hasSeek ? `${cls} seekable` : cls}
                      style={{ top: y, left: 4, right: 4, zIndex: 1 }}
                      onClick={hasSeek ? () => onSeek(c.t) : undefined}
                      title={title}
                    >
                      {c.icon ? (
                        <SpellIcon
                          icon={c.icon}
                          label={c.spellName}
                          size={14}
                        />
                      ) : (
                        <span
                          className="rpt-gcd-act-dot"
                          style={{
                            background: isMajorCd(c.spellId)
                              ? "var(--gold)"
                              : classColor(tr.classId),
                          }}
                        />
                      )}
                      {/* Compact density: names move into the title, minis
                          fold into an ×N count */}
                      {!compact && (
                        <span className="rpt-gcd-act-name">{c.spellName}</span>
                      )}
                      {/* Cast target (user request 2026-08-14): full density
                          shows every non-self target; compact keeps only
                          control targets (who got CC'd matters most there) */}
                      {(() => {
                        const control = isControlCast(c.spellId);
                        if (compact && !control) return null;
                        const tgt = chipTarget(c, tr.name);
                        if (!tgt) return null;
                        return (
                          <span
                            className={
                              control
                                ? "rpt-gcd-act-target cc"
                                : "rpt-gcd-act-target"
                            }
                          >
                            →{tgt}
                          </span>
                        );
                      })()}
                      {!compact &&
                        visMinis.map((m, j) => (
                          <span
                            key={j}
                            className={
                              isMajorCd(m.spellId)
                                ? "rpt-gcd-mini major"
                                : "rpt-gcd-mini"
                            }
                            title={`${fmtT(m.t)} ${m.spellName}`}
                          >
                            {m.icon ? (
                              <SpellIcon
                                icon={m.icon}
                                label={m.spellName}
                                size={12}
                              />
                            ) : (
                              <span className="rpt-gcd-mini-letter">
                                {m.spellName.slice(0, 1)}
                              </span>
                            )}
                          </span>
                        ))}
                      {!compact && extra > 0 && (
                        <span className="rpt-gcd-mini-more">+{extra}</span>
                      )}
                      {compact && cl.minis.length > 0 && (
                        <span className="rpt-gcd-mini-more">
                          ×{cl.minis.length}
                        </span>
                      )}
                      {major ? (
                        <span className="rpt-gcd-act-cd">CD</span>
                      ) : null}
                    </div>
                  );
                })}
                {tr.deathT != null && (
                  <div
                    className={
                      hasDeathClick
                        ? "rpt-gcd-death rpt-gcd-death-click"
                        : "rpt-gcd-death"
                    }
                    style={{ top: yFor(tr.deathT) }}
                    onClick={
                      hasDeathClick
                        ? () => onDeath(tr.unitId, tr.deathT!)
                        : undefined
                    }
                    title={hasDeathClick ? "点击看死亡回顾" : undefined}
                  >
                    阵亡
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
});

/**
 * GCD lanes: share the same clock t as the arena map. One column per player,
 * casts laid out vertically by time; when dense, collision avoidance pushes
 * them down (no overlap), and a single gold time cursor spans all columns.
 * Elapsed actions are fully opaque, future ones .32, and the most recent GCD
 * gets a gold outline. During playback the view auto-scrolls with the cursor.
 */
export function GcdSwimlane({
  source,
  tracks,
  t,
  startTime,
  endTime,
  selUnits,
  onToggle,
  playing,
  flash,
  onSeekT,
  onDeathClick,
  bands,
  compact = false,
  onCompactChange,
}: {
  source: ReportSource;
  tracks: ReplayTrack[];
  t: number;
  startTime: number;
  endTime: number;
  selUnits: Record<string, boolean>;
  onToggle: (unitId: string) => void;
  playing: boolean;
  /** Evidence-chain jump: gold-flash the chips within ±2s of that instant (in
   * the columns matching unitNames). */
  flash?: FlashReq;
  /** Click a chip → seek the shared clock to that cast instant (both panes
   * stay in sync). */
  onSeekT?: (tMs: number) => void;
  /** Click the death divider → death recap. */
  onDeathClick?: (unitId: string, tMs: number) => void;
  /** Kill / vulnerability windows (P1-6): gold jump chips under the lanes;
   * clicking seeks to the window start. */
  bands?: VulnBand[];
  /** Compact density (P1-6): narrower columns, chips keep only the icon + CD
   * badge, minis fold into ×N. */
  compact?: boolean;
  onCompactChange?: (v: boolean) => void;
}) {
  const durationSec = Math.max(1, (endTime - startTime) / 1000);
  const laneH = durationSec * PX_PER_SEC;
  // useCallback: the layout useMemo depends on this; a bare arrow function
  // would get a new identity each frame and invalidate that memo again.
  const yFor = useCallback(
    (ts: number): number => ((ts - startTime) / 1000) * PX_PER_SEC,
    [startTime],
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  // Handler trampolines: ReplayView re-renders every frame and the arrow-
  // function props it passes get a new identity each time, so passing them
  // straight down would make LaneBody's memo useless. Wrap the current value
  // in a ref behind a stable identity.
  const onSeekTRef = useRef(onSeekT);
  onSeekTRef.current = onSeekT;
  const stableSeek = useCallback((ms: number) => onSeekTRef.current?.(ms), []);
  const onDeathRef = useRef(onDeathClick);
  onDeathRef.current = onDeathClick;
  const stableDeath = useCallback(
    (unitId: string, ms: number) => onDeathRef.current?.(unitId, ms),
    [],
  );

  const castsByUnit = useMemo(() => {
    const map: Record<string, ReturnType<typeof deriveCasts>> = {};
    for (const tr of tracks) map[tr.unitId] = deriveGcdCasts(source, tr.unitId);
    return map;
  }, [source, tracks]);

  // Group by team: friendly columns on the left, enemy columns on the right,
  // with a divider drawn at the boundary.
  // useMemo is mandatory: these two arrays are dependencies of the layout
  // useMemo below, and a bare expression would get a new identity on every
  // render, recomputing that O(columns × casts) collision-avoidance layout
  // every frame (making the memo useless).
  const orderedTracks = useMemo(
    () => [
      ...tracks.filter((tr) => tr.side === "friendly"),
      ...tracks.filter((tr) => tr.side !== "friendly"),
    ],
    [tracks],
  );
  const cols = useMemo(
    () => orderedTracks.filter((tr) => selUnits[tr.unitId]),
    [orderedTracks, selUnits],
  );
  const friendlyColCount = cols.filter((tr) => tr.side === "friendly").length;

  // Layout (axis change + folding, 2026-07-25, user's design): rows are
  // anchored to real timestamps (with the old collision push-down, 10 measured
  // matches had 92% of chips drifting >0.5s, 15.8s on average, up to 106s);
  // multiple casts inside one GCD window (the seconds CHIP_H corresponds to)
  // fold into a single row — the primary chip = the first on-GCD cast, while
  // off-GCD actives (trinkets/kicks, per the official offGcdGenerated flag)
  // and anything else squeezed into the same window fold into mini icons, with
  // the overflow collapsed into +N. Zero overlap between rows, and vertical
  // deviation ≤ the window width.
  const { laidByUnit, contentH } = useMemo(() => {
    const windowMs = (CHIP_H / PX_PER_SEC) * 1000;
    const laidByUnit: Record<string, Laid[]> = {};
    for (const tr of cols) {
      const casts = (castsByUnit[tr.unitId] ?? []).filter(
        (c) => (tr.deathT == null || c.t <= tr.deathT) && c.t <= endTime,
      );
      laidByUnit[tr.unitId] = clusterGcdCasts(casts, windowMs).map((cl) => ({
        cl,
        y: Math.min(yFor(cl.t), laneH - CHIP_H),
      }));
    }
    return { laidByUnit, contentH: laneH + CHIP_H + 6 };
  }, [cols, castsByUnit, laneH, endTime, yFor]);

  // Real viewport height: measured off the render path by a ResizeObserver, so
  // the render/scroll paths do zero DOM reads — the old implementation's
  // per-frame clientHeight read + scrollTop write forced a reflow of the whole
  // 3500px container (audit ⑤c).
  const clientHRef = useRef(VIEWPORT_H);
  const [, setViewEpoch] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    clientHRef.current = el.clientHeight || VIEWPORT_H;
    if (typeof ResizeObserver === "undefined") return; // not available in jsdom
    const ro = new ResizeObserver(() => {
      clientHRef.current = el.clientHeight || VIEWPORT_H;
      // A ref does not trigger a re-render, so the window's upper bound would
      // not grow with the new height — force one via the epoch (agy F5)
      setViewEpoch((e) => e + 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Window anchor for manual scrolling (with hysteresis: setState only after
  // scrolling half an overscan, so scrolling does not re-render every frame).
  // During playback the window is derived directly from t (the scrollTop we
  // just wrote is a function of it) and scroll events are ignored entirely —
  // zero DOM reads on the playback path.
  const [manualTop, setManualTop] = useState(0);
  const manualTopRef = useRef(0);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const onScroll = useCallback(() => {
    if (playingRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const st = el.scrollTop;
    if (Math.abs(st - manualTopRef.current) > OVERSCAN_PX / 2) {
      manualTopRef.current = st;
      setManualTop(st);
    }
  }, []);

  // Keep the cursor at ~40% of the viewport during playback (clientHeight
  // comes from the cache, no longer read every frame)
  useEffect(() => {
    if (!playing || !scrollRef.current) return;
    const el = scrollRef.current;
    el.scrollTop = HEAD_H + yFor(t) - clientHRef.current * 0.4;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, playing]);

  // Playing → paused: the window anchor takes over from the current
  // scrollTop; otherwise, at the moment of pausing the window is still
  // anchored at the last manual position, every chip deep in the viewport gets
  // windowed out, and the pane goes blank.
  // useLayoutEffect: re-render synchronously before paint so no blank frame
  // flashes (agy review F3).
  useLayoutEffect(() => {
    if (playing) return;
    const el = scrollRef.current;
    if (!el) return;
    manualTopRef.current = el.scrollTop;
    setManualTop(el.scrollTop);
  }, [playing]);

  // Evidence-chain jump: on a new flash request, scroll to the target instant
  // (also works while paused).
  // useLayoutEffect: the window anchor and scrollTop land in the same batch,
  // so the target area never flashes blank for a frame.
  useLayoutEffect(() => {
    if (!flash || !scrollRef.current) return;
    const el = scrollRef.current;
    const top = HEAD_H + yFor(flash.tMs) - el.clientHeight * 0.4;
    el.scrollTop = top;
    manualTopRef.current = top;
    setManualTop(top);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash?.nonce]);

  // Playing: quantize t to 250ms for chip classification / window derivation.
  // Paused: exact t (keeps visual baselines stable).
  const tQ = playing ? Math.floor(t / T_QUANT_MS) * T_QUANT_MS : t;
  const winCenter = playing
    ? HEAD_H + yFor(tQ) - clientHRef.current * 0.4
    : manualTop;
  // A chip's y is in col-body coordinates, while the scrollTop coordinate
  // system carries an extra HEAD_H column-header offset — convert into chip
  // coordinates before comparing (agy review F7).
  const winFrom = winCenter - OVERSCAN_PX - HEAD_H;
  const winTo = winCenter + clientHRef.current + OVERSCAN_PX - HEAD_H;

  const ticks: number[] = [];
  for (let s = 0; s <= durationSec; s += TICK_SEC) ticks.push(s);

  return (
    <div className="rpt-gcd">
      <div className="rpt-gcd-head">
        <span className="rpt-card-label">GCD 模式 · 每 GCD 谁做了什么</span>
        <span className="rpt-gcd-legend">▮ 大招</span>
        {onCompactChange && (
          <span className="rpt-mode-seg rpt-gcd-density">
            {(
              [
                [false, "标准"],
                [true, "紧凑"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={label}
                className={compact === v ? "active" : ""}
                onClick={() => onCompactChange(v)}
              >
                {label}
              </button>
            ))}
          </span>
        )}
        <span className="rpt-gcd-sub">与地图共享时间轴</span>
      </div>

      {/* Player chips grouped by team (user feedback 2026-08-05): two labeled
          clusters instead of one flat row. The split predicate is the same
          `side === "friendly"` the lane columns and their divider already
          use, so the chip clusters always mirror the lane layout below. */}
      <div className="rpt-gcd-chips">
        {(
          [
            ["friendly", "我方"],
            ["enemy", "敌方"],
          ] as const
        ).map(([side, label]) => {
          const group = orderedTracks.filter((tr) =>
            side === "friendly"
              ? tr.side === "friendly"
              : tr.side !== "friendly",
          );
          if (group.length === 0) return null;
          return (
            <div
              key={side}
              className="rpt-gcd-chipgroup"
              data-testid={`gcd-chips-${side}`}
            >
              <span className="rpt-gcd-chipgroup-head">
                <TeamDot side={side} />
                {label}
              </span>
              {group.map((tr) => (
                <button
                  key={tr.unitId}
                  className={
                    selUnits[tr.unitId] ? "rpt-gcd-chip active" : "rpt-gcd-chip"
                  }
                  onClick={() => onToggle(tr.unitId)}
                >
                  <Dot track={tr} />
                  <UnitName name={tr.name} full />
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {/* Window jump chips (P1-6): the gold chips from deriveVulnBands;
          clicking one moves the shared clock too */}
      {onSeekT && (bands?.length ?? 0) > 0 && (
        <div className="rpt-gcd-bands">
          {bands!.map((b, i) => {
            const fromMs = source.startTime + b.fromS * 1000;
            return (
              <button
                key={i}
                className="rpt-gcd-band-chip"
                onClick={() => onSeekT(fromMs)}
                title="点击定位(地图同步)"
              >
                {fmtTime(Math.max(0, (fromMs - startTime) / 1000))}{" "}
                {b.kind === "burst" ? "击杀尝试" : "脆弱"} →{" "}
                {shortUnitName(b.targetName)}
              </button>
            );
          })}
        </div>
      )}

      <div
        className="rpt-gcd-scroll"
        ref={scrollRef}
        onScroll={onScroll}
        // A scrollable region must be keyboard-focusable, otherwise it can
        // only be scrolled with a mouse — keyboard users cannot reach it
        tabIndex={0}
        role="group"
        aria-label="GCD 泳道(可滚动)"
      >
        <div className="rpt-gcd-body" style={{ height: contentH + HEAD_H }}>
          {/* Timeline axis */}
          <div className="rpt-gcd-axis" style={{ height: contentH + HEAD_H }}>
            {ticks.map((s) => (
              <span
                key={s}
                className="rpt-gcd-tick"
                style={{ top: HEAD_H + s * PX_PER_SEC }}
              >
                {fmtTime(s)}
              </span>
            ))}
          </div>

          {/* One column per player; a vertical divider at the friendly/enemy
              boundary (the column bodies are the LaneBody memo boundary) */}
          <LaneBody
            cols={cols}
            laidByUnit={laidByUnit}
            contentH={contentH}
            compact={compact}
            flash={flash ?? null}
            tQ={tQ}
            playing={playing}
            startTime={startTime}
            winFrom={winFrom}
            winTo={winTo}
            friendlyColCount={friendlyColCount}
            hasSeek={!!onSeekT}
            hasDeathClick={!!onDeathClick}
            onSeek={stableSeek}
            onDeath={stableDeath}
            yFor={yFor}
          />

          {/* Shared time cursor (kept outside the memo boundary: smooth at
              60Hz, and only 2 elements to reconcile) */}
          <div
            className="rpt-gcd-cursor"
            style={{ top: HEAD_H + Math.min(contentH, Math.max(0, yFor(t))) }}
          >
            {/* Time badge at the right end (1f) */}
            <span className="rpt-gcd-cursor-badge">
              {fmtTime(Math.max(0, (t - startTime) / 1000))}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
