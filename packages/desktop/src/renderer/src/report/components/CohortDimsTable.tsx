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
        // 分布条定标:[p10,p90] 外扩 12%,并保证你的值在轴内
        const lo0 = Math.min(dim.p10, dim.value ?? dim.p10);
        const hi0 = Math.max(dim.p90, dim.value ?? dim.p90);
        const span = Math.max(hi0 - lo0, 1e-9);
        const lo = lo0 - span * 0.12;
        const hi = hi0 + span * 0.12;
        const pct = (v: number): number =>
          Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
        const color = cursorColor(dim.score);
        return (
          <div
            key={dim.key}
            data-testid="cohort-dim"
            data-dim-key={dim.key}
            className="rpt-cohort-row"
          >
            <span className="rpt-cohort-key">{dim.keyLabel}</span>
            <span
              className="rpt-cohort-dist"
              title={`p10 ${dim.p10} · p50 ${dim.p50} · p90 ${dim.p90}`}
            >
              <span
                className="rpt-cohort-dist-range"
                style={{
                  left: `${pct(dim.p10)}%`,
                  width: `${Math.max(1, pct(dim.p90) - pct(dim.p10))}%`,
                }}
              />
              <span
                className="rpt-cohort-dist-p50"
                style={{ left: `${pct(dim.p50)}%` }}
              />
              {dim.value !== null && (
                <span
                  className="rpt-cohort-dist-you"
                  style={{ left: `${pct(dim.value)}%`, background: color }}
                />
              )}
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
