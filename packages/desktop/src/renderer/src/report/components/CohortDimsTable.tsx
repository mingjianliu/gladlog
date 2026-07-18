import type { CohortDimRow } from "../derive/cohortDims";

/** 游标/判定色:方向修正评分 好 --win / 差 --loss / 持平 --ink-2。 */
const cursorColor = (score: number): string =>
  score >= 60 ? "var(--win)" : score <= 40 ? "var(--loss)" : "var(--ink-2)";

/**
 * cohort 对比表(1g):三列 grid = 名称 | 分布条 | 判定。
 * 分布条:p10–p90 区间条 + p50 刻度 + 你的值游标(色 = 方向修正评分)。
 * 判定列渲染文本 = faithfulness 检查锚定格式(derive/faithfulness 同源,勿单改)。
 * 顶部确定性总结行(综合/最强/最弱)为用户点名保留项。
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
            {/* 评分长条(视觉主体):长度 = 方向修正评分,越长越好;
                条内数字 = 评分;中点刻度 = 同组中位参照(50 分) */}
            <span
              className="rpt-cohort-dist"
              title={`评分 ${dim.score}(方向修正)· p10 ${dim.p10} · p50 ${dim.p50} · p90 ${dim.p90}`}
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
            <span className="rpt-cohort-value" style={{ color }}>
              {dim.valueLabel} ({dim.percentileLabel} · {dim.verdictLabel})
            </span>
          </div>
        );
      })}
    </div>
  );
}
