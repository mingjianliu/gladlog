import { fmtTime } from "@gladlog/analysis";

import type { TimeRange } from "../derive/timeRange";
import type { UncoveredHighlight } from "../derive/uncoveredHighlights";

/**
 * Uncovered-highlights card (BACKLOG #13): below the findings section of the AI
 * analysis view, it shows coachable spans the automatic sliding window found
 * that the existing analysis never touched. With zero highlights it renders
 * nothing (zero noise — a clean match, or one already well covered by findings
 * plus the mistake list, must not show an empty card).
 *
 * Clicking [Analyze this span with AI] = set the time range to that window +
 * trigger #16's runWindowAi — no new IPC, reusing the existing window-analysis
 * path (cache/force semantics inherited unchanged).
 */
export function UncoveredHighlightsCard({
  highlights,
  onAnalyze,
}: {
  highlights: UncoveredHighlight[];
  onAnalyze: (range: TimeRange) => void;
}) {
  if (highlights.length === 0) return null;
  return (
    <div className="rpt-ledger" data-testid="uncovered-highlights-card">
      <div className="rpt-ledger-head">
        <span className="rpt-ledger-title">未覆盖亮点</span>
      </div>
      <div className="rpt-ledger-section">
        {highlights.map((h, i) => (
          <div
            key={`${h.range.fromS}-${h.range.toS}`}
            className="rpt-ledger-row"
          >
            <span>
              {fmtTime(h.range.fromS)}–{fmtTime(h.range.toS)}
            </span>
            <span className="rpt-ledger-spells">{h.summary}</span>
            <button
              className="rpt-finding-toggle"
              data-testid={`uncovered-highlight-btn-${i}`}
              onClick={() => onAnalyze(h.range)}
            >
              AI 分析此段
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
