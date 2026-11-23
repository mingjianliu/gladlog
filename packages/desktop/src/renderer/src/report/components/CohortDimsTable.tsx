import { makeT } from "../../../../shared/i18n";
import type { CohortDimRow } from "../derive/cohortDims";

/** Cursor / verdict color by direction-corrected score: good --win / bad
 * --loss / even --ink-2. */
const cursorColor = (score: number): string =>
  score >= 60 ? "var(--win)" : score <= 40 ? "var(--loss)" : "var(--ink-2)";

/**
 * Cohort comparison table (1g): a three-column grid = name | distribution bar
 * | verdict.
 * Distribution bar: the p10–p90 range bar + a p50 tick + your value's cursor
 * (colored by the direction-corrected score).
 * The verdict column's render text IS the format the faithfulness check
 * anchors to (single-sourced with derive/faithfulness — never change one
 * alone).
 * The deterministic summary line at the top (overall / strongest / weakest) is
 * a feature the user explicitly asked to keep.
 */
export function CohortDimsTable({
  rows,
  lang = "zh",
}: {
  rows: CohortDimRow[];
  lang?: "en" | "zh";
}) {
  if (rows.length === 0) return null;
  const t = makeT(lang);
  const overall = Math.round(
    rows.reduce((a, r) => a + r.score, 0) / rows.length,
  );
  const best = rows.reduce((a, r) => (r.score > a.score ? r : a));
  const worst = rows.reduce((a, r) => (r.score < a.score ? r : a));
  return (
    <div data-testid="cohort-dims" style={{ marginBottom: "16px" }}>
      <div className="rpt-cohort-summary" data-testid="cohort-summary">
        {/* With a single dimension, skip strongest/weakest (it would compare a
            dimension against itself, P3-1) */}
        {t("report.cohortTable.overall")} <b>{overall}</b>
        {rows.length > 1 &&
          t("report.cohortTable.bestWorst", {
            best: best.keyLabel,
            bestScore: best.score,
            worst: worst.keyLabel,
            worstScore: worst.score,
          })}
      </div>
      {rows.map((dim) => {
        const color = cursorColor(dim.score);
        return (
          <div
            key={dim.key}
            data-testid="cohort-dim"
            data-dim-key={dim.key}
            className="rpt-cohort-row"
          >
            <span className="rpt-cohort-key">{dim.keyLabel}</span>
            {/* Score bar (the visual centerpiece): length = direction-corrected
                score, longer is better; the number inside is that score; the
                midpoint tick is the cohort-median reference (50 points) */}
            <span
              className="rpt-cohort-dist"
              title={t("report.cohortTable.scoreTitle", {
                score: dim.score,
                p10: dim.p10,
                p50: dim.p50,
                p90: dim.p90,
              })}
            >
              <span
                className="rpt-cohort-scorebar"
                style={{
                  width: `${Math.max(6, dim.score)}%`,
                  background: `color-mix(in srgb, ${color} 55%, var(--surface-2))`,
                  borderRight: `3px solid ${color}`,
                }}
              />
              <span className="rpt-cohort-dist-p50" style={{ left: "50%" }} />
              <span className="rpt-cohort-score" style={{ color }}>
                {dim.score}
              </span>
            </span>
            <span
              className="rpt-cohort-value"
              style={{ color }}
              title={t("report.cohortTable.measured", {
                value: dim.valueLabel,
              })}
            >
              {dim.displayLabel}
            </span>
          </div>
        );
      })}
    </div>
  );
}
