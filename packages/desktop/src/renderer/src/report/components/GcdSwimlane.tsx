import { useMemo } from "react";

import { classColor, classGlyph } from "../data/gameConstants";
import { deriveCasts, isMajorCd } from "../derive/casts";
import type { ReplayTrack } from "../derive/replay";
import type { ReportSource } from "../derive/types";

const PX_PER_SEC = 6;
const GCD_MS = 1500;
const TICK_SEC = 15;
const HEAD_H = 28; // 列头高度,时间轴/光标需下移这么多以对齐列体

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

/**
 * GCD 泳道:与竞技场共享同一时钟 t。每玩家一列,动作按 t·scale 竖直排布,
 * 一条金色时间光标横贯所有列;已过动作满不透明,未来 .32,最近一个 GCD 描金边。
 */
export function GcdSwimlane({
  source,
  tracks,
  t,
  startTime,
  endTime,
  selUnits,
  onToggle,
}: {
  source: ReportSource;
  tracks: ReplayTrack[];
  t: number;
  startTime: number;
  endTime: number;
  selUnits: Record<string, boolean>;
  onToggle: (unitId: string) => void;
}) {
  const durationSec = Math.max(1, (endTime - startTime) / 1000);
  const laneH = durationSec * PX_PER_SEC;
  const yFor = (ts: number): number => ((ts - startTime) / 1000) * PX_PER_SEC;

  const castsByUnit = useMemo(() => {
    const map: Record<string, ReturnType<typeof deriveCasts>> = {};
    for (const tr of tracks) map[tr.unitId] = deriveCasts(source, tr.unitId);
    return map;
  }, [source, tracks]);

  const cols = tracks.filter((tr) => selUnits[tr.unitId]);
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

      <div className="rpt-gcd-scroll">
        <div className="rpt-gcd-body" style={{ height: laneH + HEAD_H }}>
          {/* 时间轴 */}
          <div className="rpt-gcd-axis" style={{ height: laneH + HEAD_H }}>
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
                <div className="rpt-gcd-col-body" style={{ height: laneH }}>
                  {(castsByUnit[tr.unitId] ?? []).map((c, i) => {
                    if (tr.deathT != null && c.t > tr.deathT) return null;
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
                      <div key={i} className={cls} style={{ top: yFor(c.t) }}>
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
            style={{ top: HEAD_H + Math.min(laneH, Math.max(0, yFor(t))) }}
          />
        </div>
      </div>
    </div>
  );
}
