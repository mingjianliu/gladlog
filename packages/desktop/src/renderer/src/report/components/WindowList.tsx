import { fmtTime } from "@gladlog/analysis";

import { useT } from "../../i18n/LangProvider";
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
  const { t } = useT();
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
      aria-label={t("report.windows.aria")}
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
              ? t("report.band.burstTo", { name: shortUnitName(b.targetName) })
              : t("report.band.vulnUnpunished", {
                  name: shortUnitName(b.targetName),
                })}
          </span>
          <span className="rpt-window-detail">
            {t(
              b.kind === "burst"
                ? "report.windows.teamDamage"
                : "report.windows.teamDamageOnly",
              { k: (b.damage / 1000).toFixed(0) },
            )}
            {(b.absorbed / 1000).toFixed(0) !== "0" &&
              t("report.windows.absorbed", {
                k: (b.absorbed / 1000).toFixed(0),
              })}
          </span>
          {/* Trailing duration + kill-result chip (P3-2) */}
          <span className="rpt-ledger-chip rpt-ledger-chip-dim">
            {Math.round(b.toS - b.fromS)}s
          </span>
          {b.targetDied && (
            <span className="rpt-ledger-chip rpt-ledger-chip-kill">
              {t("report.common.kill")}
            </span>
          )}
          {onSeek && (
            <span className="rpt-window-go">{t("report.windows.replay")}</span>
          )}
        </div>
      ))}
    </div>
  );
}
