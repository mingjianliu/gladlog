import { fmtTime } from "@gladlog/analysis";

import { useT } from "../../i18n/LangProvider";
import { shortUnitName } from "../derive/teamSide";
import type { TimeRange } from "../derive/timeRange";
import type { VulnBand } from "../derive/vulnWindows";

/**
 * Time-window toolbar (phase 4 ①; a combination of WCL's phase dropdown and
 * timeframe selection): the phase options are "whole match" plus every
 * pre-computed window (kill attempts / vulnerability stretches, same source as
 * WindowList); a window can also be drag-selected directly on the HP curve
 * (Timeline's onRangeSelect). While a window is active, the aggregate panels
 * (meters/stats/kicks/dispels) all recompute over that window, whereas the HP
 * curve, window list and burst ledger stay on the whole match.
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
  // A band's bounds carry fractional seconds while the display label floors
  // them (measured: 36.734 shows as 0:36), so the round-trip match uses a 1s
  // tolerance — adjacent windows' start times differ by far more than 1s, so
  // there is no mismatch risk.
  const { t } = useT();
  const selectedIdx = range
    ? bands.findIndex(
        (b) =>
          Math.abs(b.fromS - range.fromS) < 1 &&
          Math.abs(b.toS - range.toS) < 1,
      )
    : -1;
  return (
    <div className="rpt-trb" data-testid="time-range-bar">
      <span className="rpt-card-label">{t("report.timeRange.label")}</span>
      <select
        value={selectedIdx >= 0 ? String(selectedIdx) : ""}
        onChange={(e) => {
          const idx = e.target.value === "" ? -1 : Number(e.target.value);
          const b = bands[idx];
          onChange(b ? { fromS: b.fromS, toS: b.toS } : null);
        }}
        title={t("report.timeRange.pickTitle")}
      >
        <option value="">{t("report.common.wholeMatch")}</option>
        {bands.map((b, i) => (
          <option key={i} value={String(i)}>
            {fmtTime(b.fromS)}–{fmtTime(b.toS)}{" "}
            {b.kind === "burst"
              ? t("report.band.burstTo", { name: shortUnitName(b.targetName) })
              : t("report.band.vuln", { name: shortUnitName(b.targetName) })}
          </option>
        ))}
      </select>
      {range && (
        <>
          <span className="rpt-trb-chip" data-testid="time-range-chip">
            {fmtTime(range.fromS)}–{fmtTime(range.toS)}(
            {Math.round(range.toS - range.fromS)}s)
          </span>
          <button className="rpt-trb-clear" onClick={() => onChange(null)}>
            {t("report.common.clear")}
          </button>
        </>
      )}
      {!range && (
        <span className="rpt-trb-hint">{t("report.timeRange.hint")}</span>
      )}
    </div>
  );
}
