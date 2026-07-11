import { useMemo, useState } from "react";
import type { ReportSource } from "../derive/types";
import { deriveSummary } from "../derive/summary";
import { deriveTimeline } from "../derive/timeline";
import { Meters } from "./Meters";
import { ReportHeader } from "./ReportHeader";
import { Timeline } from "./Timeline";
import { UnitPanel } from "./UnitPanel";

type Mode = "damage" | "healing" | "taken";
const MODE_LABEL: Record<Mode, string> = {
  damage: "伤害",
  healing: "治疗",
  taken: "承伤",
};

export function MatchReport({
  source,
  roundLabel,
}: {
  source: ReportSource;
  roundLabel?: string;
}) {
  const [mode, setMode] = useState<Mode>("damage");
  const [unitId, setUnitId] = useState<string>(source.playerId);
  const summary = useMemo(() => deriveSummary(source), [source]);
  const timeline = useMemo(() => deriveTimeline(source), [source]);
  const selected = source.units[unitId]
    ? unitId
    : (summary[0]?.unitId ?? source.playerId);
  return (
    <div className="rpt-match">
      <ReportHeader source={source} roundLabel={roundLabel} />
      <div className="rpt-body">
        <div className="rpt-main">
          <div className="rpt-mode-tabs">
            {(Object.keys(MODE_LABEL) as Mode[]).map((k) => (
              <button
                key={k}
                className={k === mode ? "active" : ""}
                onClick={() => setMode(k)}
              >
                {MODE_LABEL[k]}
              </button>
            ))}
          </div>
          <Meters rows={summary} mode={mode} />
          <Timeline data={timeline} onSelectUnit={setUnitId} />
        </div>
        <aside className="rpt-side">
          <UnitPanel source={source} unitId={selected} />
        </aside>
      </div>
    </div>
  );
}
