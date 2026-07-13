import { useMemo, useState } from "react";

import type { MeterMode } from "../derive/meterRows";
import { deriveSummary } from "../derive/summary";
import { deriveTimeline } from "../derive/timeline";
import type { ReportSource } from "../derive/types";
import { Meters } from "./Meters";
import { ProComparisonVerified } from "./ProComparisonVerified";
import { ReplayView } from "./ReplayView";
import { ReportHeader } from "./ReportHeader";
import { StructuredAnalysisPanel } from "./StructuredAnalysisPanel";
import { Timeline } from "./Timeline";

type View = "report" | "replay" | "ai";

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
  const [mode, setMode] = useState<MeterMode>("damage");
  const [view, setView] = useState<View>("report");
  const summary = useMemo(() => deriveSummary(source), [source]);
  const timeline = useMemo(() => deriveTimeline(source), [source]);

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
          <Meters
            rows={summary}
            mode={mode}
            onMode={setMode}
            playerTeamId={source.playerTeamId}
          />
          <Timeline data={timeline} />
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
