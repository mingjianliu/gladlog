import type { CohortDimRow } from "../derive/cohortDims";

export function CohortDimsTable({ rows }: { rows: CohortDimRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div data-testid="cohort-dims" style={{ marginBottom: "16px" }}>
      {rows.map((dim) => (
        <div
          key={dim.key}
          data-testid="cohort-dim"
          data-dim-key={dim.key}
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "13px",
          }}
        >
          <span className="rpt-cohort-key">{dim.keyLabel}</span>
          <span className="rpt-cohort-value">
            {dim.valueLabel} ({dim.percentileLabel} · {dim.verdictLabel})
          </span>
        </div>
      ))}
    </div>
  );
}
