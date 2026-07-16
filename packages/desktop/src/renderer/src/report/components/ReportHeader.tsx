import { zoneMetadata } from "@gladlog/analysis";

import type { ReportSource } from "../derive/types";
import { deriveRoster } from "../derive/roster";
import { classColor, specName } from "../data/gameConstants";

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ReportHeader({
  source,
  roundLabel,
}: {
  source: ReportSource;
  roundLabel?: string;
}) {
  const teams = deriveRoster(source);
  return (
    <header className="rpt-header">
      <div className="rpt-team">
        {teams[0]?.players.map((p) => (
          <div
            key={p.unitId}
            className="rpt-player"
            style={{ borderLeftColor: classColor(p.classId) }}
          >
            <span className="rpt-player-name">{p.name}</span>
            <span className="rpt-player-sub">
              {specName(p.specId)}
              {p.rating !== null ? ` · ${p.rating}` : ""}
            </span>
          </div>
        ))}
      </div>
      <div className="rpt-center">
        {roundLabel ? <div className="rpt-round">{roundLabel}</div> : null}
        <div className={`rpt-result rpt-result-${source.result.toLowerCase()}`}>
          {source.result}
        </div>
        <div className="rpt-meta">
          {source.bracket} ·{" "}
          {zoneMetadata[String(source.zoneId)]?.name ?? `zone ${source.zoneId}`}{" "}
          · {fmtDuration(source.endTime - source.startTime)}
        </div>
      </div>
      <div className="rpt-team rpt-team-right">
        {teams[1]?.players.map((p) => (
          <div
            key={p.unitId}
            className="rpt-player"
            style={{ borderLeftColor: classColor(p.classId) }}
          >
            <span className="rpt-player-name">{p.name}</span>
            <span className="rpt-player-sub">
              {specName(p.specId)}
              {p.rating !== null ? ` · ${p.rating}` : ""}
            </span>
          </div>
        ))}
      </div>
    </header>
  );
}
