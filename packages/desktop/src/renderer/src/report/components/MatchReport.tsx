import { useMemo, useState } from "react";
import type { ReportSource } from "../derive/types";
import { deriveSummary } from "../derive/summary";
import { deriveTimeline } from "../derive/timeline";
import { Meters } from "./Meters";
import { ReportHeader } from "./ReportHeader";
import { Timeline } from "./Timeline";
import { UnitPanel } from "./UnitPanel";
import { StructuredAnalysisPanel } from "./StructuredAnalysisPanel";
import { ProComparisonVerified } from "./ProComparisonVerified";

type Mode = "damage" | "healing" | "taken";
type SideTab = "unit" | "ai";

const MODE_LABEL: Record<Mode, string> = {
  damage: "伤害",
  healing: "治疗",
  taken: "承伤",
};

const SIDE_TAB_LABEL: Record<SideTab, string> = {
  unit: "单位详情",
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
  const [sideTab, setSideTab] = useState<SideTab>("unit");
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
          <div className="rpt-mode-tabs">
            {(Object.keys(SIDE_TAB_LABEL) as SideTab[]).map((k) => (
              <button
                key={k}
                className={k === sideTab ? "active" : ""}
                onClick={() => setSideTab(k)}
              >
                {SIDE_TAB_LABEL[k]}
              </button>
            ))}
          </div>
          {sideTab === "unit" ? (
            <UnitPanel source={source} unitId={selected} />
          ) : (
            <>
              <StructuredAnalysisPanel
                source={source}
                matchId={resolvedMatchId}
              />
              <ProComparisonVerified
                source={source}
                matchId={resolvedMatchId}
              />
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
