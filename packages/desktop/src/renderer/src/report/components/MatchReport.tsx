import { useMemo, useState } from "react";

import { deriveBurstLedger } from "../derive/burstLedger";
import { type DeathRecap, deriveDeathRecaps } from "../derive/deathRecap";
import type { MeterMode } from "../derive/meterRows";
import { deriveStatsTable } from "../derive/statsTable";
import { deriveSummary } from "../derive/summary";
import { deriveTimeline } from "../derive/timeline";
import type { ReportSource } from "../derive/types";
import { deriveVulnBands } from "../derive/vulnWindows";
import { BurstLedgerCard } from "./BurstLedgerCard";
import { DeathRecapCard } from "./DeathRecapCard";
import { Meters } from "./Meters";
import { ProComparisonVerified } from "./ProComparisonVerified";
import { ReplayView } from "./ReplayView";
import { ReportHeader } from "./ReportHeader";
import { StructuredAnalysisPanel } from "./StructuredAnalysisPanel";
import { Timeline } from "./Timeline";
import { WindowList } from "./WindowList";

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
  initialView = "report",
}: {
  source: ReportSource;
  roundLabel?: string;
  matchId?: string;
  initialView?: View;
}) {
  const [mode, setMode] = useState<MeterMode>("damage");
  const [view, setView] = useState<View>(initialView);
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
  const ledgerPlayers = useMemo(() => deriveBurstLedger(source), [source]);
  const [recap, setRecap] = useState<DeathRecap | null>(null);
  // 回放光标投影(1c):从回放切回战报时显示最后位置
  const [lastReplayT, setLastReplayT] = useState<number | null>(null);
  // AI 一键同跑:分析主按钮 nonce → cohort 对比(合并两个按钮)
  const [aiRunNonce, setAiRunNonce] = useState(0);

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
      {/* 页头一行:视图 tab 靠左(用户反馈),胜负+meta 靠右 */}
      <div className="rpt-head-row">
        <div className="rpt-view-tabs rpt-head-tabs">
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
        <ReportHeader source={source} roundLabel={roundLabel} />
      </div>
      {view === "report" && (
        <div className="rpt-body">
          {/* 主卡:生命曲线 + 窗口列表(1c) */}
          <div>
            <Timeline
              data={timeline}
              hidden={hidden}
              onSelectUnit={toggleUnit}
              onDeathClick={openRecap}
              bands={vulnBands}
              onBandClick={(tS) => handleSeekEvent(tS, [])}
              cursorT={lastReplayT}
            />
            <WindowList bands={vulnBands} onSeek={handleSeekEvent} />
          </div>
          {/* 下方两栏:榜单 | 死亡回顾常驻栏(1c) */}
          <div className="rpt-body-cols">
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
              source={source}
            />
            <div className="rpt-recap-col">
              {recap ? (
                <DeathRecapCard
                  recap={recap}
                  onClose={() => setRecap(null)}
                  onJump={(tSeconds, unitNames) => {
                    handleSeekEvent(tSeconds, unitNames);
                  }}
                />
              ) : (
                <div className="rpt-recap-placeholder">
                  点击曲线上的 ✕ 查看死亡回顾
                </div>
              )}
            </div>
          </div>
          <BurstLedgerCard players={ledgerPlayers} onSeek={handleSeekEvent} />
        </div>
      )}
      {view === "replay" && (
        <ReplayView
          source={source}
          seekReq={seekReq}
          onDeathClick={openRecap}
          onLastT={setLastReplayT}
        />
      )}
      {/* 死亡回顾浮层:仅回放视图(战报视图已改为右栏常驻位,1c) */}
      {view === "replay" && recap && (
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
              onRunAll={() => setAiRunNonce((n) => n + 1)}
            />
            <div className="rpt-ai-cohort">
              <ProComparisonVerified
                source={source}
                matchId={resolvedMatchId}
                runSignal={aiRunNonce}
                hideActions
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
