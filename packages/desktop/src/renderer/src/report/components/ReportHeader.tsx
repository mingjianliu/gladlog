import { fmtTime, zoneMetadata } from "@gladlog/analysis";

import { shortUnitName } from "../derive/teamSide";
import type { ReportSource } from "../derive/types";

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}


const RESULT_LABEL: Record<string, string> = {
  win: "胜利",
  loss: "败北",
  lose: "败北",
  draw: "平局",
};

/**
 * The hero line (1c, revised by 1a, reshaped by the 2026-08-21 UI review #1):
 * result + bracket · round · map · duration (· rating change), then the two
 * facts that answer "why did this go the way it went" in one glance — 终结
 * (the last real player death, seekable) and 转折 (the match-arc turning
 * point, seekable). Both are *moved* here, not re-derived: 终结 was the first
 * KPI chip, 转折 is `IMatchArcPhase.turningPoint`. Either slot renders empty
 * when the fact does not exist (no deaths; rounds under 90 s have no turning
 * point) rather than inventing one.
 *
 * Player name and current rating still do not appear (the 1c decision is not
 * rolled back; they live in the leaderboard); the rating **change** is part
 * of the match result (user's call in UI rework 1a), and for shuffle the
 * caller only passes it on the final round.
 */
export function ReportHeader({
  source,
  roundLabel,
  ratingDelta = null,
  finisher = null,
  turningPoint = null,
  onSeek,
}: {
  source: ReportSource;
  roundLabel?: string;
  /** Difference between two adjacent matches' meta (computed in the app
   * layer; the log carries no personal rating change); null/0 renders
   * nothing. */
  ratingDelta?: number | null;
  /** Last real player death: name + relative seconds. */
  finisher?: { name: string; tS: number } | null;
  /** Match-arc turning point (analysis label is English; tooltip only). */
  turningPoint?: { tS: number; label: string } | null;
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
}) {
  const res = source.result.toLowerCase();
  return (
    <div className="rpt-hero" data-testid="rpt-hero">
      <div className="rpt-head-left">
        <span className={`rpt-head-result rpt-result-${res}`}>
          {RESULT_LABEL[res] ?? source.result}
        </span>
        {/* Order per spec 1a: bracket · round · map · duration · rating change */}
        <span className="rpt-head-meta">
          {source.bracket}
          {roundLabel ? ` · ${roundLabel}` : ""} ·{" "}
          {zoneMetadata[String(source.zoneId)]?.name ?? `zone ${source.zoneId}`}{" "}
          · {fmtDuration(source.endTime - source.startTime)}
          {ratingDelta != null && ratingDelta !== 0 && (
            <span
              className={`rpt-head-rating ${
                ratingDelta > 0 ? "rpt-rating-up" : "rpt-rating-down"
              }`}
            >
              {" "}
              · {ratingDelta > 0 ? "+" : ""}
              {ratingDelta}
            </span>
          )}
        </span>
      </div>
      {finisher && onSeek && (
        <button
          type="button"
          className="rpt-hero-fact"
          data-testid="hero-finisher"
          title="跳到终结时刻回放"
          onClick={() => onSeek(Math.max(0, finisher.tS - 3), [finisher.name])}
        >
          <span className="rpt-kpi-k">终结</span>
          <span className="rpt-kpi-v">
            {shortUnitName(finisher.name)} · {fmtTime(finisher.tS)}
          </span>
        </button>
      )}
      {turningPoint && onSeek && (
        <button
          type="button"
          className="rpt-hero-fact"
          data-testid="hero-turning"
          title={turningPoint.label}
          aria-label={`跳转到转折点 ${fmtTime(turningPoint.tS)}`}
          onClick={() => onSeek(turningPoint.tS, [])}
        >
          <span className="rpt-kpi-k">转折</span>
          <span className="rpt-kpi-v">{fmtTime(turningPoint.tS)}</span>
        </button>
      )}
    </div>
  );
}
