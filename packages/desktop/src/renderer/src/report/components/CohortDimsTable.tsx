import type { CohortDimRow } from "../derive/cohortDims";

const barColor = (score: number): string =>
  score >= 60 ? "var(--win)" : score <= 40 ? "var(--loss)" : "var(--gold-dim)";

/**
 * cohort 对比表:每行 = 指标 + 评分条(长度 = 方向修正评分,越长越好)+
 * 原文数值(faithfulness 检查锚定的渲染文本,格式勿动)。
 * 顶部一行确定性总结:综合评分 / 最强项 / 最弱项 —— 纯 derive,无 AI。
 */
export function CohortDimsTable({
  rows,
  lang = "zh",
}: {
  rows: CohortDimRow[];
  lang?: "en" | "zh";
}) {
  if (rows.length === 0) return null;
  const overall = Math.round(
    rows.reduce((a, r) => a + r.score, 0) / rows.length,
  );
  const best = rows.reduce((a, r) => (r.score > a.score ? r : a));
  const worst = rows.reduce((a, r) => (r.score < a.score ? r : a));
  return (
    <div data-testid="cohort-dims" style={{ marginBottom: "16px" }}>
      <div className="rpt-cohort-summary" data-testid="cohort-summary">
        {lang === "zh" ? (
          <>
            综合评分 <b>{overall}</b> · 最强:{best.keyLabel}({best.score})·
            最弱:{worst.keyLabel}({worst.score})
          </>
        ) : (
          <>
            Overall score <b>{overall}</b> · strongest: {best.keyLabel} (
            {best.score}) · weakest: {worst.keyLabel} ({worst.score})
          </>
        )}
      </div>
      {rows.map((dim) => (
        <div
          key={dim.key}
          data-testid="cohort-dim"
          data-dim-key={dim.key}
          className="rpt-cohort-row"
        >
          <span className="rpt-cohort-key">{dim.keyLabel}</span>
          <span className="rpt-cohort-bar-track">
            <span
              className="rpt-cohort-bar"
              style={{
                width: `${Math.max(2, dim.score)}%`,
                background: barColor(dim.score),
              }}
            />
          </span>
          <span className="rpt-cohort-value">
            {dim.valueLabel} ({dim.percentileLabel} · {dim.verdictLabel})
          </span>
        </div>
      ))}
    </div>
  );
}
