import type { TimeRange } from "../derive/timeRange";
import type { VulnBand } from "../derive/vulnWindows";

const fmtT = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * 时间窗工具条(第四阶段①,WCL 的 phase 下拉 + timeframe 选择的合体):
 * phase 选项 = 全场 + 每个已算好的窗口(击杀尝试/脆弱段,与 WindowList 同源);
 * 也可在 HP 曲线上直接拖选(Timeline 的 onRangeSelect)。窗口激活时聚合面板
 * (榜单/统计/打断/驱散)全部重算到窗口,HP 曲线/窗口列表/爆发账本保持全场。
 */
export function TimeRangeBar({
  bands,
  range,
  onChange,
}: {
  bands: VulnBand[];
  range: TimeRange | null;
  onChange: (r: TimeRange | null) => void;
}) {
  // band 的起止带小数秒(渲染标签取整),回显匹配用容差,别精确相等
  const selectedIdx = range
    ? bands.findIndex(
        (b) =>
          Math.abs(b.fromS - range.fromS) < 0.5 &&
          Math.abs(b.toS - range.toS) < 0.5,
      )
    : -1;
  return (
    <div className="rpt-trb" data-testid="time-range-bar">
      <span className="rpt-card-label">时间窗</span>
      <select
        value={selectedIdx >= 0 ? String(selectedIdx) : ""}
        onChange={(e) => {
          const idx = e.target.value === "" ? -1 : Number(e.target.value);
          const b = bands[idx];
          onChange(b ? { fromS: b.fromS, toS: b.toS } : null);
        }}
        title="选一个窗口(或在曲线上拖选)"
      >
        <option value="">全场</option>
        {bands.map((b, i) => (
          <option key={i} value={String(i)}>
            {fmtT(b.fromS)}–{fmtT(b.toS)}{" "}
            {b.kind === "burst"
              ? `击杀尝试 → ${b.targetName.split("-")[0]}`
              : `${b.targetName.split("-")[0]} 脆弱`}
          </option>
        ))}
      </select>
      {range && (
        <>
          <span className="rpt-trb-chip" data-testid="time-range-chip">
            {fmtT(range.fromS)}–{fmtT(range.toS)}(
            {Math.round(range.toS - range.fromS)}s)
          </span>
          <button className="rpt-trb-clear" onClick={() => onChange(null)}>
            清除
          </button>
        </>
      )}
      {!range && <span className="rpt-trb-hint">在曲线上拖选可聚焦时间段</span>}
    </div>
  );
}
