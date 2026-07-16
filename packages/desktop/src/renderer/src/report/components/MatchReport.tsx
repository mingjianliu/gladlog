import { useMemo, useState } from "react";

import type { MeterMode } from "../derive/meterRows";
import { deriveDeathRecaps, type DeathRecap } from "../derive/deathRecap";
import { deriveStatsTable } from "../derive/statsTable";
import { deriveVulnBands } from "../derive/vulnWindows";
import { deriveSummary } from "../derive/summary";
import { deriveTimeline } from "../derive/timeline";
import type { ReportSource } from "../derive/types";
import { DeathRecapCard } from "./DeathRecapCard";
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
  const statsRows = useMemo(() => deriveStatsTable(source), [source]);
  const vulnBands = useMemo(() => deriveVulnBands(source), [source]);
  const [recap, setRecap] = useState<DeathRecap | null>(null);

  // 死亡标记点击 → 找该单位最近的回顾(懒算,点击才 derive)
  const openRecap = (unitId: string, tMs: number) => {
    const tS = (tMs - source.startTime) / 1000;
    const all = deriveDeathRecaps(source);
    const hit = all
      .filter((r) => r.unitId === unitId)
      .sort((a, b) => Math.abs(a.deathS - tS) - Math.abs(b.deathS - tS))[0];
    if (hit) setRecap(hit);
  };

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
            statsRows={statsRows}
            durationS={(source.endTime - source.startTime) / 1000}
            onSeek={handleSeekEvent}
          />
          <Timeline
            data={timeline}
            hidden={hidden}
            onSelectUnit={toggleUnit}
            onDeathClick={openRecap}
            bands={vulnBands}
            onBandClick={(tS) => handleSeekEvent(tS, [])}
          />
        </div>
      )}
      {view === "replay" && (
        <ReplayView
          source={source}
          seekReq={seekReq}
          onDeathClick={openRecap}
        />
      )}
      {/* 死亡回顾卡:战报与回放两个视图共用(AI 视图不渲染) */}
      {view !== "ai" && recap && (
        <DeathRecapCard
          recap={recap}
          onClose={() => setRecap(null)}
          onJump={(tSeconds, unitNames) => {
            setRecap(null);
            handleSeekEvent(tSeconds, unitNames);
          }}
        />
      )}
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
