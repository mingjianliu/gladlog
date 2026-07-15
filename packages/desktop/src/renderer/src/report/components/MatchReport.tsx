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
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  // 证据链跳转请求:AI 视图点「回放此刻」→ 切回放并 seek。nonce 防重复消费,
  // 回放时钟保持 ReplayView 局部(提升热 state 会让三视图随 tick 重渲)。
  const [seekReq, setSeekReq] = useState<{
    tMs: number;
    unitNames: string[];
    nonce: number;
  } | null>(null);

  const handleSeekEvent = (tSeconds: number, unitNames: string[]) => {
    setSeekReq({
      tMs: source.startTime + tSeconds * 1000,
      unitNames,
      nonce: Date.now(),
    });
    setView("replay");
  };
  const summary = useMemo(() => deriveSummary(source), [source]);
  const timeline = useMemo(() => deriveTimeline(source), [source]);

  const toggleUnit = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
            hidden={hidden}
            onToggleUnit={toggleUnit}
          />
          <Timeline data={timeline} hidden={hidden} onSelectUnit={toggleUnit} />
        </div>
      )}
      {view === "replay" && <ReplayView source={source} seekReq={seekReq} />}
      {view === "ai" && (
        <div className="rpt-ai-full">
          <div className="rpt-ai-main">
            <StructuredAnalysisPanel
              source={source}
              matchId={resolvedMatchId}
              onSeekEvent={handleSeekEvent}
            />
          </div>
          <aside className="rpt-ai-side">
            <ProComparisonVerified source={source} matchId={resolvedMatchId} />
          </aside>
        </div>
      )}
    </div>
  );
}
