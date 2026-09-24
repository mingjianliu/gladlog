import { fmtTime } from "@gladlog/analysis";

import { shortUnitName } from "../derive/teamSide";
import type { VulnBand } from "../derive/vulnWindows";


/**
 * Window list (1c): below the HP curve, one row per kill/vulnerability window;
 * the whole row is clickable and seeks the replay.
 * Colour bar: gold = kill attempt, red = vulnerable but unpunished (same
 * predicate as the curve's bands, deriveVulnBands).
 */
export function WindowList({
  bands,
  onSeek,
}: {
  bands: VulnBand[];
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
}) {
  if (bands.length === 0) return null;
  return (
    // After the 1a compaction this is a scroll region (max-height + overflow):
    // it must be keyboard focusable, or axe flags
    // scrollable-region-focusable (keyboard users cannot scroll it).
    <div
      className="rpt-windows"
      data-testid="window-list"
      tabIndex={0}
      role="region"
      aria-label="击杀/脆弱窗口列表"
    >
      {bands.map((b, i) => (
        <div
          key={i}
          className={onSeek ? "rpt-window rpt-window-click" : "rpt-window"}
          onClick={onSeek ? () => onSeek(b.fromS, [b.targetName]) : undefined}
        >
          <span
            className="rpt-window-bar"
            style={{
              background: b.kind === "burst" ? "var(--gold)" : "var(--loss)",
            }}
          />
          <span className="rpt-window-t">
            {fmtTime(b.fromS)}–{fmtTime(b.toS)}
          </span>
          <span className="rpt-window-title">
            {b.kind === "burst"
              ? `击杀尝试 → ${shortUnitName(b.targetName)}`
              : `${shortUnitName(b.targetName)} 脆弱且未被惩罚`}
          </span>
          <span className="rpt-window-detail">
            团队伤害{b.kind === "burst" ? "" : "仅"}{" "}
            {(b.damage / 1000).toFixed(0)}k
          </span>
          {/* Trailing duration + kill-result chip (P3-2) */}
          <span className="rpt-ledger-chip rpt-ledger-chip-dim">
            {Math.round(b.toS - b.fromS)}s
          </span>
          {b.targetDied && (
            <span className="rpt-ledger-chip rpt-ledger-chip-kill">击杀</span>
          )}
          {onSeek && <span className="rpt-window-go">▶ 回放</span>}
        </div>
      ))}
    </div>
  );
}
