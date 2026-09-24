import { fmtTime } from "@gladlog/analysis";
import { useEffect, useRef } from "react";

import type { VideoMoment } from "../derive/videoMoments";
import { MARK_STYLE } from "./VideoMomentStrip";

/**
 * The static "all moments" list (UI rework 2a): each row is timestamp + glyph
 * + description + ▶, sharing the very same videoMoments as the feed and the
 * marker strip (one source, no duplicate derive). The currently playing row is
 * highlighted and scrolled into view. The "AI findings" tab reuses this
 * component with a filtered set of moments.
 */
export function VideoMomentList({
  moments,
  curBattleS,
  onSeek,
  emptyText,
  unreachableBeforeBattleS = 0,
}: {
  moments: VideoMoment[];
  /** Current playback position (seconds relative to this match); null = no
   * playback position. */
  curBattleS: number | null;
  onSeek?: (battleS: number) => void;
  emptyText: string;
  /** Combat seconds before this value have no footage (missing head). 0 = none.
   * Rows before it get an "unreachable" class + title instead of looking like
   * an ordinary, clickable moment (design doc §4.1). */
  unreachableBeforeBattleS?: number;
}) {
  // Current row = the last moment already passed (the playhead sits on it;
  // none before the first moment is reached)
  const curIdx =
    curBattleS == null
      ? -1
      : moments.reduce((acc, m, i) => (m.tS <= curBattleS ? i : acc), -1);
  const curRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    // jsdom has no scrollIntoView (the usual missing-stub convention:
    // optional call plus a fallback)
    try {
      curRef.current?.scrollIntoView?.({ block: "nearest" });
    } catch {
      /* noop */
    }
  }, [curIdx]);

  if (moments.length === 0)
    return <p className="rpt-engage-empty">{emptyText}</p>;
  return (
    <div className="rpt-video-moments" data-testid="video-moment-list">
      {moments.map((m, i) => {
        const style = MARK_STYLE[m.kind] ?? { cls: "other", glyph: "•" };
        const unreachable =
          unreachableBeforeBattleS > 0 && m.tS < unreachableBeforeBattleS;
        const cls = ["rpt-video-moment-row"];
        if (i === curIdx) cls.push("cur");
        if (unreachable) cls.push("unreachable");
        return (
          <button
            key={`${m.kind}:${m.tS}:${i}`}
            ref={i === curIdx ? curRef : undefined}
            type="button"
            className={cls.join(" ")}
            onClick={() => onSeek?.(m.tS)}
            title={unreachable ? "该时刻在录像开始之前" : "定位到该时刻"}
          >
            <span className="rpt-video-feed-t">{fmtTime(m.tS)}</span>
            <span className={`rpt-video-moment-icon ${style.cls}`}>
              {style.glyph}
            </span>
            <span className="rpt-video-moment-label">{m.label}</span>
            <span className="rpt-video-moment-play">▶</span>
          </button>
        );
      })}
    </div>
  );
}
