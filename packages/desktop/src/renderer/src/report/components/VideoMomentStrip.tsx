import { useT } from "../../i18n/LangProvider";
import type { VideoMoment } from "../derive/videoMoments";

/** The alignment marker strip below the video (brainstorm A, final): gold
 * burst-band as the base layer, plus ✕ death / ⚠ mistake / ✦ AI finding point
 * markers; clicking seeks. Only major moments plus mistakes are drawn, minor
 * ones never enter the strip (ai is always major, see deriveVideoMoments). The
 * horizontal axis is video seconds (0..durationS); the caller has already
 * converted combat times into video seconds. */
export interface StripMark {
  videoS: number;
  toVideoS?: number;
  moment: VideoMoment;
}

/** kind → the point marker's class suffix + glyph. One mapping consumed in two
 * places, so that when the ternary chain grows a fourth branch we cannot
 * forget one of them. Kinds not listed here (defensive/dispel/cc, which
 * currently do not pass the points filter) fall back to "other" / "•". */
export const MARK_STYLE: Partial<
  Record<VideoMoment["kind"], { cls: string; glyph: string }>
> = {
  death: { cls: "death", glyph: "✕" },
  mistake: { cls: "mistake", glyph: "⚠" },
  ai: { cls: "ai", glyph: "✦" },
};

export function VideoMomentStrip({
  marks,
  durationS,
  onSeek,
  windowStartS,
  windowEndS,
  unreachableBeforeBattleS = 0,
}: {
  marks: StripMark[];
  durationS: number;
  onSeek: (videoS: number) => void;
  /** Optional: narrow the horizontal axis from "the whole recording" to "this
   * round's range" (the counterpart of the custom control bar's per-round
   * clamp — when omitted, the strip spans the whole recording, a default
   * locked in by existing unit tests). Marks outside the window are dropped
   * outright, never drawn past the strip or crammed against its edge. */
  windowStartS?: number;
  windowEndS?: number;
  /** Combat seconds before this value have no footage (missing head). 0 = none.
   * When set, point markers before windowStartS are no longer dropped: they are
   * pinned at the strip's left edge with an "unreachable" class instead of
   * vanishing (design doc §4.1 — vanishing is worse than not doing it at all,
   * it looks like the moment never happened). Defaulting to 0 preserves the
   * existing drop behaviour verbatim. */
  unreachableBeforeBattleS?: number;
}) {
  const { t } = useT();
  if (!Number.isFinite(durationS) || durationS <= 0) return null;
  const winStart = windowStartS ?? 0;
  const winEnd = windowEndS ?? durationS;
  const span = Math.max(0.001, winEnd - winStart);
  const inWindow = (s: number) => s >= winStart && s <= winEnd;
  const isUnreachable = (s: number) =>
    unreachableBeforeBattleS > 0 && s < winStart;
  const pct = (s: number) =>
    Math.min(100, Math.max(0, ((s - winStart) / span) * 100));
  const bands = marks.filter(
    (m) => m.moment.kind === "burst-band" && inWindow(m.videoS),
  );
  const points = marks.filter(
    (m) =>
      m.moment.kind !== "burst-band" &&
      (m.moment.weight === "major" || m.moment.kind === "mistake") &&
      (inWindow(m.videoS) || isUnreachable(m.videoS)),
  );
  return (
    <div className="rpt-video-strip" data-testid="video-strip">
      {bands.map((m, i) => (
        <div
          key={`b${i}`}
          className="rpt-video-strip-band"
          style={{
            left: `${pct(m.videoS)}%`,
            width: `${Math.max(0.4, pct(m.toVideoS ?? m.videoS + 1) - pct(m.videoS))}%`,
          }}
          title={t("report.video.clickToSeek", { label: m.moment.label })}
          onClick={() => onSeek(m.videoS)}
        />
      ))}
      {points.map((m, i) => {
        const style = MARK_STYLE[m.moment.kind];
        const unreachable = isUnreachable(m.videoS);
        return (
          <button
            key={`p${i}`}
            className={
              `rpt-video-strip-mark rpt-video-strip-${style?.cls ?? "other"}` +
              (unreachable ? " rpt-video-strip-mark--unreachable" : "")
            }
            style={{ left: `${pct(m.videoS)}%` }}
            title={
              unreachable
                ? t("report.video.beforeRecording")
                : t("report.video.clickToSeek", { label: m.moment.label })
            }
            onClick={() => onSeek(m.videoS)}
          >
            {style?.glyph ?? "•"}
          </button>
        );
      })}
    </div>
  );
}
