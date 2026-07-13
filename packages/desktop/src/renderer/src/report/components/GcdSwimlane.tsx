import { useEffect, useMemo, useRef } from "react";

import { classColor, classGlyph } from "../data/gameConstants";
import { deriveCasts, isMajorCd } from "../derive/casts";
import type { ReplayTrack } from "../derive/replay";
import type { ReportSource } from "../derive/types";

const PX_PER_SEC = 15;
const GCD_MS = 1500;
const TICK_SEC = 15;
const HEAD_H = 30; // 列头高度,时间轴/光标需下移这么多以对齐列体
const CHIP_H = 17;
const CHIP_STEP = 19; // 同列相邻 chip 最小间距:密集时下推,避免重叠
const VIEWPORT_H = 600; // 泳道可视高度(超出纵向滚动)

const reactionRing = (reaction: string): string =>
  reaction === "Friendly"
    ? "var(--win)"
    : reaction === "Hostile"
      ? "var(--loss)"
      : "var(--mute)";

const mmss = (sec: number): string =>
  `${Math.floor(sec / 60)}:${Math.floor(sec % 60)
    .toString()
    .padStart(2, "0")}`;

function Dot({ track }: { track: ReplayTrack }) {
  return (
    <span
      className="rpt-gcd-dot"
      style={{
        background: classColor(track.classId),
        borderColor: reactionRing(track.reaction),
      }}
    >
      {classGlyph(track.classId)}
    </span>
  );
}

type Laid = { c: ReturnType<typeof deriveCasts>[number]; y: number };

/**
 * GCD 泳道:与竞技场共享同一时钟 t。每玩家一列,施法按时间竖直排布;
 * 密集时用碰撞避让下推(不重叠),一条金色时间光标横贯所有列;
 * 已过动作满不透明、未来 .32、最近一个 GCD 描金边。播放时自动跟随光标滚动。
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
}: {
  source: ReportSource;
  tracks: ReplayTrack[];
  t: number;
  startTime: number;
  endTime: number;
  selUnits: Record<string, boolean>;
  onToggle: (unitId: string) => void;
  playing: boolean;
}) {
  const durationSec = Math.max(1, (endTime - startTime) / 1000);
  const laneH = durationSec * PX_PER_SEC;
  const yFor = (ts: number): number => ((ts - startTime) / 1000) * PX_PER_SEC;
  const scrollRef = useRef<HTMLDivElement>(null);

  const castsByUnit = useMemo(() => {
    const map: Record<string, ReturnType<typeof deriveCasts>> = {};
    for (const tr of tracks) map[tr.unitId] = deriveCasts(source, tr.unitId);
    return map;
  }, [source, tracks]);

  const cols = tracks.filter((tr) => selUnits[tr.unitId]);

  // 每列碰撞避让布局:相邻 chip 至少间隔 CHIP_STEP,密集处顺次下推。
  const { laidByUnit, contentH } = useMemo(() => {
    const laidByUnit: Record<string, Laid[]> = {};
    let maxBottom = laneH;
    for (const tr of cols) {
      const casts = (castsByUnit[tr.unitId] ?? []).filter(
        (c) => tr.deathT == null || c.t <= tr.deathT,
      );
      let lastY = -Infinity;
      const laid: Laid[] = casts.map((c) => {
        const y = Math.max(yFor(c.t), lastY + CHIP_STEP);
        lastY = y;
        return { c, y };
      });
      laidByUnit[tr.unitId] = laid;
      if (laid.length) maxBottom = Math.max(maxBottom, lastY + CHIP_H);
    }
    return { laidByUnit, contentH: maxBottom };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols, castsByUnit, laneH]);

  // 播放时让光标保持在视口 ~40% 处
  useEffect(() => {
    if (!playing || !scrollRef.current) return;
    const el = scrollRef.current;
    const cursorY = HEAD_H + yFor(t);
    el.scrollTop = cursorY - el.clientHeight * 0.4;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, playing]);

  const ticks: number[] = [];
  for (let s = 0; s <= durationSec; s += TICK_SEC) ticks.push(s);

  return (
    <div className="rpt-gcd">
      <div className="rpt-gcd-head">
        <span className="rpt-card-label">GCD 模式 · 每 GCD 谁做了什么</span>
        <span className="rpt-gcd-sub">与地图共享时间轴</span>
      </div>

      <div className="rpt-gcd-chips">
        {tracks.map((tr) => (
          <button
            key={tr.unitId}
            className={
              selUnits[tr.unitId] ? "rpt-gcd-chip active" : "rpt-gcd-chip"
            }
            onClick={() => onToggle(tr.unitId)}
          >
            <Dot track={tr} />
            {tr.name}
          </button>
        ))}
      </div>

      <div
        className="rpt-gcd-scroll"
        ref={scrollRef}
        style={{ maxHeight: VIEWPORT_H }}
      >
        <div className="rpt-gcd-body" style={{ height: contentH + HEAD_H }}>
          {/* 时间轴 */}
          <div className="rpt-gcd-axis" style={{ height: contentH + HEAD_H }}>
            {ticks.map((s) => (
              <span
                key={s}
                className="rpt-gcd-tick"
                style={{ top: HEAD_H + s * PX_PER_SEC }}
              >
                {mmss(s)}
              </span>
            ))}
          </div>

          {/* 每玩家一列 */}
          {cols.map((tr) => {
            const dead = tr.deathT != null;
            return (
              <div key={tr.unitId} className="rpt-gcd-col">
                <div
                  className={
                    dead ? "rpt-gcd-col-head dead" : "rpt-gcd-col-head"
                  }
                >
                  <Dot track={tr} />
                  <span className="rpt-gcd-col-name">{tr.name}</span>
                </div>
                <div className="rpt-gcd-col-body" style={{ height: contentH }}>
                  {(laidByUnit[tr.unitId] ?? []).map(({ c, y }, i) => {
                    const elapsed = c.t <= t;
                    const recent = elapsed && c.t >= t - GCD_MS;
                    const major = isMajorCd(c.spellId);
                    const cls = [
                      "rpt-gcd-act",
                      major ? "major" : "",
                      elapsed ? "" : "future",
                      recent ? "recent" : "",
                    ]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <div key={i} className={cls} style={{ top: y }}>
                        <span
                          className="rpt-gcd-act-dot"
                          style={{
                            background: major
                              ? "var(--gold)"
                              : classColor(tr.classId),
                          }}
                        />
                        <span className="rpt-gcd-act-name">
                          {c.byPet ? "🐾 " : ""}
                          {c.spellName}
                        </span>
                        {c.targetName ? (
                          <span className="rpt-gcd-act-target">
                            → {c.targetName}
                          </span>
                        ) : null}
                        {major ? (
                          <span className="rpt-gcd-act-cd">CD</span>
                        ) : null}
                      </div>
                    );
                  })}
                  {tr.deathT != null && (
                    <div
                      className="rpt-gcd-death"
                      style={{ top: yFor(tr.deathT) }}
                    >
                      阵亡
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* 共享时间光标 */}
          <div
            className="rpt-gcd-cursor"
            style={{ top: HEAD_H + Math.min(contentH, Math.max(0, yFor(t))) }}
          />
        </div>
      </div>
    </div>
  );
}
