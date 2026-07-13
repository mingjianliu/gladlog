import { useMemo, useState } from "react";

import { deriveSummary } from "../derive/summary";
import { deriveTimeline } from "../derive/timeline";
import type { ReportSource } from "../derive/types";
import { Meters } from "./Meters";
import { ProComparisonVerified } from "./ProComparisonVerified";
import { ReplayView } from "./ReplayView";
import { ReportHeader } from "./ReportHeader";
import { StructuredAnalysisPanel } from "./StructuredAnalysisPanel";
import { Timeline } from "./Timeline";
import { UnitPanel } from "./UnitPanel";

type Mode = "damage" | "healing" | "taken";
type View = "report" | "replay" | "ai";

const MODE_LABEL: Record<Mode, string> = {
  damage: "伤害",
  healing: "治疗",
  taken: "承伤",
};

const VIEW_LABEL: Record<View, string> = {
  report: "战报",
  replay: "回放",
  ai: "AI 分析",
};

export function MatchReport({
  source,
  roundLabel,
  matchId,
}: {
  source: ReportSource;
  roundLabel?: string;
  matchId?: string;
}) {
  const [mode, setMode] = useState<Mode>("damage");
  const [view, setView] = useState<View>("report");
  const [unitId, setUnitId] = useState<string>(source.playerId);
  const summary = useMemo(() => deriveSummary(source), [source]);
  const timeline = useMemo(() => deriveTimeline(source), [source]);
  const selected = source.units[unitId]
    ? unitId
    : (summary[0]?.unitId ?? source.playerId);

  const resolvedMatchId = matchId ?? source.id;

  return (
    <div className="rpt-match">
      <ReportHeader source={source} roundLabel={roundLabel} />
      <div className="rpt-view-tabs">
        {(Object.keys(VIEW_LABEL) as View[]).map((k) => (
          <button
            key={k}
            className={k === view ? "active" : ""}
            onClick={() => setView(k)}
          >
            {VIEW_LABEL[k]}
          </button>
        ))}
      </div>
      {view === "report" && (
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
            <UnitPanel
              source={source}
              unitId={selected}
              onSelectUnit={setUnitId}
            />
          </aside>
        </div>
      )}
      {view === "replay" && <ReplayView source={source} />}
      {view === "ai" && (
        <div className="rpt-ai-full">
          <StructuredAnalysisPanel source={source} matchId={resolvedMatchId} />
          <ProComparisonVerified source={source} matchId={resolvedMatchId} />
        </div>
      )}
    </div>
  );
}
