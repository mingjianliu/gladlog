import { fmtTime, zoneMetadata } from "@gladlog/analysis";

import type { StoredMatchMeta } from "../../../main/matchStore";
import { useIconDataUrl } from "../report/components/useIconDataUrl";
import {
  classColor,
  classGlyph,
  specIconName,
  specName,
} from "../report/data/gameConstants";


const fmtWhen = (t: number): string => new Date(t).toLocaleString();

const fmtHHMM = (t: number): string => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
};

/**
 * Spec icon. Fetched through the main process's iconCache (permanent on-disk
 * cache); when unavailable or the spec is unknown → a class-colored glyph dot
 * (the same style as the replay legend). This used to pull the wowarenalogs CDN
 * directly via <img src>, which was cut per docs/DATA-COMPLIANCE.md.
 */
export function SpecDot({
  specId,
  classId,
}: {
  specId: number;
  classId: number;
}) {
  const { dataUrl } = useIconDataUrl(specIconName(specId));
  if (!dataUrl) {
    return (
      <span
        className="mlr-spec mlr-spec-fallback"
        title={specName(specId)}
        style={{ background: classColor(classId) }}
      >
        {classGlyph(classId)}
      </span>
    );
  }
  return (
    <img
      className="mlr-spec"
      src={dataUrl}
      alt={specName(specId)}
      title={specName(specId)}
      loading="lazy"
    />
  );
}

/**
 * Rich row (1e): win/loss = a colored bar on the row's left edge (no text badge);
 * the top line carries map + duration + rating delta, the bottom line carries our
 * spec group vs the enemy group + HH:MM.
 * Old index rows missing teams/durationS fall back to the plain-text style (so it
 * works without rebuilding the index).
 */
export function MatchListRow({
  meta,
  ratingDelta,
  checked,
  onToggleCheck,
}: {
  meta: StoredMatchMeta;
  /** Rating difference from the previous match with the same bracket + character;
   * when unavailable (first match / no rating) no arrow is shown. */
  ratingDelta?: number | null;
  /** Batch-selection checkbox (undefined = not selectable, e.g. older call
   * sites/tests): checking a shuffle row selects the whole 6-round lobby —
   * the batch driver expands a lobby id into its rounds. */
  checked?: boolean;
  onToggleCheck?: () => void;
}) {
  const checkbox =
    onToggleCheck != null ? (
      <label
        className="mlr-check"
        title={
          meta.kind === "shuffle"
            ? "勾选整场 shuffle(全部 6 盘)加入批量分析"
            : "勾选加入批量分析"
        }
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          data-testid="mlr-check"
          aria-label="勾选加入批量分析"
          checked={checked ?? false}
          onChange={() => onToggleCheck()}
        />
      </label>
    ) : null;
  const zone = zoneMetadata[meta.zoneId]?.name;
  const rich = !!meta.teams && meta.teams.length === 2;
  const res = meta.result.toLowerCase();
  const resCls =
    res === "win"
      ? "mlr-win"
      : res === "loss" || res === "lose"
        ? "mlr-loss"
        : "";

  if (!rich) {
    return (
      <div className={`mlr ${resCls}`}>
        {checkbox}
        <span className={`badge badge-${meta.kind}`}>[{meta.kind}]</span>{" "}
        {meta.bracket} · {fmtWhen(meta.startTime)} · {meta.result}
      </div>
    );
  }

  const [own, foe] = meta.teams!;
  const rating = meta.playerRating ?? meta.avgRating;
  return (
    <div className={`mlr ${resCls}`}>
      {checkbox}
      <div className="mlr-top">
        {meta.kind === "shuffle" && (
          <span className={`badge badge-${meta.kind}`}>shuffle</span>
        )}
        <span className="mlr-zone">{zone ?? meta.bracket}</span>
        {meta.structuralIssues && meta.structuralIssues.length > 0 && (
          <span
            className="mlr-partial"
            title={`Incomplete: ${meta.structuralIssues.join(", ")}`}
          >
            partial
          </span>
        )}
        {meta.durationS != null && (
          <span className="mlr-dur">{fmtTime(meta.durationS)}</span>
        )}
        {rating != null && (
          <span
            className={
              ratingDelta != null && ratingDelta !== 0
                ? ratingDelta > 0
                  ? "mlr-rating up"
                  : "mlr-rating down"
                : "mlr-rating"
            }
          >
            {rating}
            {ratingDelta != null && ratingDelta !== 0
              ? ratingDelta > 0
                ? " ↑"
                : " ↓"
              : ""}
          </span>
        )}
      </div>
      <div className="mlr-teams">
        <span className="mlr-team">
          {own.map((p, i) => (
            <SpecDot key={i} specId={p.specId} classId={p.classId} />
          ))}
        </span>
        <span className="mlr-vs">vs</span>
        <span className="mlr-team">
          {foe.map((p, i) => (
            <SpecDot key={i} specId={p.specId} classId={p.classId} />
          ))}
        </span>
        <span className="mlr-when">{fmtHHMM(meta.startTime)}</span>
      </div>
    </div>
  );
}
