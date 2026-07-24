import type { Mistake, MistakeSeverity } from "../derive/mistakes";

const fmtT = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const SEVERITY_CHIP: Record<MistakeSeverity, { cls: string; label: string }> = {
  major: { cls: "bad", label: "重大" },
  average: { cls: "warn", label: "一般" },
  minor: { cls: "dim", label: "轻微" },
};

/**
 * 失误清单卡(第四阶段③ / backlog #8):确定性规则直出,不经 LLM。
 * 三档严重度 chips(WoWAnalyzer minor/average/major 模式),逐条 ▶ 跳回放;
 * 时间轴上同步画 ⚠ 标记(MatchReport 传入)。
 */
export function MistakesCard({
  mistakes,
  onSeek,
}: {
  mistakes: Mistake[];
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
}) {
  if (mistakes.length === 0) return null;
  return (
    <div className="rpt-ledger" data-testid="mistakes-card">
      <div className="rpt-ledger-head">
        <span className="rpt-ledger-title">失误清单</span>
        <span className="rpt-stats-dim">
          确定性规则直出,共 {mistakes.length} 条
        </span>
      </div>
      {mistakes.map((mk, i) => {
        const chip = SEVERITY_CHIP[mk.severity];
        return (
          <div key={i} className="rpt-ledger-row">
            <span className="rpt-stats-detail-t">
              {mk.tS > 0 ? fmtT(mk.tS) : "全场"}
            </span>
            <span className={`rpt-ledger-chip rpt-ledger-chip-${chip.cls}`}>
              {chip.label}
            </span>
            <span>
              {mk.unitName.split("-")[0]} · {mk.label}
            </span>
            {mk.detail && <span className="rpt-stats-dim">{mk.detail}</span>}
            {onSeek && mk.tS > 0 && (
              <button
                className="rpt-stats-detail-jump"
                title="回放此刻"
                onClick={() => onSeek(Math.max(0, mk.tS - 3), mk.seekNames)}
              >
                ▶
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
